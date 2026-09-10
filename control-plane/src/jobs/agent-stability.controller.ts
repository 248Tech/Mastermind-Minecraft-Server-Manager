import { BadRequestException, Controller, Body, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { PrismaService } from '../prisma.service';
import { AgentAuthGuard } from '../pairing/agent-auth.guard';
import type { RequestWithAgent } from '../pairing/agent-auth.guard';

@Controller('api/agent/stability')
@UseGuards(AgentAuthGuard)
export class AgentStabilityController {
  constructor(private readonly jobsService: JobsService, private readonly prisma: PrismaService) {}

  /** Mastermind owns the policy; the local watcher only reports measured usage. */
  @Post('evaluate')
  async evaluate(@Req() req: RequestWithAgent, @Body() body: { serverInstanceId?: unknown; memoryBytes?: unknown }) {
    const hostId = req.agentHostId!;
    const serverInstanceId = typeof body.serverInstanceId === 'string' ? body.serverInstanceId.trim() : '';
    const memoryBytes = Number(body.memoryBytes);
    if (!serverInstanceId || !Number.isSafeInteger(memoryBytes) || memoryBytes < 0) {
      throw new BadRequestException('serverInstanceId and a non-negative integer memoryBytes are required');
    }
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, hostId, gameType: { slug: 'minecraft' } },
      include: { org: { select: { stabilityRestartEnabled: true, stabilityRestartMemoryGiB: true, stabilityRestartCooldownMinutes: true } } },
    });
    if (!server) throw new NotFoundException('Minecraft server instance not found on this host');
    if (!server.org.stabilityRestartEnabled) return { triggered: false, reason: 'disabled' };

    const limitBytes = server.org.stabilityRestartMemoryGiB * 1024 * 1024 * 1024;
    if (memoryBytes < limitBytes) return { triggered: false, reason: 'below_limit', limitBytes };
    const active = await this.prisma.jobRun.findFirst({
      where: { hostId, status: { in: ['pending', 'running'] }, job: { serverInstanceId: server.id, type: 'SERVER_SAFE_RESTART' } }, select: { id: true },
    });
    if (active) return { triggered: false, reason: 'restart_already_queued', jobRunId: active.id };
    const cooldownSince = new Date(Date.now() - server.org.stabilityRestartCooldownMinutes * 60_000);
    const recent = await this.prisma.job.findFirst({
      where: { serverInstanceId: server.id, type: 'SERVER_SAFE_RESTART', createdAt: { gte: cooldownSince } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (recent) return { triggered: false, reason: 'cooldown', cooldownUntil: new Date(recent.createdAt.getTime() + server.org.stabilityRestartCooldownMinutes * 60_000).toISOString() };

    const job = await this.jobsService.enqueueInternalJob(server.orgId, null, server.id, 'SERVER_SAFE_RESTART', {
      retention_count: 10, trigger: 'stability_memory', stability_memory_bytes: memoryBytes, stability_memory_limit_bytes: limitBytes,
    });
    return { triggered: true, reason: 'memory_limit', limitBytes, ...job };
  }
}
