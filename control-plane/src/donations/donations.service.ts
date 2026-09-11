import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DiscordService } from '../discord/discord.service';
import {
  applyChargeRefund,
  creditCompletedSession,
  parseChargeRefund,
  parseDonationAmountCents,
  parseLostDispute,
  parsePaidCheckoutSession,
} from './donations.logic';
import { constructStripeEventWithSecrets, createCheckoutSession } from './donations.stripe';
import { stripeCredentialsForOrg, stripeWebhookSecrets } from './donations.credentials';
import { parseShopItemId, parseShopItemIds } from './donations.shop';
import { parseGrantItemList, snapshotLineGrants, aggregateGrantStatus } from './shop-grants';
import { JobsService } from '../jobs/jobs.service';
import { TriggersService } from '../triggers/triggers.service';

@Injectable()
export class DonationsService {
  private readonly logger = new Logger(DonationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordService,
    private readonly jobs: JobsService,
    private readonly triggers: TriggersService,
  ) {}

  async webhookConfigured() {
    return (await stripeWebhookSecrets(this.prisma)).length > 0;
  }

  async listCompleted(orgId: string, limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 200);
    const rows = await this.prisma.donation.findMany({
      where: { orgId, status: { in: ['completed', 'refunded'] } },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        player: { select: { name: true } },
        shopItem: { select: { name: true } },
        lines: {
          orderBy: { itemName: 'asc' },
          select: { id: true, shopItemId: true, itemName: true, amountCents: true, quantity: true, grantStatus: true, grantError: true, grantItems: true, grantItemName: true, grantQuantity: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      playerName: row.player.name,
      steamId: row.steamId,
      amountCents: row.amountCents,
      refundedCents: row.refundedCents,
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.length
        ? row.lines
        : row.shopItem
          ? [{ id: row.id, shopItemId: row.shopItemId, itemName: row.shopItem.name, amountCents: row.amountCents, quantity: 1, grantStatus: 'none', grantError: null }]
          : [{ id: row.id, shopItemId: null, itemName: 'Custom support', amountCents: row.amountCents, quantity: 1, grantStatus: 'none', grantError: null }],
    }));
  }

  async createCheckout(
    player: { id: string; steamId: string | null; serverInstanceId: string; orgId: string; name?: string; sessionAuth?: string },
    amountCents?: number,
    shopItemId?: string,
    shopItemIds?: string[],
  ) {
    if (!player.steamId && player.sessionAuth !== 'name') {
      throw new BadRequestException('Sign in with your Minecraft name or Steam to donate.');
    }
    const credentials = await stripeCredentialsForOrg(this.prisma, player.orgId);
    if (!credentials) throw new ServiceUnavailableException('Donations are not configured');
    const syntheticSteam = player.steamId || `mc:${player.id}`;
    const cartIds = parseShopItemIds(shopItemIds);
    if (cartIds) return this.createCartCheckout({ ...player, steamId: syntheticSteam }, cartIds, credentials.secretKey);
    const itemId = parseShopItemId(shopItemId);
    let amount = parseDonationAmountCents(amountCents);
    let productName = 'Server support';
    const tiedTo = player.sessionAuth === 'name' && player.name
      ? `Support tied to Minecraft name ${player.name}`
      : `Support tied to Steam ending ${syntheticSteam.slice(-4)}`;
    let productDescription = tiedTo;
    let returnPath = '/player/profile';
    if (itemId) {
      const item = await this.prisma.shopItem.findFirst({
        where: { id: itemId, orgId: player.orgId, active: true },
        select: { id: true, name: true, description: true, priceCents: true },
      });
      if (!item) throw new BadRequestException('That shop item is not available');
      amount = item.priceCents;
      productName = item.name;
      productDescription = item.description || productDescription;
      returnPath = `/player/shop/${itemId}`;
    }
    if (amount == null) throw new BadRequestException('Choose an amount between $5 and $500');
    const origin = checkoutOrigin();
    try {
      return await createCheckoutSession({
        amountCents: amount,
        playerId: player.id,
        steamId: syntheticSteam,
        serverInstanceId: player.serverInstanceId,
        orgId: player.orgId,
        origin,
        secretKey: credentials.secretKey,
        productName,
        productDescription,
        shopItemId: itemId || undefined,
        returnPath,
      });
    } catch {
      throw new ServiceUnavailableException('Checkout is unavailable');
    }
  }

  private async createCartCheckout(
    player: { id: string; steamId: string; serverInstanceId: string; orgId: string; name?: string; sessionAuth?: string },
    ids: string[],
    secretKey: string,
  ) {
    const rows = await this.prisma.shopItem.findMany({
      where: { orgId: player.orgId, active: true, id: { in: ids } },
      select: { id: true, name: true, description: true, priceCents: true },
    });
    if (rows.length !== ids.length) throw new BadRequestException('One or more shop items are not available');
    const ordered = ids.map((id) => rows.find((row) => row.id === id)!);
    const origin = checkoutOrigin();
    try {
      return await createCheckoutSession({
        playerId: player.id,
        steamId: player.steamId,
        serverInstanceId: player.serverInstanceId,
        orgId: player.orgId,
        origin,
        secretKey,
        returnPath: '/player/shop/cart',
        lineItems: ordered.map((item) => ({
          amountCents: item.priceCents,
          name: item.name,
          description: item.description || (player.sessionAuth === 'name' && player.name
            ? `Support tied to Minecraft name ${player.name}`
            : `Support tied to account ${player.steamId.startsWith('mc:') ? player.name || player.id : `Steam ending ${player.steamId.slice(-4)}`}`),
          shopItemId: item.id,
        })),
      });
    } catch {
      throw new ServiceUnavailableException('Checkout is unavailable');
    }
  }

  async handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
    let event: ReturnType<typeof constructStripeEventWithSecrets>;
    try {
      event = constructStripeEventWithSecrets(rawBody, signature, await stripeWebhookSecrets(this.prisma));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'unconfigured') throw new ForbiddenException('Stripe webhook is not configured');
      throw new BadRequestException('Invalid Stripe signature');
    }
    if (event.type === 'checkout.session.completed') {
      await this.creditPaidSession(asRecord(event.data.object));
      return { received: true };
    }
    if (event.type === 'charge.refunded') {
      const parsed = parseChargeRefund(asRecord(event.data.object));
      if (parsed) await this.refundPaymentIntent(parsed.paymentIntentId, parsed.refundedCents);
      return { received: true };
    }
    if (event.type === 'charge.dispute.closed') {
      const parsed = parseLostDispute(asRecord(event.data.object));
      if (parsed) await this.refundPaymentIntent(parsed.paymentIntentId, parsed.refundedCents);
      return { received: true };
    }
    return { received: true };
  }

  private async creditPaidSession(object: Record<string, unknown>) {
    const paid = parsePaidCheckoutSession(object);
    if (!paid) return;
    const player = await this.prisma.player.findFirst({
      where: { id: paid.playerId, steamId: paid.steamId, serverInstanceId: paid.serverInstanceId, orgId: paid.orgId },
      select: {
        id: true,
        name: true,
        orgId: true,
        steamId: true,
        identityKey: true,
        online: true,
        lifetimeSeconds: true,
        supporter: true,
        supporterSince: true,
        totalDonatedCents: true,
      },
    });
    if (!player) {
      this.logger.warn(`Ignoring paid checkout ${paid.sessionId}: player no longer registered`);
      return;
    }
    const previousCents = player.totalDonatedCents;
    const existing = await this.prisma.donation.findUnique({
      where: { stripeCheckoutSessionId: paid.sessionId },
      select: { id: true },
    });
    if (existing) return;
    const lineRows = await this.buildDonationLines(paid);
    const primaryShopItemId = paid.shopItemIds.length === 1 ? paid.shopItemIds[0] : paid.shopItemId;
    const shopItem = primaryShopItemId
      ? await this.prisma.shopItem.findFirst({ where: { id: primaryShopItemId, orgId: paid.orgId }, select: { id: true } })
      : null;
    const at = new Date();
    const next = creditCompletedSession(null, {
      stripeCheckoutSessionId: paid.sessionId,
      stripePaymentIntentId: paid.paymentIntentId,
      amountCents: paid.amountCents,
    }, player, at);
    if (!next.applied) return;
    try {
      await this.prisma.$transaction([
        this.prisma.donation.create({
          data: {
            orgId: paid.orgId,
            serverInstanceId: paid.serverInstanceId,
            playerId: player.id,
            steamId: paid.steamId,
            amountCents: paid.amountCents,
            currency: paid.currency,
            status: 'completed',
            stripeCheckoutSessionId: paid.sessionId,
            stripePaymentIntentId: paid.paymentIntentId,
            shopItemId: shopItem?.id ?? null,
            completedAt: at,
            lines: lineRows.length ? { create: lineRows } : undefined,
          },
        }),
        this.prisma.player.update({
          where: { id: player.id },
          data: {
            supporter: next.player.supporter,
            supporterSince: next.player.supporterSince,
            totalDonatedCents: next.player.totalDonatedCents,
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    await this.notifyDiscord(player.orgId, player.name, paid.amountCents, lineRows.map((line) => line.itemName));
    await this.jobs.enqueueShopGrants(paid.orgId, paid.serverInstanceId, player.id, paid.steamId).catch(() => undefined);
    await this.triggers.evaluateDonationTotal(
      paid.orgId,
      paid.serverInstanceId,
      {
        id: player.id,
        name: player.name,
        steamId: player.steamId,
        identityKey: player.identityKey,
        online: player.online,
        lifetimeSeconds: player.lifetimeSeconds,
      },
      previousCents,
      next.player.totalDonatedCents,
    ).catch(() => undefined);
  }

  private async buildDonationLines(paid: {
    orgId: string;
    shopItemIds: string[];
    lineAmounts: number[];
    amountCents: number;
  }) {
    if (!paid.shopItemIds.length) return [];
    const items = await this.prisma.shopItem.findMany({
      where: { orgId: paid.orgId, id: { in: paid.shopItemIds } },
      select: { id: true, name: true, priceCents: true, grantItemName: true, grantQuantity: true, grantItems: true },
    });
    return paid.shopItemIds.map((id, index) => {
      const item = items.find((row) => row.id === id);
      const amountCents = paid.lineAmounts[index] ?? item?.priceCents ?? 0;
      const parsed = parseGrantItemList(item?.grantItems);
      const grantItems = snapshotLineGrants(
        parsed !== false && parsed.length
          ? parsed
          : (parseGrantItemList(item?.grantItemName ? [{ name: item.grantItemName, quantity: item.grantQuantity }] : []) || []),
      );
      const first = grantItems[0];
      return {
        shopItemId: item?.id ?? null,
        itemName: item?.name ?? 'Shop item',
        amountCents,
        quantity: 1,
        grantItems: grantItems as Prisma.InputJsonValue,
        grantItemName: first?.name ?? null,
        grantQuantity: first ? first.quantity : null,
        grantStatus: aggregateGrantStatus(grantItems),
      };
    }).filter((line) => line.amountCents > 0);
  }

  private async refundPaymentIntent(paymentIntentId: string, refundedCents: number) {
    const donation = await this.prisma.donation.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { player: { select: { id: true, supporter: true, supporterSince: true, totalDonatedCents: true } } },
    });
    if (!donation) return;
    const at = new Date();
    const next = applyChargeRefund({
      stripeCheckoutSessionId: donation.stripeCheckoutSessionId,
      stripePaymentIntentId: donation.stripePaymentIntentId,
      amountCents: donation.amountCents,
      refundedCents: donation.refundedCents,
      status: donation.status === 'refunded' ? 'refunded' : 'completed',
    }, refundedCents, donation.player);
    if (!next.applied || !next.donation) return;
    await this.prisma.$transaction([
      this.prisma.donation.update({
        where: { id: donation.id },
        data: {
          refundedCents: next.donation.refundedCents,
          status: next.donation.status,
          refundedAt: next.donation.status === 'refunded' ? at : donation.refundedAt,
        },
      }),
      this.prisma.player.update({
        where: { id: donation.player.id },
        data: {
          supporter: next.player.supporter,
          supporterSince: next.player.supporterSince,
          totalDonatedCents: next.player.totalDonatedCents,
        },
      }),
    ]);
  }

  private async notifyDiscord(orgId: string, name: string, amountCents: number, itemNames: string[]) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { discordWebhookUrl: true } });
    const webhookUrl = org?.discordWebhookUrl?.trim();
    if (!webhookUrl) return;
    const dollars = (amountCents / 100).toFixed(2);
    const itemSuffix = itemNames.length
      ? ` — ${itemNames.slice(0, 5).join(', ')}${itemNames.length > 5 ? '…' : ''}`
      : '';
    const result = await this.discord.send(
      webhookUrl,
      { content: `${name} supported the server${itemSuffix} ($${dollars}).` },
      `${orgId}:donation`,
    ).catch(() => ({ ok: false as const, error: 'send failed' }));
    if (!result.ok) this.logger.warn(`Donation Discord notify failed for org ${orgId}`);
  }
}

function checkoutOrigin() {
  const origin = (process.env.PUBLIC_WEB_URL || '').replace(/\/$/, '');
  if (!origin.startsWith('https://') && process.env.NODE_ENV === 'production') {
    throw new ServiceUnavailableException('Donations are not configured');
  }
  if (!/^https?:\/\//i.test(origin)) throw new ServiceUnavailableException('Donations are not configured');
  return origin;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
