import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import {
  TRIGGER_ACTION_GRANT_ITEMS,
  TRIGGER_ACTIONS,
  TRIGGER_EVENT_DONATION_TOTAL,
  TRIGGER_EVENT_FIRST_JOIN,
  TRIGGER_EVENT_PLAYTIME,
  TRIGGER_EVENTS,
  crossedDonationTotalCents,
  crossedPlaytimeHours,
  eventKeyForDonationTotal,
  eventKeyForFirstJoin,
  eventKeyForPlaytime,
  grantItemsSummary,
  parseDonationTotalConfig,
  parseEventConfig,
  parseGrantItemsActionConfig,
  parsePlaytimeConfig,
  type DonationTotalConfig,
  type PlaytimeConfig,
} from './catalog';
import { MAX_GRANT_ATTEMPTS, classifyGrantOutput } from '../donations/shop-grants';

export type TriggerInput = {
  name: string;
  serverInstanceId: string;
  enabled?: boolean;
  eventType: string;
  eventConfig: unknown;
  actionType: string;
  actionConfig: unknown;
  applyToExisting?: boolean;
};

type TriggerPlayer = {
  id: string;
  name: string;
  steamId: string | null;
  identityKey: string;
  online: boolean;
  lifetimeSeconds: number;
};

@Injectable()
export class TriggersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService)) private readonly jobs: JobsService,
  ) {}

  catalog() {
    return { events: TRIGGER_EVENTS, actions: TRIGGER_ACTIONS };
  }

  async list(orgId: string, serverInstanceId?: string) {
    return this.prisma.trigger.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listFires(orgId: string, triggerId: string) {
    const trigger = await this.requireTrigger(orgId, triggerId);
    return this.prisma.triggerFire.findMany({
      where: { triggerId: trigger.id },
      include: { player: { select: { id: true, name: true, steamId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(orgId: string, userId: string, input: TriggerInput) {
    const name = input.name?.trim();
    if (!name || name.length > 80) throw new BadRequestException('Name is required (max 80 characters)');
    if (!TRIGGER_EVENTS.some((event) => event.type === input.eventType)) {
      throw new BadRequestException('Unsupported trigger event');
    }
    if (input.actionType !== TRIGGER_ACTION_GRANT_ITEMS) {
      throw new BadRequestException('Unsupported trigger action');
    }
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: input.serverInstanceId, orgId },
      select: { id: true },
    });
    if (!server) throw new NotFoundException('Server instance not found');

    let eventConfig: Prisma.InputJsonValue;
    let actionConfig: Prisma.InputJsonValue;
    try {
      eventConfig = parseEventConfig(input.eventType, input.eventConfig) as Prisma.InputJsonValue;
      actionConfig = parseGrantItemsActionConfig(input.actionConfig) as unknown as Prisma.InputJsonValue;
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid trigger config');
    }

    const trigger = await this.prisma.trigger.create({
      data: {
        orgId,
        serverInstanceId: server.id,
        createdById: userId,
        name,
        enabled: input.enabled !== false,
        eventType: input.eventType,
        eventConfig,
        actionType: TRIGGER_ACTION_GRANT_ITEMS,
        actionConfig,
        applyToExisting: Boolean(input.applyToExisting),
      },
    });

    if (trigger.applyToExisting && trigger.enabled) {
      await this.backfillTrigger(trigger).catch(() => undefined);
    }
    return trigger;
  }

  async update(orgId: string, id: string, input: Partial<TriggerInput>) {
    const current = await this.requireTrigger(orgId, id);
    if (
      input.eventType != null
      || input.eventConfig != null
      || input.actionType != null
      || input.actionConfig != null
      || input.serverInstanceId != null
      || input.applyToExisting != null
    ) {
      throw new BadRequestException('Edit name or enabled only; recreate the trigger to change event or grants');
    }
    const data: { name?: string; enabled?: boolean } = {};
    if (input.name != null) {
      const name = input.name.trim();
      if (!name || name.length > 80) throw new BadRequestException('Name is required (max 80 characters)');
      data.name = name;
    }
    if (input.enabled != null) data.enabled = input.enabled;
    if (Object.keys(data).length === 0) return current;
    const updated = await this.prisma.trigger.update({ where: { id: current.id }, data });
    // Re-enable with apply-to-existing: backfill anyone who still lacks a fire row.
    if (current.enabled === false && updated.enabled && updated.applyToExisting) {
      await this.backfillTrigger(updated).catch(() => undefined);
    }
    return updated;
  }

  async remove(orgId: string, id: string) {
    await this.requireTrigger(orgId, id);
    await this.prisma.trigger.delete({ where: { id } });
  }

  /** Fire first-join rewards when a brand-new player record is created / first seen online. */
  async evaluateFirstJoin(orgId: string, serverInstanceId: string, player: TriggerPlayer) {
    const triggers = await this.prisma.trigger.findMany({
      where: { orgId, serverInstanceId, enabled: true, eventType: TRIGGER_EVENT_FIRST_JOIN },
    });
    for (const trigger of triggers) {
      await this.fireOnce(trigger, player, eventKeyForFirstJoin()).catch(() => undefined);
    }
  }

  /** Fire playtime milestones when lifetime seconds cross configured hour thresholds. */
  async evaluatePlaytime(
    orgId: string,
    serverInstanceId: string,
    player: TriggerPlayer,
    previousLifetimeSeconds: number,
    nextLifetimeSeconds: number,
  ) {
    const triggers = await this.prisma.trigger.findMany({
      where: { orgId, serverInstanceId, enabled: true, eventType: TRIGGER_EVENT_PLAYTIME },
    });
    for (const trigger of triggers) {
      let config: PlaytimeConfig;
      try {
        config = parsePlaytimeConfig(trigger.eventConfig);
      } catch {
        continue;
      }
      if (!crossedPlaytimeHours(previousLifetimeSeconds, nextLifetimeSeconds, config.hours)) continue;
      await this.fireOnce(trigger, player, eventKeyForPlaytime(config.hours)).catch(() => undefined);
    }
  }

  /** Fire donation milestones when cumulative donated cents cross configured dollar thresholds. */
  async evaluateDonationTotal(
    orgId: string,
    serverInstanceId: string,
    player: TriggerPlayer,
    previousCents: number,
    nextCents: number,
  ) {
    const triggers = await this.prisma.trigger.findMany({
      where: { orgId, serverInstanceId, enabled: true, eventType: TRIGGER_EVENT_DONATION_TOTAL },
    });
    for (const trigger of triggers) {
      let config: DonationTotalConfig;
      try {
        config = parseDonationTotalConfig(trigger.eventConfig);
      } catch {
        continue;
      }
      if (!crossedDonationTotalCents(previousCents, nextCents, config.dollars)) continue;
      await this.fireOnce(trigger, player, eventKeyForDonationTotal(config.dollars)).catch(() => undefined);
    }
  }

  async completeItemGrant(payload: Record<string, unknown>, runStatus: string, output: string) {
    const fireId = typeof payload.triggerFireId === 'string' ? payload.triggerFireId : '';
    if (!fireId) return;
    const fire = await this.prisma.triggerFire.findUnique({ where: { id: fireId } });
    if (!fire) return;
    const outcome = classifyGrantOutput(output, runStatus);
    const attempts = fire.attempts;
    const errText = String(output || '').trim().slice(0, 500) || null;
    if (outcome === 'delivered') {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { status: 'delivered', lastError: null },
      });
      return;
    }
    if (outcome === 'failed' || attempts >= MAX_GRANT_ATTEMPTS) {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { status: 'failed', lastError: errText },
      });
      return;
    }
    await this.prisma.triggerFire.update({
      where: { id: fireId },
      data: { status: 'pending', lastError: errText },
    });
  }

  async retryPendingItemGrants(orgId: string, serverInstanceId: string) {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    await this.prisma.triggerFire.updateMany({
      where: {
        status: 'queued',
        attempts: { lt: MAX_GRANT_ATTEMPTS },
        createdAt: { lt: staleBefore },
        trigger: { orgId, serverInstanceId, enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
      },
      data: { status: 'pending', lastError: 'Stale queued grant; will retry' },
    });
    const fires = await this.prisma.triggerFire.findMany({
      where: {
        status: 'pending',
        attempts: { lt: MAX_GRANT_ATTEMPTS },
        trigger: { orgId, serverInstanceId, enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
        player: { online: true },
      },
      include: {
        trigger: true,
        player: { select: { id: true, name: true, steamId: true, identityKey: true, online: true, lifetimeSeconds: true } },
      },
      take: 32,
    });
    for (const fire of fires) {
      await this.enqueueGrantItems(fire.trigger, fire.player, fire.eventKey, false).catch(() => undefined);
    }
  }

  async retryPendingItemGrantsForPlayer(playerId: string) {
    const fires = await this.prisma.triggerFire.findMany({
      where: {
        playerId,
        status: 'pending',
        attempts: { lt: MAX_GRANT_ATTEMPTS },
        trigger: { enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
      },
      include: {
        trigger: true,
        player: { select: { id: true, name: true, steamId: true, identityKey: true, online: true, lifetimeSeconds: true } },
      },
      take: 16,
    });
    for (const fire of fires) {
      await this.enqueueGrantItems(fire.trigger, fire.player, fire.eventKey, false).catch(() => undefined);
    }
  }

  private async backfillTrigger(trigger: {
    id: string;
    orgId: string;
    serverInstanceId: string;
    createdById: string | null;
    eventType: string;
    eventConfig: unknown;
    actionConfig: unknown;
  }) {
    if (trigger.eventType === TRIGGER_EVENT_FIRST_JOIN) {
      const players = await this.prisma.player.findMany({
        where: { orgId: trigger.orgId, serverInstanceId: trigger.serverInstanceId },
        select: { id: true, name: true, steamId: true, identityKey: true, online: true, lifetimeSeconds: true },
        take: 500,
      });
      for (const player of players) {
        await this.fireOnce(trigger, player, eventKeyForFirstJoin()).catch(() => undefined);
      }
      return;
    }
    if (trigger.eventType === TRIGGER_EVENT_PLAYTIME) {
      let config: PlaytimeConfig;
      try {
        config = parsePlaytimeConfig(trigger.eventConfig);
      } catch {
        return;
      }
      const target = config.hours * 3600;
      const players = await this.prisma.player.findMany({
        where: { orgId: trigger.orgId, serverInstanceId: trigger.serverInstanceId, lifetimeSeconds: { gte: target } },
        select: { id: true, name: true, steamId: true, identityKey: true, online: true, lifetimeSeconds: true },
        take: 500,
      });
      for (const player of players) {
        await this.fireOnce(trigger, player, eventKeyForPlaytime(config.hours)).catch(() => undefined);
      }
      return;
    }
    if (trigger.eventType === TRIGGER_EVENT_DONATION_TOTAL) {
      let config: DonationTotalConfig;
      try {
        config = parseDonationTotalConfig(trigger.eventConfig);
      } catch {
        return;
      }
      const target = config.dollars * 100;
      const players = await this.prisma.player.findMany({
        where: { orgId: trigger.orgId, serverInstanceId: trigger.serverInstanceId, totalDonatedCents: { gte: target } },
        select: { id: true, name: true, steamId: true, identityKey: true, online: true, lifetimeSeconds: true },
        take: 500,
      });
      for (const player of players) {
        await this.fireOnce(trigger, player, eventKeyForDonationTotal(config.dollars)).catch(() => undefined);
      }
    }
  }

  private async fireOnce(
    trigger: { id: string; orgId: string; serverInstanceId: string; createdById: string | null; actionConfig: unknown },
    player: TriggerPlayer,
    eventKey: string,
  ) {
    const existing = await this.prisma.triggerFire.findUnique({
      where: { triggerId_playerId_eventKey: { triggerId: trigger.id, playerId: player.id, eventKey } },
    });
    if (existing) return;
    await this.enqueueGrantItems(trigger, player, eventKey, true);
  }

  private async enqueueGrantItems(
    trigger: { id: string; orgId: string; serverInstanceId: string; createdById: string | null; actionConfig: unknown },
    player: TriggerPlayer,
    eventKey: string,
    recordFire: boolean,
  ) {
    const action = parseGrantItemsActionConfig(trigger.actionConfig);
    const summary = grantItemsSummary(action.items);
    let fireId: string | null = null;
    if (recordFire) {
      try {
        const fire = await this.prisma.triggerFire.create({
          data: {
            triggerId: trigger.id,
            playerId: player.id,
            eventKey,
            status: player.online ? 'queued' : 'pending',
          },
        });
        fireId = fire.id;
      } catch {
        return;
      }
    } else {
      const existing = await this.prisma.triggerFire.findUnique({
        where: { triggerId_playerId_eventKey: { triggerId: trigger.id, playerId: player.id, eventKey } },
      });
      fireId = existing?.id ?? null;
    }

    if (!player.online) {
      if (fireId) await this.prisma.triggerFire.update({ where: { id: fireId }, data: { status: 'pending' } });
      return;
    }

    if (fireId) {
      const existing = await this.prisma.triggerFire.findUnique({ where: { id: fireId } });
      if (existing && existing.attempts >= MAX_GRANT_ATTEMPTS) {
        await this.prisma.triggerFire.update({
          where: { id: fireId },
          data: { status: 'failed', lastError: existing.lastError || 'Max grant attempts exceeded' },
        });
        return;
      }
    }

    const hoursHint = eventKey.startsWith('playtime:') ? eventKey.slice('playtime:'.length) : '';
    const dollarsHint = eventKey.startsWith('donation:')
      ? String(Math.floor(Number(eventKey.slice('donation:'.length)) / 100) || '')
      : '';
    const uuid = player.identityKey.startsWith('uuid:') ? player.identityKey.slice(5) : undefined;
    const queued = await this.jobs.enqueueInternalJob(trigger.orgId, trigger.createdById, trigger.serverInstanceId, 'TRIGGER_GRANT_ITEMS', {
      triggerId: trigger.id,
      triggerFireId: fireId,
      playerId: player.id,
      steamId: player.steamId,
      identityKey: player.identityKey,
      uuid,
      name: player.name,
      player: player.name,
      items: action.items,
      notifyPlayer: action.notifyPlayer,
      message: action.message
        .replaceAll('{name}', player.name)
        .replaceAll('{hours}', hoursHint)
        .replaceAll('{dollars}', dollarsHint)
        .replaceAll('{items}', summary),
    });
    if (recordFire && fireId) {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { jobId: queued.jobId, status: 'queued', attempts: { increment: 1 }, lastError: null },
      });
      await this.prisma.trigger.update({
        where: { id: trigger.id },
        data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
      });
    } else if (fireId) {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { jobId: queued.jobId, status: 'queued', attempts: { increment: 1 }, lastError: null },
      });
    }
  }

  private async requireTrigger(orgId: string, id: string) {
    const trigger = await this.prisma.trigger.findFirst({ where: { id, orgId } });
    if (!trigger) throw new NotFoundException('Trigger not found');
    return trigger;
  }
}
