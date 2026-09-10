import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, GatewayTimeoutException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DUMMY_PASSWORD_HASH, makePasswordHash, verifyPassword } from '../auth/auth.service';
import { stripeCheckoutEnabledForOrg } from '../donations/donations.credentials';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { parsePortalPassword, parsePortalPlayerName, parseShopReturnPath } from './player-auth.names';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

function hostLooksOnline(host: { status: string | null; lastHeartbeatAt: Date | null }) {
  if (host.status === 'online') return true;
  if (host.status === 'offline') return false;
  if (!host.lastHeartbeatAt) return false;
  return Date.now() - host.lastHeartbeatAt.getTime() < 120_000;
}

function portalText(value: unknown, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function publicDownloadUrl(value: unknown) {
  const text = portalText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

@Injectable()
export class PlayerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly jobs: JobsService,
  ) {}

  async verifySteam(serverInstanceId: string, returnTo: string, openid: Record<string, unknown>) {
    if (!serverInstanceId || !/^c[a-z0-9]{10,40}$/i.test(serverInstanceId)) throw new BadRequestException('Valid server required');
    let callback: URL;
    try { callback = new URL(returnTo); } catch { throw new BadRequestException('Invalid Steam return URL'); }
    if (!['http:', 'https:'].includes(callback.protocol)) throw new BadRequestException('Invalid Steam return URL');
    const params = new URLSearchParams();
    const entries = Object.entries(openid ?? {});
    if (entries.length > 32) throw new BadRequestException('Steam identity response is too large');
    for (const [key, value] of entries) {
      if (key.startsWith('openid.') && typeof value === 'string' && value.length <= 4096) params.set(key, value);
    }
    const claimed = params.get('openid.claimed_id') ?? '';
    const identity = params.get('openid.identity') ?? '';
    const steam = CLAIMED_ID.exec(claimed)?.[1];
    if (!steam || identity !== claimed || params.get('openid.mode') !== 'id_res') throw new UnauthorizedException('Steam identity response is invalid');
    const provider = params.get('openid.op_endpoint')?.replace(/\/$/, '');
    if (!['https://steamcommunity.com/openid', STEAM_OPENID].includes(provider ?? '')) throw new UnauthorizedException('Unexpected Steam identity provider');
    if (params.get('openid.return_to') !== returnTo) throw new UnauthorizedException('Steam return URL did not match');
    params.set('openid.mode', 'check_authentication');
    const response = await fetch(STEAM_OPENID, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new BadGatewayException('Steam verification is unavailable');
    const verification = await response.text();
    if (!/(?:^|\n)is_valid:true(?:\r?$|\n)/m.test(verification)) throw new UnauthorizedException('Steam could not verify this login');
    const player = await this.prisma.player.findFirst({
      where: { serverInstanceId, steamId: steam },
      select: { id: true, steamId: true, name: true, online: true, serverInstance: { select: { id: true, name: true } } },
    });
    if (!player?.steamId) throw new UnauthorizedException('This Steam account has not played on this server');
    const access_token = this.jwt.sign(
      { sub: player.id, kind: 'player', auth: 'steam', steamId: player.steamId, serverInstanceId },
      { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '12h' },
    );
    return { access_token, player: { name: player.name, steamId: player.steamId, serverInstanceId, serverName: player.serverInstance.name, auth: 'steam' as const } };
  }

  async portalServer() {
    const configured = (process.env.PLAYER_PORTAL_SERVER_ID || '').trim();
    if (/^c[a-z0-9]{10,40}$/i.test(configured)) {
      const server = await this.prisma.serverInstance.findFirst({
        where: { id: configured },
        select: { id: true, orgId: true, name: true },
      });
      if (server) return server;
    }
    const servers = await this.prisma.serverInstance.findMany({ take: 2, select: { id: true, orgId: true, name: true } });
    if (servers.length === 1) return servers[0];
    throw new ServiceUnavailableException('Player portal server is not configured');
  }

  async shopStatus() {
    const server = await this.portalServer();
    const online = await this.prisma.player.count({ where: { serverInstanceId: server.id, online: true } });
    const host = await this.prisma.serverInstance.findFirst({
      where: { id: server.id },
      select: { host: { select: { status: true, lastHeartbeatAt: true } } },
    });
    return {
      serverName: server.name,
      checkoutEnabled: await stripeCheckoutEnabledForOrg(this.prisma, server.orgId),
      serverReachable: host?.host ? hostLooksOnline(host.host) : false,
      playersOnline: online,
    };
  }

  async publicLanding() {
    let orgId: string | null = null;
    try {
      orgId = (await this.portalServer()).orgId;
    } catch {
      const first = await this.prisma.org.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
      orgId = first?.id ?? null;
    }
    if (!orgId) {
      return {
        ok: false as const,
        orgName: null,
        headline: 'Mastermind',
        servers: [] as Array<{
          id: string;
          name: string;
          hostName: string;
          playersOnline: number;
          shopPath: string;
          mapPath: string;
        }>,
      };
    }

    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
    const orgName = org?.name?.trim() || 'Mastermind';
    const instances = await this.prisma.serverInstance.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        host: { select: { name: true, status: true, lastHeartbeatAt: true } },
      },
      orderBy: { name: 'asc' },
    });

    const onlineIds = instances
      .filter((row) => hostLooksOnline(row.host))
      .map((row) => row.id);

    const counts = onlineIds.length
      ? await this.prisma.player.groupBy({
          by: ['serverInstanceId'],
          where: { orgId, serverInstanceId: { in: onlineIds }, online: true, NOT: { identityKey: { startsWith: 'name:' } } },
          _count: { _all: true },
        })
      : [];
    const countByServer = new Map(counts.map((row) => [row.serverInstanceId, row._count._all]));

    const servers = instances
      .filter((row) => onlineIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        hostName: row.host.name,
        playersOnline: countByServer.get(row.id) ?? 0,
        shopPath: `/player/shop?server=${encodeURIComponent(row.id)}`,
        mapPath: `/player/map?server=${encodeURIComponent(row.id)}`,
      }));

    const headline = servers.length === 1
      ? `${orgName} is Currently Hosting — ${servers[0].name}`
      : servers.length > 1
        ? `${orgName} is Currently Hosting`
        : `${orgName} — no servers online`;

    return { ok: true as const, orgName, headline, servers };
  }

  async registerName(input: { name?: unknown; password?: unknown; next?: unknown }) {
    const name = parsePortalPlayerName(input.name);
    const password = parsePortalPassword(input.password);
    if (!name) throw new BadRequestException('Enter your in-game name exactly as it appears on the server');
    if (!password) throw new BadRequestException('Choose a password of at least 8 characters');
    const server = await this.portalServer();
    const matches = await this.prisma.player.findMany({
      where: { serverInstanceId: server.id, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, steamId: true, portalPasswordHash: true, serverInstance: { select: { name: true } } },
      take: 3,
    });
    if (matches.length === 0) {
      throw new ConflictException('That Minecraft name has not been seen on this server yet. Join the game once, then create an account.');
    }
    if (matches.length > 1) {
      throw new ConflictException('That name matches more than one player record. Contact staff for help.');
    }
    const player = matches[0];
    if (player.portalPasswordHash) {
      throw new ConflictException('An account already exists for that name. Sign in instead.');
    }
    await this.prisma.player.update({
      where: { id: player.id },
      data: { portalPasswordHash: makePasswordHash(password) },
    });
    return this.issueNameSession(player, server.id, player.serverInstance.name, input.next);
  }

  async loginName(input: { name?: unknown; password?: unknown; next?: unknown }) {
    const name = parsePortalPlayerName(input.name);
    const password = parsePortalPassword(input.password);
    if (!name || !password) throw new UnauthorizedException('In-game name or password is incorrect');
    const server = await this.portalServer();
    const matches = await this.prisma.player.findMany({
      where: { serverInstanceId: server.id, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, steamId: true, portalPasswordHash: true, serverInstance: { select: { name: true } } },
      take: 3,
    });
    const player = matches.length === 1 ? matches[0] : null;
    const valid = verifyPassword(password, player?.portalPasswordHash || DUMMY_PASSWORD_HASH);
    if (!player || !player.portalPasswordHash || !valid) {
      throw new UnauthorizedException('In-game name or password is incorrect');
    }
    return this.issueNameSession(player, server.id, player.serverInstance.name, input.next);
  }

  private issueNameSession(
    player: { id: string; name: string; steamId: string | null },
    serverInstanceId: string,
    serverName: string,
    nextRaw: unknown,
  ) {
    const access_token = this.jwt.sign(
      { sub: player.id, kind: 'player', auth: 'name', serverInstanceId },
      { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '12h' },
    );
    return {
      access_token,
      next: parseShopReturnPath(nextRaw),
      player: { name: player.name, steamId: player.steamId, serverInstanceId, serverName, auth: 'name' as const },
    };
  }

  async requirePlayer(token: string) {
    let payload: { sub?: string; kind?: string; auth?: string; steamId?: string; serverInstanceId?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret' });
    } catch { throw new UnauthorizedException('Player session expired'); }
    if (payload.kind !== 'player' || !payload.sub || !payload.serverInstanceId) throw new UnauthorizedException('Player session invalid');
    const sessionAuth: 'steam' | 'name' = payload.auth === 'name' ? 'name' : 'steam';
    if (sessionAuth === 'steam' && !payload.steamId) throw new UnauthorizedException('Player session invalid');
    const player = await this.prisma.player.findFirst({
      where: {
        id: payload.sub,
        serverInstanceId: payload.serverInstanceId,
        ...(sessionAuth === 'steam' ? { steamId: payload.steamId } : {}),
      },
      select: {
        id: true, orgId: true, steamId: true, name: true, online: true, serverInstanceId: true,
        identityKey: true,
        lifetimeSeconds: true,
        currentSessionStartedAt: true, firstSeenAt: true, lastSeenAt: true, lastLogoutAt: true,
        lastPosX: true, lastPosY: true, lastPosZ: true,
        supporter: true, supporterSince: true, totalDonatedCents: true, portalPasswordHash: true,
        serverInstance: { select: { name: true, mapEmbedUrl: true } },
      },
    });
    if (!player) throw new UnauthorizedException('Player no longer registered');
    if (sessionAuth === 'steam' && !player.steamId) throw new UnauthorizedException('Player no longer registered');
    if (sessionAuth === 'name' && !player.portalPasswordHash) throw new UnauthorizedException('Player session invalid');
    const { portalPasswordHash: _hash, ...safe } = player;
    return { ...safe, sessionAuth } as typeof safe & { sessionAuth: 'steam' | 'name' };
  }

  async profile(token: string) {
    const player = await this.requirePlayer(token);
    // Dashboard accounts and game players are intentionally separate records.
    // When an administrator has linked the same display name to a player, expose
    // only a boolean so the portal can offer a convenient dashboard link.
    const isAdmin = await this.isPortalAdmin(player.orgId, player.name);
    const checkoutEnabled = await stripeCheckoutEnabledForOrg(this.prisma, player.orgId);
    const steamLast4 = player.steamId ? player.steamId.slice(-4) : '';
    if (player.sessionAuth === 'name') {
      const now = Date.now();
      const sessionSeconds = player.online && player.currentSessionStartedAt ? Math.max(0, Math.floor((now - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
      const uuid = player.identityKey?.startsWith('uuid:') ? player.identityKey.slice(5) : null;
      return {
        playerId: player.id,
        steamId: player.steamId,
        uuid,
        name: player.name,
        online: player.online,
        auth: 'name' as const,
        isAdmin,
        serverInstanceId: player.serverInstanceId,
        serverName: player.serverInstance.name,
        mapEmbedUrl: player.serverInstance.mapEmbedUrl ?? null,
        stats: {
          sessionSeconds,
          lifetimeSeconds: player.lifetimeSeconds + sessionSeconds,
        },
        donation: {
          status: player.supporter ? 'supporter' : 'ready',
          tiedTo: 'name',
          steamLast4,
          checkoutEnabled,
          supporter: player.supporter,
          supporterSince: player.supporterSince?.toISOString() ?? null,
          totalDonatedCents: player.totalDonatedCents,
          recent: [],
        },
      };
    }
    const now = Date.now();
    const sessionSeconds = player.online && player.currentSessionStartedAt ? Math.max(0, Math.floor((now - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
    const hasPosition = player.lastPosX != null && player.lastPosZ != null;
    const recent = await this.prisma.donation.findMany({
      where: { playerId: player.id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { amountCents: true, createdAt: true },
    });
    return {
      playerId: player.id,
      steamId: player.steamId,
      name: player.name,
      online: player.online,
      auth: 'steam' as const,
      isAdmin,
      serverInstanceId: player.serverInstanceId,
      serverName: player.serverInstance.name,
      mapEmbedUrl: player.serverInstance.mapEmbedUrl ?? null,
      stats: {
        sessionSeconds,
        lifetimeSeconds: player.lifetimeSeconds + sessionSeconds,
        firstSeenAt: player.firstSeenAt.toISOString(),
        lastSeenAt: player.lastSeenAt.toISOString(),
      },
      location: hasPosition ? {
        x: player.lastPosX,
        y: player.lastPosY,
        z: player.lastPosZ,
        lastLogoutAt: player.lastLogoutAt?.toISOString() ?? null,
        source: player.online ? 'last_reported' : 'last_logout',
      } : null,
      donation: {
        status: player.supporter ? 'supporter' : 'ready',
        tiedTo: 'steam',
        steamLast4,
        checkoutEnabled,
        supporter: player.supporter,
        supporterSince: player.supporterSince?.toISOString() ?? null,
        totalDonatedCents: player.totalDonatedCents,
        recent: recent.map((row) => ({ amountCents: row.amountCents, at: row.createdAt.toISOString() })),
      },
    };
  }

  /** Active mods and their published download pages for supporters and administrators. */
  async portalMods(token: string) {
    const player = await this.requirePlayer(token);
    const isAdmin = await this.isPortalAdmin(player.orgId, player.name);
    if (!player.supporter && !isAdmin) {
      throw new ForbiddenException('Mod downloads are available to supporters and administrators');
    }
    const queued = await this.jobs.enqueueInternalJob(player.orgId, null, player.serverInstanceId, 'MOD_LIST');
    const data = await this.waitForPortalJobData(queued.jobRunId);
    const source = data && typeof data === 'object' && Array.isArray((data as { mods?: unknown }).mods)
      ? (data as { mods: unknown[] }).mods
      : [];
    const mods = source.map((row) => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return {
        name: portalText(item.name, 160) || 'Unnamed mod',
        author: portalText(item.author, 120) || null,
        version: portalText(item.version, 80) || null,
        description: portalText(item.description, 500) || null,
        website: publicDownloadUrl(item.website),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { serverName: player.serverInstance.name, mods };
  }

  async requestMod(token: string, file: { originalname: string; size: number; buffer: Buffer } | undefined, description: unknown) {
    const player = await this.requirePlayer(token);
    const text = typeof description === 'string' ? description.trim() : '';
    if (!text) throw new BadRequestException('Add a short description of the mod');
    if (text.length > 500) throw new BadRequestException('Mod description cannot exceed 500 characters');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty ZIP archive');
    if (!/\.zip$/i.test(file.originalname || '')) throw new BadRequestException('Only .zip mod archives are supported');
    if (file.size > 256 * 1024 * 1024) throw new BadRequestException('ZIP exceeds the 256 MiB upload limit');
    const signature = file.buffer.subarray(0, 4).toString('hex');
    if (!['504b0304', '504b0506', '504b0708'].includes(signature)) throw new BadRequestException('The uploaded file is not a valid ZIP archive');
    const uploadId = randomUUID();
    const root = process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads';
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stagedPath = join(root, `${uploadId}.zip`);
    await writeFile(stagedPath, file.buffer, { mode: 0o600, flag: 'wx' });
    try {
      return await this.jobs.createPlayerModRequest(player.orgId, player.serverInstanceId, {
        uploadId, originalName: file.originalname, sizeBytes: file.size, description: text,
        recommendedBy: player.name, recommendedById: player.id,
      });
    } catch (error) {
      await unlink(stagedPath).catch(() => undefined);
      throw error;
    }
  }

  private async isPortalAdmin(orgId: string, playerName: string) {
    const adminNames = await this.prisma.userOrg.findMany({
      where: { orgId, role: { name: 'admin' }, user: { name: { not: null } } },
      select: { user: { select: { name: true } } },
    });
    return adminNames.some(row => row.user.name?.trim().toLocaleLowerCase() === playerName.trim().toLocaleLowerCase());
  }

  private async waitForPortalJobData(jobRunId: string): Promise<unknown> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const run = await this.prisma.jobRun.findUnique({ where: { id: jobRunId }, select: { status: true, result: true } });
      if (run && ['success', 'failed', 'cancelled'].includes(run.status)) {
        const result = (run.result ?? {}) as Record<string, unknown>;
        if (run.status !== 'success') throw new ServiceUnavailableException(typeof result.errorMessage === 'string' ? result.errorMessage : 'The game could not list mods');
        return result.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new GatewayTimeoutException('The game did not answer in time');
  }
}
