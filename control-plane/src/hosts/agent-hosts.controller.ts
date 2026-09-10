import { Controller, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { HostsService, HeartbeatMetrics } from './hosts.service';
import { AgentAuthGuard, RequestWithAgent } from '../pairing/agent-auth.guard';
import { ServerInstancesService } from '../server-instances/server-instances.service';

class HeartbeatDto {
  @IsOptional()
  @IsObject()
  metrics?: HeartbeatMetrics;
}

class DiscoverMinecraftServerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  installPath?: string;

  @IsOptional()
  @IsString()
  startCommand?: string;

  @IsOptional()
  @IsString()
  telnetHost?: string;

  @IsOptional()
  @IsInt()
  telnetPort?: number;

  @IsOptional()
  @IsString()
  telnetPassword?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

@Controller('api/agent/hosts')
export class AgentHostsController {
  constructor(
    private readonly hostsService: HostsService,
    private readonly serverInstancesService: ServerInstancesService,
  ) {}

  /**
   * Agent heartbeat endpoint.
   * Host identity comes from the verified JWT (req.agentHostId), NOT the path param.
   * AgentAuthGuard has already validated the host's orgId from the JWT payload,
   * so we pass only the hostId and let the service resolve the org scope.
   */
  @Post(':hostId/heartbeat')
  @UseGuards(AgentAuthGuard)
  async heartbeat(
    @Param('hostId') _pathHostId: string,
    @Body() dto: HeartbeatDto,
    @Req() req: RequestWithAgent,
  ) {
    // agentHostId is set by AgentAuthGuard from the verified JWT — always trust this
    const hostId = req.agentHostId!;

    // recordHeartbeatByHostIdOnly fetches the host's orgId and then calls recordHeartbeat.
    // The AgentAuthGuard already validated that this hostId belongs to a legitimate org,
    // so no additional org-scope check is needed here.
    await this.hostsService.recordHeartbeatByHostIdOnly(hostId, dto.metrics);

    return { ok: true };
  }

  @Post(':hostId/server-instances/discover/minecraft')
  @UseGuards(AgentAuthGuard)
  async discoverMinecraft(
    @Param('hostId') _pathHostId: string,
    @Body() dto: DiscoverMinecraftServerDto,
    @Req() req: RequestWithAgent,
  ) {
    const hostId = req.agentHostId!;
    return this.serverInstancesService.upsertDiscoveredMinecraftInstance(hostId, dto);
  }
}
