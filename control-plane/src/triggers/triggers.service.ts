import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import {
  TRIGGER_ACTION_GRANT_ITEMS,
  TRIGGER_ACTIONS,
  TRIGGER_EVENT_PLAYER_LEVEL,
  TRIGGER_EVENTS,
  eventKeyForLevel,
  grantItemsSummary,
  parseGrantItemsActionConfig,
  parsePlayerLevelConfig,
  playerReachedLevel,
  type GrantItemsActionConfig,
  type PlayerLevelConfig,
} from './catalog';
import { classifyGrantOutput } from '../donations/shop-grants';

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
      include: { player: { select: { id: true, name: true, steamId: true, level: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(orgId: string, userId: string, input: TriggerInput) {
    await this.requireServer(orgId, input.serverInstanceId);
    const data = this.validatedData(input);
    const trigger = await this.prisma.trigger.create({
      data: { orgId, createdById: userId, ...data },
    });
    if (trigger.applyToExisting && trigger.enabled) {
      await this.applyToExistingPlayers(trigger.id).catch(() => undefined);
    }
    return trigger;
  }

  async update(orgId: string, id: string, input: Partial<TriggerInput>) {
    const current = await this.requireTrigger(orgId, id);
    const merged: TriggerInput = {
      name: input.name ?? current.name,
      serverInstanceId: input.serverInstanceId ?? current.serverInstanceId,
      enabled: input.enabled ?? current.enabled,
      eventType: input.eventType ?? current.eventType,
      eventConfig: input.eventConfig ?? current.eventConfig,
      actionType: input.actionType ?? current.actionType,
      actionConfig: input.actionConfig ?? current.actionConfig,
      applyToExisting: input.applyToExisting ?? current.applyToExisting,
    };
    if (merged.serverInstanceId !== current.serverInstanceId) {
      await this.requireServer(orgId, merged.serverInstanceId);
    }
    const data = this.validatedData(merged);
    const trigger = await this.prisma.trigger.update({ where: { id: current.id }, data });
    if (trigger.applyToExisting && trigger.enabled) {
      await this.applyToExistingPlayers(trigger.id).catch(() => undefined);
    }
    return trigger;
  }

  async remove(orgId: string, id: string) {
    await this.requireTrigger(orgId, id);
    await this.prisma.trigger.delete({ where: { id } });
  }

  async evaluateLevel(
    orgId: string,
    serverInstanceId: string,
    player: { id: string; name: string; steamId: string | null; entityId: number | null; level: number },
    previousLevel: number,
    newLevel: number,
  ) {
    if (!Number.isInteger(newLevel) || newLevel < 1) return;
    const triggers = await this.prisma.trigger.findMany({
      where: { orgId, serverInstanceId, enabled: true, eventType: TRIGGER_EVENT_PLAYER_LEVEL },
    });
    for (const trigger of triggers) {
      const event = parsePlayerLevelConfig(trigger.eventConfig);
      const crossed = playerReachedLevel(event.comparison, previousLevel, newLevel, event.level);
      if (!crossed) {
        if (!trigger.applyToExisting || newLevel < event.level) continue;
        const existingFire = await this.prisma.triggerFire.findUnique({
          where: { triggerId_playerId_eventKey: { triggerId: trigger.id, playerId: player.id, eventKey: eventKeyForLevel(event.level) } },
        });
        if (existingFire) continue;
      }
      await this.fireTrigger(trigger, player, event.level).catch(() => undefined);
    }
  }

  async applyToExistingPlayers(triggerId: string) {
    const trigger = await this.prisma.trigger.findUnique({ where: { id: triggerId } });
    if (!trigger || !trigger.enabled) return;
    const event = parsePlayerLevelConfig(trigger.eventConfig);
    const players = await this.prisma.player.findMany({
      where: { serverInstanceId: trigger.serverInstanceId, level: { gte: event.level } },
      select: { id: true, name: true, steamId: true, entityId: true, level: true },
    });
    for (const player of players) {
      await this.fireTrigger(trigger, player, event.level).catch(() => undefined);
    }
  }

  async completeItemGrant(payload: Record<string, unknown>, runStatus: string, output: string) {
    const fireId = typeof payload.triggerFireId === 'string' ? payload.triggerFireId : '';
    if (!fireId) return;
    const outcome = classifyGrantOutput(output, runStatus);
    const status = outcome === 'delivered' ? 'delivered' : outcome === 'failed' ? 'failed' : 'pending';
    await this.prisma.triggerFire.updateMany({ where: { id: fireId }, data: { status } });
  }

  async retryPendingItemGrants(orgId: string, serverInstanceId: string) {
    const fires = await this.prisma.triggerFire.findMany({
      where: {
        status: 'pending',
        trigger: { orgId, serverInstanceId, enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
        player: { online: true, steamId: { not: null } },
      },
      include: { trigger: true, player: { select: { id: true, name: true, steamId: true, entityId: true, level: true } } },
      take: 32,
    });
    for (const fire of fires) {
      const event = parsePlayerLevelConfig(fire.trigger.eventConfig);
      await this.enqueueGrantItems(fire.trigger, fire.player, event.level, false).catch(() => undefined);
    }
  }

  async retryPendingItemGrantsForPlayer(playerId: string) {
    const fires = await this.prisma.triggerFire.findMany({
      where: {
        playerId,
        status: 'pending',
        trigger: { enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
      },
      include: { trigger: true, player: { select: { id: true, name: true, steamId: true, entityId: true, level: true } } },
      take: 16,
    });
    for (const fire of fires) {
      const event = parsePlayerLevelConfig(fire.trigger.eventConfig);
      await this.enqueueGrantItems(fire.trigger, fire.player, event.level, false).catch(() => undefined);
    }
  }

  private async fireTrigger(
    trigger: { id: string; actionType: string },
    player: { id: string; name: string; steamId: string | null; entityId: number | null; level: number },
    level: number,
  ) {
    if (trigger.actionType === TRIGGER_ACTION_GRANT_ITEMS) {
      await this.fireGrantItems(trigger.id, player, level);
    }
  }

  private async fireGrantItems(
    triggerId: string,
    player: { id: string; name: string; steamId: string | null; entityId: number | null; level: number },
    level: number,
  ) {
    const trigger = await this.prisma.trigger.findUnique({ where: { id: triggerId } });
    if (!trigger) return;
    await this.enqueueGrantItems(trigger, player, level, true);
  }

  private async enqueueGrantItems(
    trigger: { id: string; orgId: string; serverInstanceId: string; createdById: string | null; actionConfig: unknown },
    player: { id: string; name: string; steamId: string | null; entityId: number | null; level: number },
    level: number,
    recordFire: boolean,
  ) {
    const action = parseGrantItemsActionConfig(trigger.actionConfig);
    const eventKey = eventKeyForLevel(level);
    const summary = grantItemsSummary(action.items);
    let fireId: string | null = null;
    if (recordFire) {
      try {
        const fire = await this.prisma.triggerFire.create({
          data: { triggerId: trigger.id, playerId: player.id, eventKey, status: player.steamId ? 'queued' : 'failed' },
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
    if (!player.steamId) {
      if (fireId) await this.prisma.triggerFire.update({ where: { id: fireId }, data: { status: 'failed' } });
      return;
    }
    const queued = await this.jobs.enqueueInternalJob(trigger.orgId, trigger.createdById, trigger.serverInstanceId, 'TRIGGER_GRANT_ITEMS', {
      triggerId: trigger.id,
      triggerFireId: fireId,
      playerId: player.id,
      steamId: player.steamId,
      entityId: player.entityId,
      name: player.name,
      items: action.items,
      notifyPlayer: action.notifyPlayer,
      message: action.message
        .replaceAll('{name}', player.name)
        .replaceAll('{level}', String(player.level))
        .replaceAll('{items}', summary),
    });
    if (recordFire && fireId) {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { jobId: queued.jobId, status: 'queued' },
      });
      await this.prisma.trigger.update({
        where: { id: trigger.id },
        data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
      });
    } else if (fireId) {
      await this.prisma.triggerFire.update({
        where: { id: fireId },
        data: { jobId: queued.jobId, status: 'queued' },
      });
    }
  }

  private validatedData(input: TriggerInput) {
    const name = input.name?.trim();
    if (!name || name.length > 80) throw new BadRequestException('Name is required (max 80 characters)');
    if (input.eventType !== TRIGGER_EVENT_PLAYER_LEVEL) throw new BadRequestException('Unsupported trigger event');
    if (input.actionType !== TRIGGER_ACTION_GRANT_ITEMS) {
      throw new BadRequestException('Unsupported trigger action');
    }
    let eventConfig: PlayerLevelConfig;
    let actionConfig: GrantItemsActionConfig;
    try {
      eventConfig = parsePlayerLevelConfig(input.eventConfig);
      actionConfig = parseGrantItemsActionConfig(input.actionConfig);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid trigger configuration');
    }
    return {
      name,
      serverInstanceId: input.serverInstanceId,
      enabled: input.enabled !== false,
      eventType: TRIGGER_EVENT_PLAYER_LEVEL,
      eventConfig: eventConfig as unknown as Prisma.InputJsonValue,
      actionType: input.actionType,
      actionConfig: actionConfig as unknown as Prisma.InputJsonValue,
      applyToExisting: input.applyToExisting === true,
    };
  }

  private async requireServer(orgId: string, serverInstanceId: string) {
    const server = await this.prisma.serverInstance.findFirst({ where: { id: serverInstanceId, orgId } });
    if (!server) throw new BadRequestException('Server instance not found');
  }

  private async requireTrigger(orgId: string, id: string) {
    const trigger = await this.prisma.trigger.findFirst({ where: { id, orgId } });
    if (!trigger) throw new NotFoundException('Trigger not found');
    return trigger;
  }
}
