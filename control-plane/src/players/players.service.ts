import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { reconcileNameFallback } from './player-identity';

@Injectable()
export class PlayersService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private polling = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}
  onModuleInit() {
    const seconds = Math.max(15, Number(process.env.PLAYER_POLL_INTERVAL_SEC || 60));
    this.timer = setInterval(() => void this.pollPlayers(), seconds * 1000);
    setTimeout(() => void this.pollPlayers(), 5000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async pollPlayers() {
    if (this.polling) return;
    this.polling = true;
    try {
      const servers = await this.prisma.serverInstance.findMany({
        where: { gameType: { slug: 'minecraft' } }, select: { id: true, orgId: true, host: { select: { lastMetrics: true } } },
      });
      for (const server of servers) {
        const metrics = (server.host.lastMetrics ?? {}) as Record<string, unknown>;
        if (metrics.gameReachable !== true) continue;
        const member = await this.prisma.userOrg.findFirst({ where: { orgId: server.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
        if (!member) continue;
        const recent = await this.prisma.job.findFirst({ where: { serverInstanceId: server.id, type: 'PLAYER_LIST_SYNC', createdAt: { gte: new Date(Date.now() - 45_000) } } });
        if (!recent) await this.jobs.createJob(server.orgId, member.userId, server.id, 'PLAYER_LIST_SYNC', {});
      }
    } finally { this.polling = false; }
  }
  async getProtectionSettings(orgId:string,serverInstanceId:string){
    const server=await this.prisma.serverInstance.findFirst({where:{id:serverInstanceId,orgId}});
    if(!server)throw new NotFoundException('Server instance not found');
    return this.prisma.serverProtectionSettings.upsert({where:{serverInstanceId},create:{serverInstanceId},update:{}});
  }
  async updateProtectionSettings(orgId:string,serverInstanceId:string,body:Record<string,unknown>){
    const server=await this.prisma.serverInstance.findFirst({where:{id:serverInstanceId,orgId}});
    if(!server)throw new NotFoundException('Server instance not found');
    const threshold=Number(body.highPingThresholdMs??250),samples=Number(body.highPingSamples??3);
    if(!Number.isInteger(threshold)||threshold<50||threshold>5000)throw new BadRequestException('Ping threshold must be 50-5000 ms');
    if(!Number.isInteger(samples)||samples<2||samples>20)throw new BadRequestException('Bad sample count must be 2-20');
    const codes=Array.isArray(body.blockedCountryCodes)?[...new Set(body.blockedCountryCodes.map(String).map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z]{2}$/.test(x)))]:[];
    const action=body.countryAction==='ban'?'ban':'kick';
    const clean=(value:unknown,fallback:string,max=200)=>String(value??fallback).replace(/[\r\n]/g,' ').trim().slice(0,max)||fallback;
    return this.prisma.serverProtectionSettings.upsert({where:{serverInstanceId},create:{serverInstanceId,highPingEnabled:Boolean(body.highPingEnabled),highPingThresholdMs:threshold,highPingSamples:samples,highPingReason:clean(body.highPingReason,'Connection latency remained too high'),countryBanEnabled:Boolean(body.countryBanEnabled),blockedCountryCodes:codes,countryAction:action,countryBanDuration:clean(body.countryBanDuration,'365 days',40),countryReason:clean(body.countryReason,'Connections from your country are not allowed')},update:{highPingEnabled:Boolean(body.highPingEnabled),highPingThresholdMs:threshold,highPingSamples:samples,highPingReason:clean(body.highPingReason,'Connection latency remained too high'),countryBanEnabled:Boolean(body.countryBanEnabled),blockedCountryCodes:codes,countryAction:action,countryBanDuration:clean(body.countryBanDuration,'365 days',40),countryReason:clean(body.countryReason,'Connections from your country are not allowed')}});
  }
  async list(orgId: string, serverInstanceId?: string) {
    const stablePlayers = await this.prisma.player.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}), NOT: { identityKey: { startsWith: 'name:' } } },
    });
    for (const player of stablePlayers) {
      await reconcileNameFallback(this.prisma, player.serverInstanceId, player.identityKey, player.name, player.steamId, player.eosId);
    }
    const now = Date.now();
    const players = await this.prisma.player.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: [{ online: 'desc' }, { lastSeenAt: 'desc' }],
    });
    return players.map(p => {
      const sessionSeconds = p.online && p.currentSessionStartedAt ? Math.max(0, Math.floor((now - p.currentSessionStartedAt.getTime()) / 1000)) : 0;
      return { ...p, sessionSeconds, lifetimeSeconds: p.lifetimeSeconds + sessionSeconds };
    });
  }

  async inventory(orgId: string, playerId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, orgId },
      select: { id: true, name: true },
    });
    if (!player) throw new NotFoundException('Player not found');
    throw new BadRequestException('Live inventory is not available for Minecraft servers yet');
  }
}
