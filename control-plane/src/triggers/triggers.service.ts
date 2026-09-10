import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import {
  TRIGGER_ACTION_GRANT_ITEMS,
  TRIGGER_ACTIONS,
  TRIGGER_EVENTS,
  grantItemsSummary,
  parseGrantItemsActionConfig,
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

const NO_EVENTS_MESSAGE = 'Level triggers require Minecraft progression sync (not yet available)';

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

  async create(_orgId: string, _userId: string, _input: TriggerInput) {
    throw new BadRequestException(NO_EVENTS_MESSAGE);
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
      throw new BadRequestException(NO_EVENTS_MESSAGE);
    }
    const data: { name?: string; enabled?: boolean } = {};
    if (input.name != null) {
      const name = input.name.trim();
      if (!name || name.length > 80) throw new BadRequestException('Name is required (max 80 characters)');
      data.name = name;
    }
    if (input.enabled != null) data.enabled = input.enabled;
    if (Object.keys(data).length === 0) return current;
    return this.prisma.trigger.update({ where: { id: current.id }, data });
  }

  async remove(orgId: string, id: string) {
    await this.requireTrigger(orgId, id);
    await this.prisma.trigger.delete({ where: { id } });
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
      include: { trigger: true, player: { select: { id: true, name: true, steamId: true } } },
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
        trigger: { enabled: true, actionType: TRIGGER_ACTION_GRANT_ITEMS },
      },
      include: { trigger: true, player: { select: { id: true, name: true, steamId: true } } },
      take: 16,
    });
    for (const fire of fires) {
      await this.enqueueGrantItems(fire.trigger, fire.player, fire.eventKey, false).catch(() => undefined);
    }
  }

  private async enqueueGrantItems(
    trigger: { id: string; orgId: string; serverInstanceId: string; createdById: string | null; actionConfig: unknown },
    player: { id: string; name: string; steamId: string | null },
    eventKey: string,
    recordFire: boolean,
  ) {
    const action = parseGrantItemsActionConfig(trigger.actionConfig);
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
    const levelHint = eventKey.startsWith('level:') ? eventKey.slice(6) : '';
    const queued = await this.jobs.enqueueInternalJob(trigger.orgId, trigger.createdById, trigger.serverInstanceId, 'TRIGGER_GRANT_ITEMS', {
      triggerId: trigger.id,
      triggerFireId: fireId,
      playerId: player.id,
      steamId: player.steamId,
      name: player.name,
      items: action.items,
      notifyPlayer: action.notifyPlayer,
      message: action.message
        .replaceAll('{name}', player.name)
        .replaceAll('{level}', levelHint)
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

  private async requireTrigger(orgId: string, id: string) {
    const trigger = await this.prisma.trigger.findFirst({ where: { id, orgId } });
    if (!trigger) throw new NotFoundException('Trigger not found');
    return trigger;
  }
}
