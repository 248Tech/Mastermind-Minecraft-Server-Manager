import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_ATTEMPTS } from './constants';

// BullMQ job data shape stored in queue
export interface QueueJobData {
  jobId: string;
  jobRunId: string;
  hostId: string;
  serverInstanceId?: string;
  type: string;
  payload: unknown;
  /** Set when this job was dispatched by the scheduler. */
  scheduleId?: string;
}

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

@Injectable()
export class JobsQueueService implements OnModuleDestroy {
  private orgQueues = new Map<string, Queue<QueueJobData>>();

  async onModuleDestroy(): Promise<void> {
    for (const q of this.orgQueues.values()) await q.close();
    this.orgQueues.clear();
  }

  getQueue(orgId: string): Queue<QueueJobData> {
    if (!this.orgQueues.has(orgId)) {
      this.orgQueues.set(
        orgId,
        new Queue<QueueJobData>(`jobs-${orgId}`, { connection: REDIS_CONNECTION }),
      );
    }
    return this.orgQueues.get(orgId)!;
  }

  async addJob(orgId: string, data: QueueJobData): Promise<void> {
    const queue = this.getQueue(orgId);
    await queue.add(data.type, data, {
      jobId: data.jobRunId, // BullMQ job ID = jobRunId for dedup
      attempts: JOB_ATTEMPTS,
      backoff: { type: 'exponential' as const, delay: 2000 },
    });
  }

  /**
   * Get the next pending job from the org queue that matches this hostId.
   * BullMQ doesn't support per-host filtering natively, so we inspect waiting jobs.
   * For MVP (single host per org usually), this returns the first waiting job for the host.
   */
  async getNextJobForHost(orgId: string, hostId: string, mutationBusy = false): Promise<QueueJobData | null> {
    const queue = this.getQueue(orgId);
    // Get waiting jobs (up to 50 to find matching hostId)
    const waiting = await queue.getJobs(['waiting', 'delayed'], 0, 499);
    for (const job of waiting) {
      if (job.data.hostId === hostId) {
        if (mutationBusy && !this.isReadOnly(job.data.type)) continue;
        // Move job to active by promoting it
        try {
          if (job.delay > 0) await job.changeDelay(0);
          // We "claim" it by removing from queue; agent will submit result
          await job.remove();
          return job.data;
        } catch {
          // Job may have been taken concurrently
          continue;
        }
      }
    }
    return null;
  }

  private isReadOnly(type: string): boolean {
    // Keep this allowlist aligned with the agent. Arbitrary RCON and
    // SEND_COMMAND payloads can mutate game state and must stay behind the
    // per-host mutation gate.
    return ['MOD_LIST','MOD_QUARANTINE_LIST','MOD_PENDING_LIST','MOD_CONFIG_READ','SERVER_CONFIG_READ','PLAYER_LIST_SYNC','PLAYER_ADMIN_LIST','SAVE_LIST','ITEM_CATALOG'].includes(type);
  }
}
