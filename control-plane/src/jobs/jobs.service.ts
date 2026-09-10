import {
  Injectable,
  NotFoundException,
  BadRequestException,
    ForbiddenException,
    GatewayTimeoutException,
    OnModuleDestroy,
    OnModuleInit,
    Inject,
    forwardRef,
    ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BatchesService } from '../batches/batches.service';
import { JobsQueueService } from './jobs-queue.service';
import type { ReportResultDto } from './dto/report-result.dto';
import { reconcileNameFallback } from '../players/player-identity';
import { AlertsService } from '../alerts/alerts.service';
import { TriggersService } from '../triggers/triggers.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { pruneMap } from '../common/ttl-map';
import { parseInventoryOutput, type InventorySnapshot } from '../players/player-inventory';
import { parseLpRoster, parseMinecraftRoster, type PlayerRosterRow } from '../players/player-roster';
import { decryptIntegrationSecret } from '../orgs/integration-crypto';
import {
  MAX_GRANT_ATTEMPTS,
  aggregateGrantStatus,
  buildChatColorCommand,
  buildGiveCommand,
  classifyGrantOutput,
  lineGrantItems,
} from '../donations/shop-grants';
import { catalogFromAgentResult } from '../donations/item-catalog';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly badPingSamples = new Map<string, number>();
  private readonly protectionCooldown = new Map<string, number>();
  private readonly countryCache = new Map<string, { code: string; expires: number }>();
  private readonly inventoryCooldown = new Map<string, number>();
  private readonly deathPins = new Map<string, { deaths: number; until: number }>();
  private staleTimer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchesService: BatchesService,
    private readonly jobsQueueService: JobsQueueService,
    private readonly alerts: AlertsService,
    @Inject(forwardRef(() => TriggersService)) private readonly triggers: TriggersService,
    private readonly schedulerService: SchedulerService,
  ) {}

  async onModuleInit() {
    await this.failStaleRunningJobs();
    this.staleTimer = setInterval(() => void this.failStaleRunningJobs(), 60_000);
  }

  onModuleDestroy() { if (this.staleTimer) clearInterval(this.staleTimer); }

  private async failStaleRunningJobs() {
    const cutoff = Date.now() - 3 * 60_000;
    const runs = await this.prisma.jobRun.findMany({ where: { status: 'running' }, select: { id: true, result: true, startedAt: true } });
    for (const run of runs) {
      const result = (run.result ?? {}) as Record<string, unknown>;
      const heartbeat = Date.parse(String(result.updatedAt ?? '')) || run.startedAt?.getTime() || 0;
      if (heartbeat >= cutoff) continue;
      await this.prisma.jobRun.updateMany({ where: { id: run.id, status: 'running' }, data: {
        status: 'failed', finishedAt: new Date(), result: { ...result, errorMessage: 'Agent stopped reporting progress; job released as stale. Retry if still needed.', recoveredAt: new Date().toISOString() },
      }});
    }
  }

  /**
   * Create a single job + job run and enqueue it for the target host.
   */
  async createJob(
    orgId: string,
    userId: string,
    serverInstanceId: string,
    jobType: string,
    payload?: Record<string, unknown>,
  ): Promise<{ jobId: string; jobRunId: string }> {
    const normalizedJobType = this.normalizeJobType(jobType);
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { role: true, user: { select: { email: true, name: true } } },
    });
    const roleName = membership?.role.name;
    const viewerAllowed = ['MOD_LIST', 'MOD_QUARANTINE_LIST', 'MOD_PENDING_LIST', 'MOD_UPLOAD_PENDING'];
    if (roleName === 'viewer' && !viewerAllowed.includes(normalizedJobType)) {
      throw new ForbiddenException('Verified members may recommend mods, but cannot change installed mods');
    }
    if (normalizedJobType === 'MOD_UPLOAD_PENDING') {
      const recommendedBy = membership?.user.name?.trim() || membership?.user.email || 'Verified member';
      payload = { ...(payload ?? {}), recommendedBy, recommendedById: userId };
    }
    if (normalizedJobType === 'RCON' || normalizedJobType === 'SEND_COMMAND') {
      const command = typeof payload?.command === 'string' ? payload.command.trim() : '';
      if (!command) throw new BadRequestException('Console command is required');
      if (command.length > 512) throw new BadRequestException('Console command cannot exceed 512 characters');
      if (/[\r\n]/.test(command)) throw new BadRequestException('Only one console command may be sent at a time');
      payload = { ...(payload ?? {}), command };
    }
    if (normalizedJobType === 'PLAYER_ADMIN_PROMOTE' || normalizedJobType === 'PLAYER_ADMIN_DEMOTE') {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (membership?.role.name !== 'admin') {
        throw new ForbiddenException('Only organization administrators may change game administrators');
      }
    }
    if (normalizedJobType === 'PLAYER_SET_DEATHS') {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) {
        throw new ForbiddenException('Only organization administrators or operators may edit player deaths');
      }
      const deaths = Number(payload?.deaths);
      if (!Number.isInteger(deaths) || deaths < 0 || deaths > 100_000) {
        throw new BadRequestException('Deaths must be a whole number from 0 to 100000');
      }
      const identifier = typeof payload?.identifier === 'string' ? payload.identifier.trim() : '';
      if (!identifier) throw new BadRequestException('Player identifier is required');
      payload = { ...(payload ?? {}), deaths, identifier };
    }
    if (normalizedJobType === 'PLAYER_KICK_ALL' || normalizedJobType === 'SERVER_KILL') {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) {
        throw new ForbiddenException('Only organization administrators or operators may perform this action');
      }
    }
    if (['SAVE_BACKUP', 'SAVE_RESTORE', 'SAVE_DELETE', 'SAVE_RETENTION', 'SERVER_SAVE_STOP'].includes(normalizedJobType)) {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) {
        throw new ForbiddenException('Only organization administrators or operators may manage saves');
      }
    }
    if (normalizedJobType === 'MOD_UPLOAD_QUARANTINE') {
      const membership = await this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId, orgId } }, include: { role: true } });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) throw new ForbiddenException('Only organization administrators or operators may upload mods');
    }
    if (normalizedJobType === 'SERVER_UPDATE') {
      if (!roleName || !['admin', 'operator'].includes(roleName)) {
        throw new ForbiddenException('Only organization administrators or operators may update the dedicated server');
      }
    }
    if (normalizedJobType === 'SERVER_CONFIG_READ' || normalizedJobType === 'SERVER_CONFIG_WRITE') {
      if (!roleName || !['admin', 'operator'].includes(roleName)) {
        throw new ForbiddenException('Only organization administrators or operators may edit the server configuration');
      }
    }
    if (normalizedJobType === 'SERVER_MAINTENANCE') {
      if (!roleName || !['admin', 'operator'].includes(roleName)) {
        throw new ForbiddenException('Only organization administrators or operators may change maintenance mode');
      }
    }
    const serverInstance = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      include: {
        host: true,
        gameType: { select: { slug: true } },
        org: { select: { maintenancePasswordEncrypted: true } },
      },
    });
    if (!serverInstance) {
      throw new NotFoundException('Server instance not found');
    }
    if (normalizedJobType === 'SERVER_MAINTENANCE') {
      const enabled = payload?.enabled === true;
      if (enabled) {
        const encrypted = serverInstance.org.maintenancePasswordEncrypted;
        if (!encrypted) throw new BadRequestException('Set a maintenance password in Settings first');
        let password = '';
        try { password = decryptIntegrationSecret(encrypted); } catch { throw new BadRequestException('Stored maintenance password could not be decrypted'); }
        payload = { ...(payload ?? {}), enabled: true, password, kick_reason: 'Server entering maintenance' };
        // Disable keep-alive starts immediately so heartbeat cannot fight maintenance.
        await this.prisma.serverInstance.update({
          where: { id: serverInstance.id },
          data: { rebootIfDown: false },
        });
      } else {
        payload = { ...(payload ?? {}), enabled: false, kick_reason: 'Server leaving maintenance' };
      }
    }

    const mergedPayload = {
      server_instance_id: serverInstance.id,
      game_type: serverInstance.gameType.slug,
      install_path: serverInstance.installPath ?? undefined,
      start_command: serverInstance.startCommand ?? undefined,
      telnet_host: serverInstance.telnetHost ?? undefined,
      telnet_port: serverInstance.telnetPort ?? undefined,
      telnet_password: serverInstance.telnetPassword ?? undefined,
      config: serverInstance.config ?? undefined,
      ...(payload ?? {}),
    };

    const job = await this.prisma.job.create({
      data: {
        orgId,
        serverInstanceId,
        type: normalizedJobType,
        payload: mergedPayload as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    const run = await this.prisma.jobRun.create({
      data: {
        jobId: job.id,
        hostId: serverInstance.hostId,
        status: 'pending',
      },
    });

    await this.jobsQueueService.addJob(orgId, {
      jobId: job.id,
      jobRunId: run.id,
      hostId: serverInstance.hostId,
      serverInstanceId,
      type: normalizedJobType,
      payload: mergedPayload,
    });

    return { jobId: job.id, jobRunId: run.id };
  }

  async waitForJobOutput(jobRunId: string, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.prisma.jobRun.findUnique({ where: { id: jobRunId } });
      if (run && (run.status === 'success' || run.status === 'failed' || run.status === 'cancelled')) {
        const result = (run.result ?? {}) as Record<string, unknown>;
        const output = typeof result.output === 'string' ? result.output : '';
        if (run.status !== 'success') {
          const error = typeof result.errorMessage === 'string' ? result.errorMessage : 'Game command failed';
          throw new ServiceUnavailableException(error);
        }
        return output;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new GatewayTimeoutException('The game did not answer in time');
  }

  async enqueueInternalJob(
    orgId: string,
    userId: string | null,
    serverInstanceId: string,
    jobType: string,
    payload?: Record<string, unknown>,
  ): Promise<{ jobId: string; jobRunId: string }> {
    const normalizedJobType = this.normalizeJobType(jobType);
    const serverInstance = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      include: {
        host: true,
        gameType: { select: { slug: true } },
      },
    });
    if (!serverInstance) throw new NotFoundException('Server instance not found');
    const mergedPayload = {
      server_instance_id: serverInstance.id,
      game_type: serverInstance.gameType.slug,
      install_path: serverInstance.installPath ?? undefined,
      start_command: serverInstance.startCommand ?? undefined,
      telnet_host: serverInstance.telnetHost ?? undefined,
      telnet_port: serverInstance.telnetPort ?? undefined,
      telnet_password: serverInstance.telnetPassword ?? undefined,
      config: serverInstance.config ?? undefined,
      ...(payload ?? {}),
    };
    const job = await this.prisma.job.create({
      data: {
        orgId,
        serverInstanceId,
        type: normalizedJobType,
        payload: mergedPayload as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    const run = await this.prisma.jobRun.create({
      data: { jobId: job.id, hostId: serverInstance.hostId, status: 'pending' },
    });
    await this.jobsQueueService.addJob(orgId, {
      jobId: job.id,
      jobRunId: run.id,
      hostId: serverInstance.hostId,
      serverInstanceId,
      type: normalizedJobType,
      payload: mergedPayload,
    });
    return { jobId: job.id, jobRunId: run.id };
  }

  /** Create a pending mod request submitted by an authenticated game player. */
  async createPlayerModRequest(orgId: string, serverInstanceId: string, payload: Record<string, unknown>) {
    const serverInstance = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      include: { host: true, gameType: { select: { slug: true } } },
    });
    if (!serverInstance) throw new NotFoundException('Server instance not found');
    const mergedPayload = {
      server_instance_id: serverInstance.id,
      game_type: serverInstance.gameType.slug,
      install_path: serverInstance.installPath ?? undefined,
      start_command: serverInstance.startCommand ?? undefined,
      telnet_host: serverInstance.telnetHost ?? undefined,
      telnet_port: serverInstance.telnetPort ?? undefined,
      telnet_password: serverInstance.telnetPassword ?? undefined,
      config: serverInstance.config ?? undefined,
      ...payload,
    };
    const job = await this.prisma.job.create({ data: { orgId, serverInstanceId, type: 'MOD_UPLOAD_PENDING', payload: mergedPayload as Prisma.InputJsonValue, createdById: null } });
    const run = await this.prisma.jobRun.create({ data: { jobId: job.id, hostId: serverInstance.hostId, status: 'pending' } });
    await this.jobsQueueService.addJob(orgId, { jobId: job.id, jobRunId: run.id, hostId: serverInstance.hostId, serverInstanceId, type: 'MOD_UPLOAD_PENDING', payload: mergedPayload });
    return { jobId: job.id, jobRunId: run.id };
  }

  /**
   * Update JobRun with agent result and optionally update batch progress.
   */
  async reportJobResult(
    hostId: string,
    jobRunId: string,
    dto: ReportResultDto,
  ): Promise<{ ok: boolean }> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run) throw new NotFoundException('Job run not found');
    if (run.hostId !== hostId) {
      throw new BadRequestException('Job run does not belong to this host');
    }
    if (run.status !== 'running') {
      throw new BadRequestException(`Job run is not running (status: ${run.status})`);
    }

    const runStatus = dto.status === 'success' ? 'success' : 'failed';
    const resultData = runStatus === 'success' && run.job.type === 'ITEM_CATALOG'
      ? catalogFromAgentResult(dto.result)
      : dto.result;
    const result = {
      durationMs: dto.durationMs,
      errorMessage: dto.errorMessage,
      output: dto.output,
      data: resultData as Prisma.InputJsonValue | undefined,
    };

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: runStatus,
        finishedAt: new Date(),
        result,
      },
    });
    if (run.job.type === 'MOD_UPLOAD_QUARANTINE' || run.job.type === 'MOD_UPLOAD_PENDING') {
      const payload = (run.job.payload ?? {}) as Record<string, unknown>;
      const uploadId = typeof payload.uploadId === 'string' ? payload.uploadId : '';
      if (/^[0-9a-f-]{36}$/i.test(uploadId)) {
        await unlink(join(process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads', `${uploadId}.zip`)).catch(() => undefined);
      }
    }

    if (run.job.type === 'SERVER_MAINTENANCE' && runStatus === 'success' && run.job.serverInstanceId) {
      const payload = (run.job.payload ?? {}) as Record<string, unknown>;
      const enabled = payload.enabled === true;
      await this.prisma.serverInstance.update({
        where: { id: run.job.serverInstanceId },
        data: {
          maintenanceMode: enabled,
          ...(enabled ? { rebootIfDown: false } : {}),
        },
      });
    }
    if (run.job.type === 'SERVER_SAFE_RESTART' && runStatus === 'success' && run.job.serverInstanceId) {
      const payload = (run.job.payload ?? {}) as Record<string, unknown>;
      if (payload.trigger === 'stability_memory') {
        await this.schedulerService.skipNextAutoRestart(run.job.orgId, run.job.serverInstanceId, 'stability_restart');
      }
    }
    if (run.job.type === 'PLAYER_SET_DEATHS' && runStatus === 'success' && run.job.serverInstanceId) {
      const payload = (run.job.payload ?? {}) as Record<string, unknown>;
      const deaths = Number(payload.deaths);
      const playerId = typeof payload.playerId === 'string' ? payload.playerId : '';
      if (Number.isInteger(deaths) && playerId) {
        const player = await this.prisma.player.findFirst({ where: { id: playerId, orgId: run.job.orgId, serverInstanceId: run.job.serverInstanceId } });
        if (player) {
          await this.prisma.player.update({ where: { id: player.id }, data: { deaths } });
          const until = Date.now() + 10 * 60_000;
          this.deathPins.set(player.id, { deaths, until });
          this.deathPins.set(`${player.serverInstanceId}:${player.identityKey}`, { deaths, until });
        }
      }
    }
    if (run.job.type === 'PLAYER_LIST_SYNC' && runStatus === 'success' && run.job.serverInstanceId) {
      const rows = parseMinecraftRoster(dto.result) ?? (dto.output ? parseLpRoster(dto.output) : null);
      if (rows) {
        await this.applyPlayerRoster(run.job.orgId, run.job.serverInstanceId, rows);
        await this.enforceConnectionTools(run.job.orgId, run.job.serverInstanceId, rows);
      }
    }
    const resultPayload = (run.job.payload ?? {}) as Record<string, unknown>;
    if (run.job.type === 'RCON' && resultPayload.purpose === 'inventory_snapshot' && typeof resultPayload.playerId === 'string' && runStatus === 'success' && dto.output) {
      await this.storeInventorySnapshot(resultPayload.playerId, dto.output);
    }
    if (run.job.type === 'RCON' && resultPayload.purpose === 'shop_grant' && typeof resultPayload.donationLineId === 'string') {
      await this.finishShopGrant(resultPayload, runStatus, dto.output);
    }
    if (run.job.type === 'TRIGGER_GRANT_ITEMS') {
      await this.triggers.completeItemGrant(resultPayload, runStatus, `${dto.output || ''} ${dto.errorMessage || ''}`).catch(() => undefined);
    }

    const orgId = run.job.orgId;
    if (run.job.batchId) {
      await this.batchesService.recordJobRunCompleted(orgId, run.jobId, runStatus, 'running');
    }

    return { ok: true };
  }

  /**
   * Mark job run as running when agent picks it. Call from get-next-job flow.
   */
  async markJobRunStarted(hostId: string, jobRunId: string): Promise<void> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run || run.hostId !== hostId) return;
    if (run.status !== 'pending') return;

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: { status: 'running', startedAt: new Date() },
    });

    if (run.job.batchId) {
      await this.batchesService.recordJobRunStarted(run.job.orgId, run.jobId);
    }
  }

  private normalizeJobType(jobType: string): string {
    switch (jobType.toLowerCase()) {
      case 'start':
        return 'SERVER_START';
      case 'stop':
        return 'SERVER_STOP';
      case 'restart':
        return 'SERVER_RESTART';
      case 'rcon':
        return 'RCON';
      default:
        return jobType.toUpperCase();
    }
  }

  async reportJobProgress(
    hostId: string,
    jobRunId: string,
    phase: string,
    message?: string,
  ): Promise<{ ok: boolean }> {
    const run = await this.prisma.jobRun.findUnique({ where: { id: jobRunId } });
    if (!run) throw new NotFoundException('Job run not found');
    if (run.hostId !== hostId) throw new BadRequestException('Job run does not belong to this host');
    if (run.status !== 'running') throw new BadRequestException(`Job run is not running (status: ${run.status})`);
    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: { result: { phase, ...(message ? { message } : {}), updatedAt: new Date().toISOString() } },
    });
    return { ok: true };
  }

  async trySyncPlayersFromAllocs(_orgId: string, _serverInstanceId: string): Promise<{ needsLpStats: boolean } | false> {
    // Allocs/WebMap sync was 7DTD-only; Minecraft uses PLAYER_LIST_SYNC via the agent.
    return false;
  }

  private rosterDeaths(serverInstanceId: string, identityKey: string, playerId: string | null | undefined, live: number) {
    pruneMap(this.deathPins, (pin) => pin.until > Date.now());
    const keys = [playerId, `${serverInstanceId}:${identityKey}`].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const pin = this.deathPins.get(key);
      if (!pin || pin.until <= Date.now()) continue;
      if (live === pin.deaths) {
        for (const drop of keys) this.deathPins.delete(drop);
        return live;
      }
      return pin.deaths;
    }
    return live;
  }

  private async applyPlayerRoster(orgId: string, serverInstanceId: string, rows: PlayerRosterRow[]) {
    const now = new Date();
    const server = await this.prisma.serverInstance.findUnique({
      where: { id: serverInstanceId }, select: { name: true },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.identityKey);
      await reconcileNameFallback(this.prisma, serverInstanceId, row.identityKey, row.name, row.steamId, row.eosId);
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey: row.identityKey } } });
      const player = await this.prisma.player.upsert({
        where: { serverInstanceId_identityKey: { serverInstanceId, identityKey: row.identityKey } },
        create: {
          orgId,
          serverInstanceId,
          identityKey: row.identityKey,
          steamId: row.steamId,
          eosId: row.eosId,
          entityId: row.entityId > 0 ? row.entityId : null,
          ipAddress: row.ipAddress,
          name: row.name,
          online: true,
          currentSessionStartedAt: now,
          lastSeenAt: now,
          deaths: this.rosterDeaths(serverInstanceId, row.identityKey, null, row.deaths),
          level: row.level ?? 1,
          ...(row.position ? { lastPosX: row.position.x, lastPosY: row.position.y, lastPosZ: row.position.z } : {}),
        },
        update: {
          steamId: row.steamId ?? existing?.steamId,
          eosId: row.eosId ?? existing?.eosId,
          ...(row.entityId > 0 ? { entityId: row.entityId } : {}),
          ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
          name: row.name,
          online: true,
          lastSeenAt: now,
          ...(row.level != null ? { level: row.level } : {}),
          ...(row.zombieKills > 0 ? { zombieKills: row.zombieKills } : {}),
          ...(row.playerKills > 0 ? { playerKills: row.playerKills } : {}),
          ...(row.deaths > 0 || existing?.deaths == null
            ? { deaths: this.rosterDeaths(serverInstanceId, row.identityKey, existing?.id, row.deaths) }
            : {}),
          ...(row.position ? { lastPosX: row.position.x, lastPosY: row.position.y, lastPosZ: row.position.z } : {}),
          ...(!existing?.online ? { currentSessionStartedAt: now } : {}),
        },
      });
      if (!existing?.online) await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
      const previousLevel = existing?.level ?? 0;
      const newLevel = row.level ?? existing?.level ?? 1;
      if (row.level != null) {
        await this.triggers.evaluateLevel(orgId, serverInstanceId, {
          id: player.id,
          name: player.name,
          steamId: player.steamId,
          eosId: player.eosId,
          entityId: player.entityId,
          level: newLevel,
        }, previousLevel, newLevel).catch(() => undefined);
      }
      if (!existing?.online) {
        await this.triggers.retryPendingItemGrantsForPlayer(player.id).catch(() => undefined);
        const uuid = row.identityKey.startsWith('uuid:') ? row.identityKey.slice(5) : undefined;
        await this.alerts.sendMatchingRules('PLAYER_CONNECTED', {
          orgId,
          serverInstanceId,
          serverInstanceName: server?.name ?? 'Minecraft Server',
          playerName: player.name,
          minecraftUuid: uuid,
        }).catch(() => undefined);
      }
    }
    const missing = await this.prisma.player.findMany({ where: { serverInstanceId, online: true, identityKey: { notIn: [...seen] } } });
    for (const player of missing) {
      const end = player.lastSeenAt < now ? player.lastSeenAt : now;
      const duration = player.currentSessionStartedAt ? Math.max(0, Math.floor((end.getTime() - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
      await this.prisma.$transaction([
        this.prisma.player.update({ where: { id: player.id }, data: { online: false, currentSessionStartedAt: null, lastLogoutAt: end, lifetimeSeconds: { increment: duration } } }),
        this.prisma.playerSession.updateMany({ where: { playerId: player.id, endedAt: null }, data: { endedAt: end, durationSeconds: duration } }),
      ]);
      await this.alerts.sendMatchingRules('PLAYER_DISCONNECTED', {
        orgId,
        serverInstanceId,
        serverInstanceName: server?.name ?? 'Minecraft Server',
        playerName: player.name,
        minecraftUuid: player.identityKey.startsWith('uuid:') ? player.identityKey.slice(5) : undefined,
        sessionSeconds: duration,
      }).catch(() => undefined);
    }
    await this.enqueuePendingShopGrants(orgId, serverInstanceId).catch(() => undefined);
    await this.triggers.retryPendingItemGrants(orgId, serverInstanceId).catch(() => undefined);
  }

  private async storeInventorySnapshot(playerId: string, output: string) {
    await this.persistInventorySnapshot(playerId, parseInventoryOutput(output));
  }

  private async persistInventorySnapshot(playerId: string, snapshot: InventorySnapshot) {
    const itemCount = snapshot.bag.length + snapshot.belt.length + snapshot.equipment.length;
    // Do not replace a real snapshot with an empty one when a game build or
    // missing mod rejects the inventory command. The agent classifies command
    // errors as failed; this guard also protects against malformed responses.
    if (!itemCount) return;
    await this.prisma.player.updateMany({
      where: { id: playerId },
      data: {
        lastInventory: snapshot,
        lastInventoryAt: new Date(),
      },
    });
  }

  async enqueueShopGrants(orgId: string, serverInstanceId: string, playerId: string, _steamId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, orgId, serverInstanceId },
      select: { id: true, name: true, online: true, identityKey: true },
    });
    if (!player) return;
    await this.deliverShopGrantLines(orgId, serverInstanceId, player.id, player.name, player.identityKey, player.online, 8);
  }

  private async enqueuePendingShopGrants(orgId: string, serverInstanceId: string) {
    const online = await this.prisma.player.findMany({
      where: { orgId, serverInstanceId, online: true },
      select: { id: true, name: true, identityKey: true },
      take: 32,
    });
    for (const player of online) {
      await this.deliverShopGrantLines(orgId, serverInstanceId, player.id, player.name, player.identityKey, true, 8);
    }
  }

  private async deliverShopGrantLines(
    orgId: string,
    serverInstanceId: string,
    playerId: string,
    playerName: string,
    identityKey: string,
    online: boolean,
    limit: number,
  ) {
    const member = await this.prisma.userOrg.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    if (!member) return;
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const lines = await this.prisma.donationLine.findMany({
      where: {
        donation: { playerId, orgId, serverInstanceId, status: 'completed' },
        OR: [
          { grantStatus: { in: ['pending', 'queued'] } },
          { chatColorStatus: { in: ['pending', 'queued'] } },
        ],
      },
      take: 16,
    });
    const uuid = identityKey.startsWith('uuid:') ? identityKey.slice(5) : null;
    let queued = 0;
    for (const line of lines) {
      if (queued >= limit) break;
      const stale = !line.grantQueuedAt || line.grantQueuedAt < staleBefore;
      // Chat color has no vanilla Minecraft equivalent — mark delivered/skip.
      const colorDue = line.chatColorStatus === 'pending' || (line.chatColorStatus === 'queued' && stale);
      if (colorDue && line.chatColor && line.grantAttempts < MAX_GRANT_ATTEMPTS) {
        const command = buildChatColorCommand(playerName, line.chatColor);
        if (command && await this.queueShopGrantJob(orgId, member.userId, serverInstanceId, line.id, 'chat_color', command, { chatColorStatus: 'queued' })) {
          queued += 1;
        } else if (!command) {
          await this.prisma.donationLine.update({
            where: { id: line.id },
            data: { chatColorStatus: 'delivered' },
          });
        }
      }
      if (!online) continue;
      const grants = lineGrantItems(line.grantItems, line);
      for (let index = 0; index < grants.length; index += 1) {
        if (queued >= limit) break;
        const grant = grants[index];
        const due = grant.status === 'pending' || (grant.status === 'queued' && stale);
        if (!due || grant.attempts >= MAX_GRANT_ATTEMPTS) continue;
        const command = buildGiveCommand(playerName, grant.name, grant.quantity, grant.quality, uuid);
        if (!command) {
          grants[index] = { ...grant, status: 'failed', error: 'Invalid grant item' };
          await this.prisma.donationLine.update({
            where: { id: line.id },
            data: { grantItems: grants as Prisma.InputJsonValue, grantStatus: aggregateGrantStatus(grants), grantError: 'Invalid grant item' },
          });
          continue;
        }
        grants[index] = { ...grant, status: 'queued', attempts: grant.attempts + 1, error: null };
        if (await this.queueShopGrantJob(orgId, member.userId, serverInstanceId, line.id, 'item', command, {
          grantStatus: aggregateGrantStatus(grants),
          grantItems: grants as Prisma.InputJsonValue,
        }, index)) {
          queued += 1;
        } else {
          grants[index] = { ...grant, status: 'pending' };
        }
      }
    }
  }

  private async queueShopGrantJob(
    orgId: string,
    userId: string,
    serverInstanceId: string,
    donationLineId: string,
    grantKind: 'item' | 'chat_color',
    command: string,
    status: { grantStatus?: string; chatColorStatus?: string; grantItems?: Prisma.InputJsonValue },
    grantItemIndex?: number,
  ) {
    try {
      await this.prisma.donationLine.update({
        where: { id: donationLineId },
        data: {
          ...status,
          grantQueuedAt: new Date(),
          grantError: null,
          ...(grantKind === 'chat_color' ? { grantAttempts: { increment: 1 } } : {}),
        },
      });
      await this.createJob(orgId, userId, serverInstanceId, 'RCON', {
        command,
        purpose: 'shop_grant',
        donationLineId,
        grantKind,
        grantItemIndex,
      });
      return true;
    } catch {
      await this.prisma.donationLine.update({
        where: { id: donationLineId },
        data: grantKind === 'item' ? { grantStatus: 'pending' } : { chatColorStatus: 'pending' },
      }).catch(() => undefined);
      return false;
    }
  }

  private async finishShopGrant(payload: Record<string, unknown>, runStatus: string, output?: string) {
    const lineId = String(payload.donationLineId || '');
    if (!lineId) return;
    const outcome = classifyGrantOutput(output, runStatus);
    const next = outcome === 'delivered' ? 'delivered' : outcome === 'failed' ? 'failed' : 'pending';
    const error = next === 'delivered' ? null : String(output || 'Grant command failed').slice(0, 180);
    if (payload.grantKind === 'chat_color') {
      await this.prisma.donationLine.updateMany({
        where: { id: lineId },
        data: { chatColorStatus: next, grantError: error, grantedAt: next === 'delivered' ? new Date() : undefined },
      });
      return;
    }
    const line = await this.prisma.donationLine.findUnique({ where: { id: lineId } });
    if (!line) return;
    const grants = lineGrantItems(line.grantItems, line);
    const index = Number(payload.grantItemIndex);
    const target = Number.isInteger(index) && index >= 0 && index < grants.length
      ? index
      : grants.findIndex((item) => item.status === 'queued' || item.status === 'pending');
    if (target >= 0) {
      grants[target] = { ...grants[target], status: next, error };
    }
    const grantStatus = aggregateGrantStatus(grants);
    const grantError = grants.map((item) => item.error).filter(Boolean).join('; ').slice(0, 180) || null;
    await this.prisma.donationLine.update({
      where: { id: lineId },
      data: {
        grantItems: grants as Prisma.InputJsonValue,
        grantStatus,
        grantError,
        grantedAt: grantStatus === 'delivered' || grantStatus === 'partial' ? new Date() : undefined,
      },
    });
  }

  private async enforceConnectionTools(orgId:string,serverInstanceId:string,rows:PlayerRosterRow[]){
    const settings=await this.prisma.serverProtectionSettings.findUnique({where:{serverInstanceId}});
    if(!settings||(!settings.highPingEnabled&&!settings.countryBanEnabled))return;
    const member=await this.prisma.userOrg.findFirst({where:{orgId},orderBy:{createdAt:'asc'},select:{userId:true}});
    if(!member)return;
    for(const row of rows){
      const identifier=row.steamId||row.eosId||String(row.entityId);const key=`${serverInstanceId}:${identifier}`;
      if((this.protectionCooldown.get(key)||0)>Date.now())continue;
      if(settings.highPingEnabled&&row.ping!=null){
        const count=row.ping>settings.highPingThresholdMs?(this.badPingSamples.get(key)||0)+1:0;this.badPingSamples.set(key,count);
        if(count>=settings.highPingSamples){
          await this.createJob(orgId,member.userId,serverInstanceId,'PLAYER_KICK',{identifier,reason:`${settings.highPingReason} (${row.ping} ms)`});
          this.badPingSamples.set(key,0);this.protectionCooldown.set(key,Date.now()+5*60_000);continue;
        }
      }
      if(settings.countryBanEnabled){
        const ip=row.ipAddress;
        if(!ip||this.isPrivateAddress(ip))continue;
        const code=await this.countryForIp(ip);const blocked=Array.isArray(settings.blockedCountryCodes)?settings.blockedCountryCodes.map(String):[];
        if(code&&blocked.includes(code)){
          const type=settings.countryAction==='ban'?'PLAYER_BAN':'PLAYER_KICK';
          await this.createJob(orgId,member.userId,serverInstanceId,type,{identifier,reason:`${settings.countryReason} (${code})`,...(type==='PLAYER_BAN'?{duration:settings.countryBanDuration}:{})});
          this.protectionCooldown.set(key,Date.now()+24*60*60_000);
        }
      }
    }
  }
  private isPrivateAddress(ip:string){return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(ip);}
  private pruneProtectionState(now:number){
    pruneMap(this.protectionCooldown,(until)=>until>now);
    pruneMap(this.countryCache,(entry)=>entry.expires>now);
    if(this.badPingSamples.size>2_000)this.badPingSamples.clear();
  }
  private async countryForIp(ip:string){
    this.pruneProtectionState(Date.now());
    const cached=this.countryCache.get(ip);if(cached&&cached.expires>Date.now())return cached.code;
    try{const response=await fetch(`https://api.country.is/${encodeURIComponent(ip)}`,{signal:AbortSignal.timeout(3000)});if(!response.ok)return'';const data=await response.json() as {country?:string};const code=String(data.country||'').toUpperCase();if(/^[A-Z]{2}$/.test(code)){this.countryCache.set(ip,{code,expires:Date.now()+24*60*60_000});return code;}}catch{return'';}return'';
  }
}
