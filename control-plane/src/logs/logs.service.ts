import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { reconcileNameFallback } from '../players/player-identity';
import { AlertsService } from '../alerts/alerts.service';
import { JobsQueueService } from '../jobs/jobs-queue.service';
import { pruneMap } from '../common/ttl-map';

type ModerationAction = 'log'|'warn'|'kick';
type BadWordRule = { word:string; action:ModerationAction };
type ChatModeration = { enabled:boolean; badWordRules:BadWordRule[]; badWords:string[]; badWordAction:ModerationAction; floodEnabled:boolean; floodMessages:number; floodWindowSeconds:number; floodAction:ModerationAction; mutedPlayers:Array<{playerId:string;playerName:string;createdAt:string}> };

@Injectable()
export class LogsService {
  private readonly lastPrune = new Map<string, number>();
  private readonly scanTails = new Map<string, string>();
  private readonly lineBuffers = new Map<string, string>();
  private readonly chatLineBuffers = new Map<string, string>();
  private readonly chatSamples = new Map<string, number[]>();
  private readonly moderationCooldown = new Map<string, number>();
  private lastMapPrune = 0;
  constructor(private readonly prisma: PrismaService, private readonly alerts: AlertsService, private readonly jobsQueue: JobsQueueService) {}

  async append(hostId: string, serverInstanceId: string, content: string) {
    if (!content) return { ok: true };
    if (content.length > 65536) throw new BadRequestException('Log chunk exceeds 64 KiB');
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, hostId }, select: { id: true, orgId: true, name: true },
    });
    if (!server) throw new NotFoundException('Server instance not found for agent host');
    await this.prisma.serverLog.create({ data: { orgId: server.orgId, serverInstanceId: server.id, content } });
    // Parsers enrich a persisted chunk. One enrichment failure must not reject
    // the upload and force the agent to replay chat or Discord deliveries.
    await this.matchKeywordAlerts(server.orgId, server.id, content).catch(() => undefined);
    await this.parseChat(server.orgId, server.id, server.name, content).catch(() => undefined);
    await this.parsePlayers(server.orgId, server.id, server.name, content).catch(() => undefined);
    await this.retryChatRelays(server.orgId, server.id).catch(() => undefined);
    await this.prune(server.orgId);
    return { ok: true };
  }

  private async parseChat(orgId: string, serverInstanceId: string, serverInstanceName: string, content: string) {
    const combined = (this.chatLineBuffers.get(serverInstanceId) ?? '') + content;
    const lines = combined.split(/\r?\n/);
    this.chatLineBuffers.set(serverInstanceId, lines.pop()?.slice(-4096) ?? '');
    for (const line of lines) {
      // Minecraft / Paper / NeoForge: "<Name> message" or "[Not Secure] <Name> message"
      const mcMatch = line.match(/\]:\s*(?:\[Not Secure\]\s*)?<([^>\n]{1,32})>\s+(.+)$/);
      // Legacy 7DTD chat (ignored once removed, but harmless during transition)
      const playerMatch = line.match(/\bChat \(from '([^']+)', entity id '([^']+)', to '([^']+)'\): '(.*)': (.*)$/);
      const serverMatch = line.match(/\bChat \(from '-non-player-', entity id '-1', to '([^']+)'\): (.*)$/);
      if (!mcMatch && !playerMatch && !serverMatch) continue;
      const isServer = !!serverMatch;
      const playerId = mcMatch ? mcMatch[1] : isServer ? '-non-player-' : playerMatch![1];
      const entityId = mcMatch ? '' : isServer ? '-1' : playerMatch![2];
      const channel = mcMatch ? 'Global' : isServer ? serverMatch![1] : playerMatch![3];
      const rawName = mcMatch ? mcMatch[1] : isServer ? 'Server' : playerMatch![4];
      const rawMessage = mcMatch ? mcMatch[2] : isServer ? serverMatch![2] : playerMatch![5];
      const playerName = rawName.trim().slice(0, 128);
      const message = rawMessage.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 2000);
      if (!playerName || !message) continue;
      const logTimestamp = line.match(/^(\S+)/)?.[1] ?? '';
      if (logTimestamp) {
        const duplicate = await this.prisma.event.findFirst({ where: {
          orgId, sourceId: serverInstanceId, eventType: 'player_chat',
          payload: { path: ['logTimestamp'], equals: logTimestamp },
        }, select: { id: true } });
        if (duplicate) continue;
      }
      const event = await this.prisma.event.create({ data: { orgId, sourceType: 'server_instance', sourceId: serverInstanceId, eventType: 'player_chat',
        payload: { playerId, entityId, playerName, channel, message, serverInstanceName, logTimestamp } } });
      if (isServer) continue;
      const moderated = await this.moderateChat(orgId, serverInstanceId, playerId, playerName, message).catch(() => false);
      if (moderated) continue;
      const relay = await this.alerts.relayPlayerChat({ eventId: event.id, orgId, serverInstanceId, serverInstanceName, playerName, playerId, channel, message });
      if (relay.configured && !relay.sent) {
        await this.prisma.event.create({ data: { orgId, sourceType: 'server_instance', sourceId: serverInstanceId, eventType: 'player_chat_relay_pending',
          payload: { eventId: event.id, orgId, serverInstanceId, serverInstanceName, playerName, playerId, channel, message, lastError: relay.error } } });
      }
    }
  }

  private moderationDefaults(): ChatModeration { return { enabled:false,badWordRules:[],badWords:[],badWordAction:'warn',floodEnabled:true,floodMessages:5,floodWindowSeconds:10,floodAction:'kick',mutedPlayers:[] }; }

  private moderationAction(value:unknown, fallback:ModerationAction='log'):ModerationAction {
    return ['log','warn','kick'].includes(String(value)) ? value as ModerationAction : fallback;
  }

  private cleanBadWordRules(value:unknown, fallbackAction:ModerationAction):BadWordRule[] {
    if (!Array.isArray(value)) return [];
    const seen=new Set<string>();const result:BadWordRule[]=[];
    for(const item of value){
      const record:Record<string,unknown>=typeof item==='object'&&item!==null?item as Record<string,unknown>:{word:item};
      const word=String(record.word??'').trim().toLowerCase();
      if(!word||word.length>80||seen.has(word))continue;
      seen.add(word);result.push({word,action:this.moderationAction(record.action,fallbackAction)});
      if(result.length===200)break;
    }
    return result;
  }

  async getChatModeration(orgId:string, serverInstanceId:string):Promise<ChatModeration> {
    const rules=await this.prisma.alertRule.findMany({where:{orgId,condition:{path:['type'],equals:'chat_moderation'}}});
    const rule=rules.find(item=>(item.condition as Record<string,unknown>).serverInstanceId===serverInstanceId);
    const condition=(rule?.condition??{}) as Record<string,unknown>;
    if(!rule)return this.moderationDefaults();
    const legacyAction=this.moderationAction(condition.badWordAction,'warn');
    const sourceRules=Array.isArray(condition.badWordRules)?condition.badWordRules:Array.isArray(condition.badWords)?condition.badWords:[];
    const badWordRules=this.cleanBadWordRules(sourceRules,legacyAction);
    return {...this.moderationDefaults(),...condition,enabled:rule.enabled,badWordRules,badWords:badWordRules.map(item=>item.word),badWordAction:legacyAction,mutedPlayers:Array.isArray(condition.mutedPlayers)?condition.mutedPlayers as ChatModeration['mutedPlayers']:[]} as ChatModeration;
  }

  async updateChatModeration(orgId:string, serverInstanceId:string, input:Partial<ChatModeration>) {
    const server=await this.prisma.serverInstance.findFirst({where:{id:serverInstanceId,orgId},select:{name:true}});if(!server)throw new NotFoundException('Server instance not found');
    const current=await this.getChatModeration(orgId,serverInstanceId);
    const legacyAction=this.moderationAction(input.badWordAction??current.badWordAction,'warn');
    const requestedRules=input.badWordRules!==undefined?input.badWordRules:input.badWords!==undefined?input.badWords:current.badWordRules;
    const badWordRules=this.cleanBadWordRules(requestedRules,legacyAction);
    const settings:ChatModeration={...current,...input,badWordRules,badWords:badWordRules.map(item=>item.word),badWordAction:legacyAction,floodAction:this.moderationAction(input.floodAction??current.floodAction,current.floodAction),floodMessages:Math.min(30,Math.max(2,Number(input.floodMessages??current.floodMessages))),floodWindowSeconds:Math.min(300,Math.max(2,Number(input.floodWindowSeconds??current.floodWindowSeconds)))};
    const rules=await this.prisma.alertRule.findMany({where:{orgId}});const existing=rules.find(r=>{const c=r.condition as Record<string,unknown>;return c.type==='chat_moderation'&&c.serverInstanceId===serverInstanceId;});
    const data={name:`Chat moderation: ${server.name}`,enabled:settings.enabled,condition:{type:'chat_moderation',serverInstanceId,...settings},channel:{type:'dashboard'}};
    if(existing)await this.prisma.alertRule.update({where:{id:existing.id},data});else await this.prisma.alertRule.create({data:{orgId,...data}});return settings;
  }

  async setPlayerMuted(orgId:string,serverInstanceId:string,playerId:string,playerName:string,muted:boolean){
    const current=await this.getChatModeration(orgId,serverInstanceId);const cleanId=playerId.trim().slice(0,128);if(!cleanId)throw new BadRequestException('Player ID required');
    current.mutedPlayers=current.mutedPlayers.filter(p=>p.playerId!==cleanId);if(muted)current.mutedPlayers.push({playerId:cleanId,playerName:playerName.trim().slice(0,128)||cleanId,createdAt:new Date().toISOString()});
    return this.updateChatModeration(orgId,serverInstanceId,current);
  }

  private async moderateChat(orgId:string,serverInstanceId:string,playerId:string,playerName:string,message:string):Promise<boolean>{
    const cfg=await this.getChatModeration(orgId,serverInstanceId);if(!cfg.enabled)return false;const now=Date.now();this.pruneModerationState(now);const key=`${serverInstanceId}:${playerId}`;const cutoff=now-cfg.floodWindowSeconds*1000;const samples=(this.chatSamples.get(key)??[]).filter(t=>t>=cutoff);samples.push(now);this.chatSamples.set(key,samples);
    const muted=cfg.mutedPlayers.some(p=>p.playerId===playerId);const bad=cfg.badWordRules.find(rule=>message.toLowerCase().includes(rule.word));const flood=cfg.floodEnabled&&samples.length>cfg.floodMessages;if(!muted&&!bad&&!flood)return false;
    const reason=muted?'Player is muted':bad?`Blocked word: ${bad.word}`:'Chat flooding';const action=muted?'kick':bad?bad.action:cfg.floodAction;
    await this.prisma.event.create({data:{orgId,sourceType:'server_instance',sourceId:serverInstanceId,eventType:'chat_moderation_action',payload:{playerId,playerName,message,reason,action}}});
    if(action!=='log'&&(this.moderationCooldown.get(key)??0)<now){this.moderationCooldown.set(key,now+5000);const command=action==='warn'?`say "${playerName.replace(/["\\]/g,'')} warning: ${reason}"`:`kick ${playerId.replace(/[^A-Za-z0-9_:-]/g,'')} "Chat moderation: ${reason.replace(/["\\]/g,'')}"`;await this.enqueueModerationCommand(orgId,serverInstanceId,command);}
    return true;
  }

  private async enqueueModerationCommand(orgId:string,serverInstanceId:string,command:string){
    const server=await this.prisma.serverInstance.findFirst({where:{id:serverInstanceId,orgId},include:{gameType:{select:{slug:true}}}});if(!server)return;
    const payload={server_instance_id:server.id,game_type:server.gameType.slug,install_path:server.installPath??undefined,start_command:server.startCommand??undefined,telnet_host:server.telnetHost??undefined,telnet_port:server.telnetPort??undefined,telnet_password:server.telnetPassword??undefined,config:server.config??undefined,command};
    const job=await this.prisma.job.create({data:{orgId,serverInstanceId,type:'RCON',payload}});const run=await this.prisma.jobRun.create({data:{jobId:job.id,hostId:server.hostId,status:'pending'}});await this.jobsQueue.addJob(orgId,{jobId:job.id,jobRunId:run.id,hostId:server.hostId,serverInstanceId,type:'RCON',payload});
  }

  private async retryChatRelays(orgId: string, serverInstanceId: string) {
    const pending = await this.prisma.event.findMany({
      where: { orgId, sourceId: serverInstanceId, eventType: 'player_chat_relay_pending' },
      orderBy: { createdAt: 'asc' }, take: 10,
    });
    for (const row of pending) {
      const payload = row.payload as Record<string, unknown>;
      const result = await this.alerts.relayPlayerChat({
        eventId: String(payload.eventId ?? row.id), orgId, serverInstanceId,
        serverInstanceName: String(payload.serverInstanceName ?? 'Minecraft Server'),
        playerName: String(payload.playerName ?? 'Unknown'), playerId: String(payload.playerId ?? 'unknown'),
        channel: String(payload.channel ?? 'Global'), message: String(payload.message ?? ''),
      });
      if (result.sent || !result.configured) await this.prisma.event.delete({ where: { id: row.id } });
    }
  }

  async listChat(orgId: string, serverInstanceId?: string, limit = 200) {
    return this.prisma.event.findMany({ where: { orgId, eventType: 'player_chat', ...(serverInstanceId ? { sourceId: serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit || 200, 1), 500) }).then(rows => rows.reverse());
  }

  async getChatSettings(orgId: string, serverInstanceId: string) {
    const rules = await this.prisma.alertRule.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    const rule = rules.find(item => { const c=item.condition as Record<string,unknown>; return c?.type==='chat_relay'&&c.serverInstanceId===serverInstanceId; });
    const channel = rule?.channel as Record<string,unknown>|undefined;
    return { enabled: rule?.enabled ?? false, webhookUrl: String(channel?.webhookUrl ?? '') };
  }

  async updateChatSettings(orgId: string, serverInstanceId: string, enabled: boolean, webhookUrl: string) {
    const server = await this.prisma.serverInstance.findFirst({ where: { id: serverInstanceId, orgId }, select: { id: true, name: true } });
    if (!server) throw new NotFoundException('Server instance not found');
    const clean = webhookUrl.trim();
    if (enabled) {
      let parsed: URL; try { parsed=new URL(clean); } catch { throw new BadRequestException('Valid Discord webhook URL required'); }
      if (parsed.protocol!=='https:'||!['discord.com','discordapp.com'].includes(parsed.hostname.toLowerCase())||!parsed.pathname.startsWith('/api/webhooks/')) throw new BadRequestException('Valid Discord webhook URL required');
    }
    const rules = await this.prisma.alertRule.findMany({ where: { orgId } });
    const existing = rules.find(item => { const c=item.condition as Record<string,unknown>; return c?.type==='chat_relay'&&c.serverInstanceId===serverInstanceId; });
    const data = { name: `Chat relay: ${server.name}`, enabled, condition: { type: 'chat_relay', serverInstanceId }, channel: { type: 'discord', webhookUrl: clean } };
    if (existing) await this.prisma.alertRule.update({ where: { id: existing.id }, data });
    else await this.prisma.alertRule.create({ data: { orgId, ...data } });
    return { enabled, webhookUrl: clean };
  }

  private async parsePlayers(orgId: string, serverInstanceId: string, serverInstanceName: string, content: string) {
    const combined = (this.lineBuffers.get(serverInstanceId) ?? '') + content;
    const lines = combined.split(/\r?\n/);
    this.lineBuffers.set(serverInstanceId, lines.pop()?.slice(-4096) ?? '');
    for (const line of lines) {
      const uuidLine = line.match(/UUID of player ([A-Za-z0-9_]{1,16}) is ([0-9a-fA-F-]{32,36})/i);
      if (uuidLine) {
        const name = uuidLine[1];
        const uuid = uuidLine[2].toLowerCase();
        const identityKey = `uuid:${uuid}`;
        await reconcileNameFallback(this.prisma, serverInstanceId, identityKey, name, null, null);
        await this.prisma.player.upsert({
          where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
          create: { orgId, serverInstanceId, identityKey, name, online: false, lastSeenAt: new Date() },
          update: { name },
        });
        continue;
      }

      const joined = /:\s*([A-Za-z0-9_]{1,16}) joined the game\b/i.test(line)
        || /GMSG: Player '.*' joined the game/i.test(line)
        || /PlayerSpawnedInWorld\s*\(reason:\s*(?:EnterMultiplayer|JoinMultiplayer)\b/i.test(line);
      const left = /:\s*([A-Za-z0-9_]{1,16}) left the game\b/i.test(line)
        || /PlayerDisconnected|GMSG: Player '.*' left/i.test(line);
      if (!joined && !left) continue;

      const mcName = line.match(/:\s*([A-Za-z0-9_]{1,16}) (?:joined|left) the game\b/i)?.[1];
      const steam = line.match(/(?:PltfmId|OwnerID)\s*=\s*'?Steam_([0-9]{15,20})'?/i)?.[1]
        ?? line.match(/\b(7656119[0-9]{10})\b/)?.[1];
      const eos = line.match(/(?:CrossId|PltfmId)\s*=\s*'?EOS_([a-f0-9]{20,64})'?/i)?.[1];
      const entityText = line.match(/EntityID[=:]\s*([0-9]+)/i)?.[1];
      const name = (mcName
        ?? line.match(/PlayerName\s*=\s*'?([^',\r\n]+)'?/i)?.[1]
        ?? line.match(/GMSG: Player '([^']+)'/i)?.[1])?.trim();
      const identityKey = steam ? `steam:${steam}` : eos ? `eos:${eos}` : name ? `name:${name.toLowerCase()}` : '';
      if (!identityKey || !name) continue;
      await reconcileNameFallback(this.prisma, serverInstanceId, identityKey, name, steam ?? null, eos ?? null);
      const now = new Date();
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } } });
      if (joined) {
        const player = await this.prisma.player.upsert({
          where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
          create: { orgId, serverInstanceId, identityKey, steamId: steam, eosId: eos, entityId: entityText ? Number(entityText) : null, name, online: true, currentSessionStartedAt: now, lastSeenAt: now },
          update: { steamId: steam ?? existing?.steamId, eosId: eos ?? existing?.eosId, entityId: entityText ? Number(entityText) : existing?.entityId, name, online: true, lastSeenAt: now, ...(!existing?.online ? { currentSessionStartedAt: now } : {}) },
        });
        if (!existing?.online) {
          await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
          await this.alerts.sendMatchingRules('PLAYER_CONNECTED', { orgId, serverInstanceId, serverInstanceName, playerName: name, steamId: steam, eosId: eos }).catch(() => undefined);
        }
      } else if (existing?.online) {
        const started = existing.currentSessionStartedAt;
        const duration = started ? Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000)) : 0;
        await this.prisma.$transaction([
          this.prisma.player.update({ where: { id: existing.id }, data: { online: false, lastSeenAt: now, currentSessionStartedAt: null, lastLogoutAt: now, lifetimeSeconds: { increment: duration } } }),
          this.prisma.playerSession.updateMany({ where: { playerId: existing.id, endedAt: null }, data: { endedAt: now, durationSeconds: duration } }),
        ]);
        await this.alerts.sendMatchingRules('PLAYER_DISCONNECTED', { orgId, serverInstanceId, serverInstanceName, playerName: name, steamId: steam ?? existing.steamId ?? undefined, eosId: eos ?? existing.eosId ?? undefined, sessionSeconds: duration }).catch(() => undefined);
      }
    }
  }

  async listKeywordRules(orgId: string) {
    const rules = await this.prisma.alertRule.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    return rules.filter(r => (r.condition as Record<string, unknown>)?.type === 'log_keyword').map(r => ({
      id: r.id, name: r.name, enabled: r.enabled, condition: r.condition, createdAt: r.createdAt,
    }));
  }

  async createKeywordRule(orgId: string, serverInstanceId: string, keyword: string, caseSensitive = false) {
    const clean = keyword.trim();
    if (!clean || clean.length > 200) throw new BadRequestException('Keyword must contain 1-200 characters');
    const server = await this.prisma.serverInstance.findFirst({ where: { id: serverInstanceId, orgId }, select: { id: true } });
    if (!server) throw new NotFoundException('Server instance not found');
    return this.prisma.alertRule.create({ data: {
      orgId, name: `Log: ${clean}`, enabled: true,
      condition: { type: 'log_keyword', serverInstanceId, keyword: clean, caseSensitive },
      channel: { type: 'dashboard' },
    }});
  }

  async setKeywordRuleEnabled(orgId: string, id: string, enabled: boolean) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id, orgId } });
    if (!rule || (rule.condition as Record<string, unknown>)?.type !== 'log_keyword') throw new NotFoundException('Keyword rule not found');
    return this.prisma.alertRule.update({ where: { id }, data: { enabled } });
  }

  async deleteKeywordRule(orgId: string, id: string) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id, orgId } });
    if (!rule || (rule.condition as Record<string, unknown>)?.type !== 'log_keyword') throw new NotFoundException('Keyword rule not found');
    await this.prisma.alertRule.delete({ where: { id } });
  }

  async listKeywordMatches(orgId: string, serverInstanceId?: string, limit = 50) {
    const rows = await this.prisma.event.findMany({
      where: { orgId, eventType: 'log_keyword_match', ...(serverInstanceId ? { sourceId: serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
    });
    return rows;
  }

  private async matchKeywordAlerts(orgId: string, serverInstanceId: string, content: string) {
    const prior = this.scanTails.get(serverInstanceId) ?? '';
    const searchable = prior + content;
    this.scanTails.set(serverInstanceId, searchable.slice(-256));
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      select: { id: true, name: true },
    });
    const rules = await this.prisma.alertRule.findMany({ where: { orgId, enabled: true } });
    for (const rule of rules) {
      const condition = rule.condition as Record<string, unknown>;
      if (condition?.type !== 'log_keyword' || condition.serverInstanceId !== serverInstanceId) continue;
      const keyword = String(condition.keyword ?? '');
      if (!keyword) continue;
      const haystack = condition.caseSensitive ? searchable : searchable.toLowerCase();
      const needle = condition.caseSensitive ? keyword : keyword.toLowerCase();
      const index = haystack.lastIndexOf(needle);
      if (index < 0 || index + needle.length <= prior.length) continue;
      const start = Math.max(0, index - 180);
      const end = Math.min(searchable.length, index + needle.length + 180);
      const excerpt = searchable.slice(start, end);
      await this.prisma.event.create({ data: {
        orgId, sourceType: 'server_instance', sourceId: serverInstanceId,
        eventType: 'log_keyword_match',
        payload: { ruleId: rule.id, ruleName: rule.name, keyword, excerpt },
      }});
      await this.alerts.sendMatchingRules('LOG_KEYWORD', {
        orgId,
        serverInstanceId,
        serverInstanceName: server?.name,
        ruleId: rule.id,
        keyword,
        ruleName: rule.name,
        excerpt,
      }).catch(() => undefined);
    }
  }

  async getSettings(orgId: string) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { logRetentionDays: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateSettings(orgId: string, logRetentionDays: number) {
    if (![1, 7, 30].includes(logRetentionDays)) {
      throw new BadRequestException('Retention must be 1, 7, or 30 days');
    }
    const settings = await this.prisma.org.update({
      where: { id: orgId }, data: { logRetentionDays }, select: { logRetentionDays: true },
    });
    this.lastPrune.delete(orgId);
    await this.prune(orgId);
    return settings;
  }

  private async prune(orgId: string) {
    const now = Date.now();
    if (now - (this.lastPrune.get(orgId) ?? 0) < 60_000) return;
    this.lastPrune.set(orgId, now);
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { logRetentionDays: true } });
    if (!org) return;
    await this.prisma.serverLog.deleteMany({
      where: { orgId, createdAt: { lt: new Date(now - org.logRetentionDays * 86_400_000) } },
    });
    await this.prisma.event.deleteMany({
      where: {
        orgId,
        createdAt: { lt: new Date(now - org.logRetentionDays * 86_400_000) },
        eventType: { in: ['player_chat', 'player_chat_relay_pending', 'log_keyword_match', 'chat_moderation_action'] },
      },
    });
  }

  private pruneModerationState(now: number) {
    if (now - this.lastMapPrune < 60_000) return;
    this.lastMapPrune = now;
    const sampleCutoff = now - 10 * 60_000;
    pruneMap(this.chatSamples, (samples) => samples.some((t) => t >= sampleCutoff));
    pruneMap(this.moderationCooldown, (until) => until >= now);
  }

  async list(orgId: string, serverInstanceId?: string, limit = 250, afterId?: string) {
    const take = Math.min(Math.max(limit || 250, 1), 1000);
    if (afterId) {
      const cursor = await this.prisma.serverLog.findFirst({
        where: { id: afterId, orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
        select: { createdAt: true },
      });
      if (cursor) {
        return this.prisma.serverLog.findMany({
          where: {
            orgId,
            ...(serverInstanceId ? { serverInstanceId } : {}),
            createdAt: { gte: cursor.createdAt },
            NOT: { id: afterId },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take,
          select: { id: true, serverInstanceId: true, content: true, createdAt: true },
        });
      }
    }
    const rows = await this.prisma.serverLog.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take,
      select: { id: true, serverInstanceId: true, content: true, createdAt: true },
    });
    return rows.reverse();
  }
}
