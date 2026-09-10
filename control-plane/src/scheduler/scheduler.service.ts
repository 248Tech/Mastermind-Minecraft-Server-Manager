import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { getNextCronRun, clampToExecutionWindow } from './cron-next';
import type { ScheduleJobData } from './scheduler.types';
import type { QueueJobData } from '../jobs/jobs-queue.service';

const SCHEDULER_QUEUE_NAME = 'scheduler';
const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private schedulerQueue: Queue<ScheduleJobData> | null = null;
  private worker: Worker<ScheduleJobData> | null = null;
  private orgQueues = new Map<string, Queue<QueueJobData>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.schedulerQueue = new Queue<ScheduleJobData>(SCHEDULER_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
    });
    this.worker = new Worker<ScheduleJobData>(
      SCHEDULER_QUEUE_NAME,
      (job) => this.processScheduleFire(job),
      { connection: REDIS_CONNECTION, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => this.handleWorkerFailure(job, err));
    try {
      await this.hydrateSchedules();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Skipping initial schedule hydration: ${reason}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.schedulerQueue) await this.schedulerQueue.close();
    for (const q of this.orgQueues.values()) await q.close();
  }

  /** Load all enabled schedules and enqueue delayed jobs for next run. */
  async hydrateSchedules(): Promise<void> {
    const schedules = await this.prisma.schedule.findMany({
      where: { enabled: true },
      include: { serverInstance: { include: { host: true, gameType: true, org: true } } },
    });
    const now = new Date();
    for (const s of schedules) {
      const nextRun = this.computeNextRun(s, now);
      if (!nextRun) continue;
      const delayMs = Math.max(0, nextRun.getTime() - now.getTime());
      await this.schedulerQueue!.add(
        'schedule_fire',
        { scheduleId: s.id },
        {
          jobId: `schedule:${s.id}:${nextRun.getTime()}`,
          delay: delayMs,
        },
      );
      await this.prisma.schedule.update({
        where: { id: s.id },
        data: { nextRunAt: nextRun },
      });
    }
  }

  private computeNextRun(
    s: { cronExpression: string; executionWindowStart: string | null; executionWindowEnd: string | null },
    from: Date,
  ): Date | null {
    try {
      let next = getNextCronRun(s.cronExpression, from);
      next = clampToExecutionWindow(next, s.executionWindowStart, s.executionWindowEnd);
      return next;
    } catch {
      return null;
    }
  }

  private async processScheduleFire(job: Job<ScheduleJobData>): Promise<void> {
    const { scheduleId } = job.data;
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { serverInstance: { include: { host: true, gameType: true, org: true } } },
    });
    if (!schedule || !schedule.enabled) return;
    const hostId = schedule.serverInstance.hostId;
    const orgId = schedule.orgId;
    const serverInstanceId = schedule.serverInstanceId;
    const effectiveJobType =
      schedule.serverInstance.gameType.slug === 'minecraft' && schedule.jobType.toUpperCase() === 'SERVER_RESTART'
        ? 'SERVER_SAFE_RESTART'
        : schedule.jobType;

    if (schedule.skipNextRun && this.isRestartJob(schedule.jobType)) {
      const nextRun = this.computeNextRun(schedule, new Date());
      const status = schedule.skipNextRunReason === 'stability_restart'
        ? 'skipped_stability_restart'
        : 'skipped_by_operator';
      await this.prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: status,
          nextRunAt: nextRun ?? undefined,
          skipNextRun: false,
          skipNextRunReason: null,
          skipNextRunRequestedAt: null,
        },
      });
      if (nextRun) {
        await this.schedulerQueue!.add(
          'schedule_fire',
          { scheduleId },
          { jobId: `schedule:${schedule.id}:${nextRun.getTime()}`, delay: Math.max(0, nextRun.getTime() - Date.now()) },
        );
      }
      this.logger.log(`Skipped scheduled restart ${schedule.id}: ${status}`);
      return;
    }
    const configuredPayload = (schedule.payload as Record<string, unknown> | null) ?? {};
    const mergedPayload = {
      server_instance_id: schedule.serverInstance.id,
      game_type: schedule.serverInstance.gameType.slug,
      install_path: schedule.serverInstance.installPath ?? undefined,
      start_command: schedule.serverInstance.startCommand ?? undefined,
      rcon_host: schedule.serverInstance.rconHost ?? undefined,
      rcon_port: schedule.serverInstance.rconPort ?? undefined,
      rcon_password: schedule.serverInstance.rconPassword ?? undefined,
      config: schedule.serverInstance.config ?? undefined,
      schedule_id: schedule.id,
      ...configuredPayload,
    };

    // Do not stack periodic work while the previous occurrence still waits or
    // runs. A missed backup interval is safer than an unbounded mutation queue.
    const activeRun = await this.prisma.jobRun.findFirst({ where: {
      status: { in: ['pending', 'running'] },
      job: { serverInstanceId, type: effectiveJobType, payload: { path: ['schedule_id'], equals: schedule.id } },
    }});
    if (activeRun) {
      const nextRun = this.computeNextRun(schedule, new Date());
      await this.prisma.schedule.update({ where: { id: scheduleId }, data: { lastRunAt: new Date(), lastRunStatus: 'skipped_busy', nextRunAt: nextRun ?? undefined } });
      if (nextRun) await this.schedulerQueue!.add('schedule_fire', { scheduleId }, { jobId: `schedule:${scheduleId}:${nextRun.getTime()}`, delay: Math.max(0, nextRun.getTime()-Date.now()) });
      return;
    }

    let createdJobId: string | null = null;
    try {
      const createdJob = await this.prisma.job.create({
        data: {
          orgId,
          serverInstanceId,
          type: effectiveJobType,
          payload: mergedPayload as Prisma.InputJsonValue,
          createdById: null,
        },
      });
      const run = await this.prisma.jobRun.create({
        data: { jobId: createdJob.id, hostId, status: 'pending' },
      });
      createdJobId = createdJob.id;

      const retryPolicy = (schedule.retryPolicy as { maxRetries?: number; backoffMs?: number }) ?? {};
      const attempts = (retryPolicy.maxRetries ?? 2) + 1;
      const backoff = retryPolicy.backoffMs ?? 2000;

      const orgQueue = this.getOrgQueue(orgId);
      await orgQueue.add(
        effectiveJobType,
        {
          jobId: createdJob.id,
          jobRunId: run.id,
          hostId,
          serverInstanceId,
          type: effectiveJobType,
          payload: mergedPayload,
          scheduleId: schedule.id,
        },
        { jobId: run.id, attempts, backoff: { type: 'fixed' as const, delay: backoff } },
      );

      const nextRun = this.computeNextRun(schedule, new Date());
      await this.prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'success',
          lastRunJobId: createdJob.id,
          runCount: { increment: 1 },
          nextRunAt: nextRun ?? undefined,
        },
      });

      if (nextRun) {
        const delayMs = Math.max(0, nextRun.getTime() - Date.now());
        await this.schedulerQueue!.add(
          'schedule_fire',
          { scheduleId },
          { jobId: `schedule:${scheduleId}:${nextRun.getTime()}`, delay: delayMs },
        );
      }
    } catch (err) {
      const nextRun = this.computeNextRun(schedule, new Date());
      await this.prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'scheduler_failed',
          lastRunJobId: createdJobId,
          failureCount: { increment: 1 },
          nextRunAt: nextRun ?? undefined,
        },
      });
      if (nextRun) {
        const delayMs = Math.max(0, nextRun.getTime() - Date.now());
        await this.schedulerQueue!.add(
          'schedule_fire',
          { scheduleId },
          { jobId: `schedule:${scheduleId}:${nextRun.getTime()}`, delay: delayMs },
        );
      }
      throw err;
    }
  }

  private async handleWorkerFailure(job: Job<ScheduleJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const scheduleId = (job.data as ScheduleJobData).scheduleId;
    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        lastRunStatus: 'scheduler_failed',
        failureCount: { increment: 1 },
      },
    });
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async listSchedules(orgId: string) {
    const rows = await this.prisma.schedule.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => this.toDto(s));
  }

  /** Skip the nearest enabled automatic restart for one server exactly once. */
  async skipNextAutoRestart(orgId: string, serverInstanceId: string, reason: 'manual' | 'stability_restart') {
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        orgId,
        serverInstanceId,
        enabled: true,
        jobType: { in: ['SERVER_RESTART', 'SERVER_SAFE_RESTART'] },
        nextRunAt: { not: null, gte: new Date() },
      },
      orderBy: { nextRunAt: 'asc' },
    });
    if (!schedule) return { skipped: false, reason: 'no_scheduled_restart' as const };
    if (schedule.skipNextRun) {
      return { skipped: false, reason: 'already_skipped' as const, scheduleId: schedule.id, nextRunAt: schedule.nextRunAt?.toISOString() ?? null };
    }
    const updated = await this.prisma.schedule.update({
      where: { id: schedule.id },
      data: { skipNextRun: true, skipNextRunReason: reason, skipNextRunRequestedAt: new Date() },
    });
    return { skipped: true, scheduleId: updated.id, scheduleName: updated.name, nextRunAt: updated.nextRunAt?.toISOString() ?? null };
  }

  async createSchedule(
    orgId: string,
    userId: string,
    data: {
      name: string;
      serverInstanceId: string;
      cronExpression: string;
      jobType: string;
      payload?: unknown;
      enabled?: boolean;
    },
  ) {
    const now = new Date();
    let nextRunAt: Date | null = null;
    try {
      nextRunAt = getNextCronRun(data.cronExpression, now);
    } catch {
      throw new Error(`Invalid cron expression: ${data.cronExpression}`);
    }

    const schedule = await this.prisma.schedule.create({
      data: {
        orgId,
        serverInstanceId: data.serverInstanceId,
        name: data.name,
        cronExpression: data.cronExpression,
        jobType: data.jobType,
        payload: data.payload !== undefined ? (data.payload as Prisma.InputJsonValue) : undefined,
        enabled: data.enabled ?? true,
        nextRunAt,
        createdById: userId,
      },
    });

    if (schedule.enabled && nextRunAt && this.schedulerQueue) {
      const delayMs = Math.max(0, nextRunAt.getTime() - now.getTime());
      await this.schedulerQueue.add(
        'schedule_fire',
        { scheduleId: schedule.id },
        { jobId: `schedule:${schedule.id}:${nextRunAt.getTime()}`, delay: delayMs },
      );
    }

    return this.toDto(schedule);
  }

  async updateSchedule(
    orgId: string,
    scheduleId: string,
    data: { enabled?: boolean; name?: string; cronExpression?: string; jobType?: string; payload?: unknown },
  ) {
    const existing = await this.prisma.schedule.findFirst({ where: { id: scheduleId, orgId } });
    if (!existing) throw new Error('Schedule not found');

    const cronExpression = data.cronExpression ?? existing.cronExpression;
    let nextRunAt = existing.nextRunAt;
    if (data.cronExpression) {
      try {
        nextRunAt = getNextCronRun(cronExpression, new Date());
      } catch {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }
    }

    const updated = await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.cronExpression !== undefined && { cronExpression, nextRunAt }),
        ...(data.jobType !== undefined && { jobType: data.jobType }),
        ...(data.payload !== undefined && { payload: data.payload as Prisma.InputJsonValue }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
    });

    if (existing.nextRunAt && this.schedulerQueue) {
      await this.schedulerQueue.remove(`schedule:${existing.id}:${existing.nextRunAt.getTime()}`).catch(() => false);
    }
    // Re-enqueue if enabled (BullMQ dedupes by jobId)
    if (updated.enabled && updated.nextRunAt && this.schedulerQueue) {
      const delayMs = Math.max(0, updated.nextRunAt.getTime() - Date.now());
      await this.schedulerQueue.add(
        'schedule_fire',
        { scheduleId: updated.id },
        { jobId: `schedule:${updated.id}:${updated.nextRunAt.getTime()}`, delay: delayMs },
      );
    }

    return this.toDto(updated);
  }

  async deleteSchedule(orgId: string, scheduleId: string): Promise<void> {
    const existing = await this.prisma.schedule.findFirst({ where: { id: scheduleId, orgId } });
    if (!existing) throw new Error('Schedule not found');
    await this.prisma.schedule.delete({ where: { id: scheduleId } });
  }

  private toDto(s: {
    id: string; orgId: string; serverInstanceId: string; name: string;
    cronExpression: string; jobType: string; enabled: boolean;
    payload: Prisma.JsonValue;
    nextRunAt: Date | null; lastRunAt: Date | null; lastRunStatus: string | null;
    skipNextRun: boolean; skipNextRunReason: string | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: s.id,
      orgId: s.orgId,
      serverInstanceId: s.serverInstanceId,
      name: s.name,
      cronExpression: s.cronExpression,
      jobType: s.jobType,
      payload: s.payload,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastRunStatus: s.lastRunStatus,
      skipNextRun: s.skipNextRun,
      skipNextRunReason: s.skipNextRunReason,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private getOrgQueue(orgId: string): Queue<QueueJobData> {
    if (!this.orgQueues.has(orgId)) {
      this.orgQueues.set(
        orgId,
        new Queue<QueueJobData>(`jobs-${orgId}`, { connection: REDIS_CONNECTION }),
      );
    }
    return this.orgQueues.get(orgId)!;
  }

  private isRestartJob(jobType: string) {
    return ['SERVER_RESTART', 'SERVER_SAFE_RESTART'].includes(jobType.toUpperCase());
  }
}
