import { Injectable, BadRequestException, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { makePasswordHash } from '../auth/auth.service';
import {decryptOpenAiKey,encryptOpenAiKey} from './openai-crypto';
import { encryptIntegrationSecret, decryptIntegrationSecret } from './integration-crypto';
import { MailgunService } from '../mailgun/mailgun.service';
import { AuthRateLimitService, LOGIN_LOCKOUT_POLICY } from '../auth/auth-rate-limit.service';
import { parseStripeSecretKey, parseStripeWebhookSecret } from '../donations/donations.stripe';

function publicStripeWebhookUrl() {
  const origin = (process.env.PUBLIC_WEB_URL || '').replace(/\/$/, '');
  return origin ? `${origin}/api/donations/stripe/webhook` : '/api/donations/stripe/webhook';
}

export function normalizeMaintenancePassword(password: string): string {
  const value = password.trim();
  if (value.length < 4 || value.length > 32) {
    throw new BadRequestException('Maintenance password must be 4 to 32 characters');
  }
  if (!/^[\x21-\x7e]+$/.test(value) || /[<>&"']/.test(value)) {
    throw new BadRequestException('Maintenance password cannot contain spaces or XML characters < > & " \'');
  }
  return value;
}

@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService, private readonly mailgun: MailgunService, private readonly authRateLimit:AuthRateLimitService) {}

  async getSecuritySettings(orgId:string) {
    const org=await this.prisma.org.findUnique({where:{id:orgId},select:{recaptchaSiteKey:true,recaptchaSecretEncrypted:true}});
    if(!org)throw new NotFoundException('Organization not found');
    const memberships=await this.prisma.userOrg.findMany({where:{orgId},include:{user:{select:{id:true,email:true,name:true}},role:true},orderBy:{createdAt:'asc'}});
    const accounts=await Promise.all(memberships.map(async membership=>{
      const state=await this.authRateLimit.getAccountState(membership.user.email);
      return{id:membership.user.id,email:membership.user.email,name:membership.user.name,role:membership.role.name,failedAttempts:state.failures,lockoutLevel:state.lockoutLevel,blockedUntil:state.blockedUntil,locked:Boolean(state.blockedUntil&&state.blockedUntil>new Date()),attemptsRemaining:Math.max(0,3-state.failures)};
    }));
    return{attemptsPerStage:3,lockoutPolicy:LOGIN_LOCKOUT_POLICY,mathChallengeEnabled:true,registrationIpQuotaEnabled:true,registrationIpLimit:2,recaptchaConfigured:Boolean(org.recaptchaSiteKey&&org.recaptchaSecretEncrypted),recaptchaSiteKey:org.recaptchaSiteKey||'',accounts};
  }

  async saveRecaptchaSettings(orgId:string,userId:string,input:{siteKey:string;secretKey?:string}) {
    const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{recaptchaSecretEncrypted:true}});
    if(!existing)throw new NotFoundException('Organization not found');
    const siteKey=input.siteKey.trim(),secret=input.secretKey?.trim();
    if(!/^[A-Za-z0-9_-]{20,256}$/.test(siteKey))throw new ConflictException('Enter a valid reCAPTCHA site key');
    if(!secret&&!existing.recaptchaSecretEncrypted)throw new ConflictException('reCAPTCHA secret key is required');
    if(secret&&!/^[A-Za-z0-9_-]{10,512}$/.test(secret))throw new ConflictException('Enter a valid reCAPTCHA secret key');
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{recaptchaSiteKey:siteKey,...(secret?{recaptchaSecretEncrypted:encryptIntegrationSecret(secret)}:{})}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'recaptcha_settings_updated',resourceType:'org',resourceId:orgId,details:{siteKeyReplaced:true,secretReplaced:Boolean(secret)}}}),
    ]);
    return{ok:true,configured:true,siteKey};
  }

  async clearRecaptchaSettings(orgId:string,userId:string) {
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{recaptchaSiteKey:null,recaptchaSecretEncrypted:null}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'recaptcha_settings_cleared',resourceType:'org',resourceId:orgId}}),
    ]);
    return{ok:true,configured:false};
  }

  getProfileEditorCredit(orgId: string) {
    return {
      orgId,
      name: '7 Days to Die TTP Profile Editor',
      upstreamAuthor: 'RussDev7 / DannyRuss',
      upstreamRepository: 'https://github.com/RussDev7/7D2DProfileEditor',
      upstreamCommit: '270f998adf70f3724afd93ba0e08569e3ba78c95',
      license: 'GNU GPL v3',
      acknowledgements: ['kani-momonga/7DaysProfileEditorPHP', 'Karlovsky120/7DaysProfileEditor'],
      integration: 'Isolated upstream service proxied by Mastermind; source profiles are never overwritten automatically.',
    };
  }

  async getAccounts(orgId: string) {
    const [memberships, players] = await Promise.all([this.prisma.userOrg.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true, approvedAt: true, emailVerifiedAt: true, passwordHash: true } }, role: true },
      orderBy: { createdAt: 'asc' },
    }), this.prisma.player.findMany({ where: { orgId }, select: { name: true, steamId: true } })]);
    const steamByName = new Map(players.filter(player => player.steamId).map(player => [player.name.trim().toLocaleLowerCase(), player.steamId as string]));
    return memberships.map(membership => ({
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role.name,
      createdAt: membership.user.createdAt,
      approvedAt: membership.user.approvedAt,
      emailVerifiedAt: membership.user.emailVerifiedAt,
      signInEnabled: Boolean(membership.user.passwordHash),
      steamLinked: Boolean(membership.user.name && steamByName.has(membership.user.name.trim().toLocaleLowerCase())),
      steamIdLast4: membership.user.name ? (steamByName.get(membership.user.name.trim().toLocaleLowerCase()) || '').slice(-4) || null : null,
    }));
  }

  async createAccount(orgId: string, actingUserId: string, input: { email: string; password: string; name?: string; role: 'operator' | 'viewer' }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const role = await this.resolveRole(input.role);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name?.trim() || null,
        passwordHash: makePasswordHash(input.password),
        emailVerifiedAt: new Date(),
        approvedAt: new Date(),
        approvedById: actingUserId,
        userOrgs: { create: { orgId, roleId: role.id } },
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    return { ...user, role: role.name, approvedAt: new Date(), emailVerifiedAt: new Date(), signInEnabled: true };
  }

  async setAccountApproval(orgId: string, accountId: string, actingUserId: string, approved: boolean) {
    if (accountId === actingUserId) throw new ForbiddenException('You cannot change your own approval status');
    const [actor, target] = await Promise.all([
      this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId: actingUserId, orgId } }, include: { role: true } }),
      this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId: accountId, orgId } },
        include: { role: true, user: { select: { email: true, emailVerifiedAt: true, passwordHash: true, approvedAt: true } } },
      }),
    ]);
    if (actor?.role.name !== 'admin') throw new ForbiddenException('Only organization administrators may approve accounts');
    if (!target) throw new NotFoundException('Organization account not found');
    if (target.role.name === 'admin') throw new ForbiddenException('Administrator approval cannot be changed here');
    if (approved && !target.user.emailVerifiedAt) throw new ConflictException('Email confirmation is required before approval');
    if (approved && !target.user.passwordHash) throw new ConflictException('Sign-in is disabled for this account');
    if (Boolean(target.user.approvedAt) === approved) return { ok: true, approvedAt: target.user.approvedAt };

    const approvedAt = approved ? new Date() : null;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: accountId },
        data: { approvedAt, approvedById: approved ? actingUserId : null, authVersion: { increment: 1 } },
      }),
      this.prisma.auditLog.create({
        data: {
          orgId,
          actorId: actingUserId,
          action: approved ? 'account_approved' : 'account_access_revoked',
          resourceType: 'user',
          resourceId: accountId,
          details: { targetEmail: target.user.email },
        },
      }),
    ]);
    return { ok: true, approvedAt };
  }

  async deleteAccount(orgId: string, accountId: string, actingUserId: string) {
    if (accountId === actingUserId) throw new ForbiddenException('You cannot delete your own account');
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId: accountId, orgId } },
      include: { role: true, user: { select: { email: true, _count: { select: { userOrgs: true } } } } },
    });
    if (!membership) throw new NotFoundException('Organization account not found');
    if (membership.role.name === 'admin') {
      const adminRole = await this.prisma.role.findUnique({ where: { name: 'admin' }, select: { id: true } });
      const adminCount = adminRole ? await this.prisma.userOrg.count({ where: { orgId, roleId: adminRole.id } }) : 0;
      if (adminCount <= 1) throw new ConflictException('The organization must keep at least one administrator');
    }
    await this.prisma.$transaction(async tx => {
      await tx.userServerRole.deleteMany({ where: { userId: accountId, serverInstance: { orgId } } });
      await tx.userOrg.delete({ where: { userId_orgId: { userId: accountId, orgId } } });
      if (membership.user._count.userOrgs === 1) {
        await tx.user.update({
          where: { id: accountId },
          data: { passwordHash: null, approvedAt: null, approvedById: null, authVersion: { increment: 1 } },
        });
      }
    });
    return { ok: true, email: membership.user.email, signInDisabled: membership.user._count.userOrgs === 1 };
  }

  async resetAccountPassword(orgId: string, accountId: string, actingUserId: string, newPassword: string) {
    if (accountId === actingUserId) {
      throw new ForbiddenException('Use your personal password settings to change your own password');
    }
    const [actor, target] = await Promise.all([
      this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId: actingUserId, orgId } }, include: { role: true } }),
      this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId: accountId, orgId } }, include: { role: true, user: { select: { email: true } } } }),
    ]);
    if (actor?.role.name !== 'admin') throw new ForbiddenException('Only organization administrators may reset passwords');
    if (!target) throw new NotFoundException('Organization account not found');
    if (target.role.name === 'admin') throw new ForbiddenException('Administrators may reset passwords only for lower-tier accounts');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: accountId }, data: { passwordHash: makePasswordHash(newPassword), authVersion: { increment: 1 } } }),
      this.prisma.auditLog.create({ data: { orgId, actorId: actingUserId, action: 'password_reset', resourceType: 'user', resourceId: accountId, details: { targetEmail: target.user.email } } }),
    ]);
    return { ok: true };
  }

  async createOrg(
    name: string,
    slug: string,
    userId: string,
  ): Promise<{ id: string; name: string; slug: string; role: string }> {
    const existing = await this.prisma.org.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`An org with slug "${slug}" already exists`);
    }

    const adminRole = await this.resolveRole('admin');

    const org = await this.prisma.org.create({
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        userOrgs: {
          create: {
            userId,
            roleId: adminRole.id,
          },
        },
      },
    });

    return { id: org.id, name: org.name, slug: org.slug, role: 'admin' };
  }

  async getOrg(orgId: string, userId: string) {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: {
        org: {
          include: {
            _count: { select: { userOrgs: true, hosts: true, serverInstances: true } },
          },
        },
        role: true,
      },
    });

    if (!userOrg) {
      throw new ForbiddenException('Not a member of this org');
    }

    return {
      id: userOrg.org.id,
      name: userOrg.org.name,
      slug: userOrg.org.slug,
      discordWebhookUrl: userOrg.role.name === 'admin' ? userOrg.org.discordWebhookUrl : undefined,
      discordWebhookConfigured: Boolean(userOrg.org.discordWebhookUrl),
      frigateConfigured: Boolean(userOrg.org.frigateUrl),
      avoidBloodMoonRestart: userOrg.org.avoidBloodMoonRestart,
      stabilityRestartEnabled: userOrg.org.stabilityRestartEnabled,
      stabilityRestartMemoryGiB: userOrg.org.stabilityRestartMemoryGiB,
      stabilityRestartCooldownMinutes: userOrg.org.stabilityRestartCooldownMinutes,
      openaiConfigured:Boolean(userOrg.org.openaiApiKeyEncrypted),openaiModel:userOrg.org.openaiModel,modAiProvider:userOrg.org.modAiProvider,kimiConfigured:Boolean(userOrg.org.kimiApiKeyEncrypted),kimiModel:userOrg.org.kimiModel,cloudflareConfigured:Boolean(userOrg.org.cloudflareApiTokenEncrypted),digitalOceanConfigured:Boolean(userOrg.org.digitalOceanApiTokenEncrypted),mailgunConfigured:Boolean(userOrg.org.mailgunApiKeyEncrypted&&userOrg.org.mailgunDomain&&userOrg.org.mailgunFromEmail),mailgunDomain:userOrg.org.mailgunDomain,mailgunFromEmail:userOrg.org.mailgunFromEmail,mailgunRegion:userOrg.org.mailgunRegion,stripeConfigured:Boolean(userOrg.org.stripeSecretKeyEncrypted),stripeWebhookConfigured:Boolean(userOrg.org.stripeWebhookSecretEncrypted),stripeWebhookUrl:publicStripeWebhookUrl(),maintenancePasswordConfigured:Boolean(userOrg.org.maintenancePasswordEncrypted),
      createdAt: userOrg.org.createdAt,
      updatedAt: userOrg.org.updatedAt,
      memberCount: userOrg.org._count.userOrgs,
      hostCount: userOrg.org._count.hosts,
      serverInstanceCount: userOrg.org._count.serverInstances,
      userRole: userOrg.role.name,
    };
  }

  async getUserOrgs(userId: string) {
    const memberships = await this.prisma.userOrg.findMany({
      where: { userId },
      include: {
        org: {
          include: {
            _count: { select: { userOrgs: true, hosts: true, serverInstances: true } },
          },
        },
        role: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      discordWebhookConfigured: Boolean(m.org.discordWebhookUrl),
      frigateConfigured: Boolean(m.org.frigateUrl),
      avoidBloodMoonRestart: m.org.avoidBloodMoonRestart,
      stabilityRestartEnabled: m.org.stabilityRestartEnabled,
      stabilityRestartMemoryGiB: m.org.stabilityRestartMemoryGiB,
      stabilityRestartCooldownMinutes: m.org.stabilityRestartCooldownMinutes,
      openaiConfigured:Boolean(m.org.openaiApiKeyEncrypted),openaiModel:m.org.openaiModel,modAiProvider:m.org.modAiProvider,kimiConfigured:Boolean(m.org.kimiApiKeyEncrypted),kimiModel:m.org.kimiModel,cloudflareConfigured:Boolean(m.org.cloudflareApiTokenEncrypted),digitalOceanConfigured:Boolean(m.org.digitalOceanApiTokenEncrypted),mailgunConfigured:Boolean(m.org.mailgunApiKeyEncrypted&&m.org.mailgunDomain&&m.org.mailgunFromEmail),mailgunDomain:m.org.mailgunDomain,mailgunFromEmail:m.org.mailgunFromEmail,mailgunRegion:m.org.mailgunRegion,stripeConfigured:Boolean(m.org.stripeSecretKeyEncrypted),stripeWebhookConfigured:Boolean(m.org.stripeWebhookSecretEncrypted),stripeWebhookUrl:publicStripeWebhookUrl(),maintenancePasswordConfigured:Boolean(m.org.maintenancePasswordEncrypted),
      createdAt: m.org.createdAt,
      updatedAt: m.org.updatedAt,
      memberCount: m.org._count.userOrgs,
      hostCount: m.org._count.hosts,
      serverInstanceCount: m.org._count.serverInstances,
      role: m.role.name,
    }));
  }

  async updateOrg(
    orgId: string,
    userId: string,
    updates: { discordWebhookUrl?: string; frigateUrl?: string; frigateApiKey?: string; frigateWebhookSecret?: string; avoidBloodMoonRestart?: boolean; stabilityRestartEnabled?: boolean; stabilityRestartMemoryGiB?: number; stabilityRestartCooldownMinutes?: number },
  ): Promise<{ ok: true; avoidBloodMoonRestart: boolean; stabilityRestartEnabled: boolean; stabilityRestartMemoryGiB: number; stabilityRestartCooldownMinutes: number }> {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { role: true },
    });
    if (!userOrg) throw new ForbiddenException('Not a member of this org');
    if ((updates.avoidBloodMoonRestart !== undefined || updates.stabilityRestartEnabled !== undefined || updates.stabilityRestartMemoryGiB !== undefined || updates.stabilityRestartCooldownMinutes !== undefined) && userOrg.role.name !== 'admin') {
      throw new ForbiddenException('Only organization administrators may change restart protection');
    }

    const data: Record<string, string | null | boolean | number> = {};
    if (updates.discordWebhookUrl !== undefined) data.discordWebhookUrl = updates.discordWebhookUrl || null;
    if (updates.frigateUrl !== undefined) data.frigateUrl = updates.frigateUrl || null;
    if (updates.frigateApiKey !== undefined) data.frigateApiKey = updates.frigateApiKey || null;
    if (updates.frigateWebhookSecret !== undefined) data.frigateWebhookSecret = updates.frigateWebhookSecret || null;
    if (updates.avoidBloodMoonRestart !== undefined) data.avoidBloodMoonRestart = updates.avoidBloodMoonRestart;
    if (updates.stabilityRestartEnabled !== undefined) data.stabilityRestartEnabled = updates.stabilityRestartEnabled;
    if (updates.stabilityRestartMemoryGiB !== undefined) data.stabilityRestartMemoryGiB = updates.stabilityRestartMemoryGiB;
    if (updates.stabilityRestartCooldownMinutes !== undefined) data.stabilityRestartCooldownMinutes = updates.stabilityRestartCooldownMinutes;

    const org = await this.prisma.org.update({ where: { id: orgId }, data });
    return { ok: true, avoidBloodMoonRestart: org.avoidBloodMoonRestart, stabilityRestartEnabled: org.stabilityRestartEnabled, stabilityRestartMemoryGiB: org.stabilityRestartMemoryGiB, stabilityRestartCooldownMinutes: org.stabilityRestartCooldownMinutes };
  }

  async testFrigateConnection(
    orgId: string,
    userId: string,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { org: { select: { frigateUrl: true, frigateApiKey: true } } },
    });
    if (!userOrg) throw new ForbiddenException('Not a member of this org');

    const frigateUrl = userOrg.org.frigateUrl?.trim();
    if (!frigateUrl) {
      return { ok: false, error: 'No Frigate URL configured for this org' };
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (userOrg.org.frigateApiKey) headers.Authorization = `Bearer ${userOrg.org.frigateApiKey}`;

      const res = await fetch(`${frigateUrl}/api/version`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return { ok: false, error: `Frigate returned HTTP ${res.status}` };
      }
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: true, version: String(body.version ?? body.Version ?? 'unknown') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async saveOpenAiSettings(orgId:string,userId:string,input:{apiKey?:string;model:string}){
    const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{openaiApiKeyEncrypted:true}});if(!existing)throw new NotFoundException('Organization not found');if(!input.apiKey&&!existing.openaiApiKeyEncrypted)throw new ConflictException('OpenAI API key is required');
    const model=input.model.trim();if(!/^[a-zA-Z0-9._-]+$/.test(model))throw new ConflictException('Invalid OpenAI model name');await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{openaiModel:model,...(input.apiKey?{openaiApiKeyEncrypted:encryptOpenAiKey(input.apiKey.trim())}:{})}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'openai_settings_updated',resourceType:'org',resourceId:orgId,details:{model,keyReplaced:Boolean(input.apiKey)}}})]);return{ok:true,configured:true,model};
  }
  async testOpenAi(orgId:string){const org=await this.prisma.org.findUnique({where:{id:orgId},select:{openaiApiKeyEncrypted:true,openaiModel:true}});if(!org?.openaiApiKeyEncrypted)return{ok:false,error:'OpenAI API key is not configured'};const started=Date.now();try{const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${decryptOpenAiKey(org.openaiApiKeyEncrypted)}`,'Content-Type':'application/json','User-Agent':'Mastermind-Minecraft/0.1.0'},body:JSON.stringify({model:org.openaiModel,input:'Reply with OK.',max_output_tokens:16}),signal:AbortSignal.timeout(30000)});if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:{message?:string}};return{ok:false,error:data.error?.message||`OpenAI returned HTTP ${response.status}`,latencyMs:Date.now()-started};}return{ok:true,model:org.openaiModel,latencyMs:Date.now()-started};}catch(error){const timeout=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');return{ok:false,error:timeout?'OpenAI did not respond within 30 seconds. Check DNS, firewall, proxy, or try again.':error instanceof Error?error.message:String(error),latencyMs:Date.now()-started};}}
  async clearOpenAiSettings(orgId:string){await this.prisma.org.update({where:{id:orgId},data:{openaiApiKeyEncrypted:null}});return{ok:true,configured:false};}
  async selectModAiProvider(orgId:string,userId:string,provider:'codex'|'kimi'){
    const org=await this.prisma.org.findUnique({where:{id:orgId},select:{openaiApiKeyEncrypted:true,kimiApiKeyEncrypted:true}});if(!org)throw new NotFoundException('Organization not found');
    if(provider==='codex'&&!org.openaiApiKeyEncrypted)throw new ConflictException('Configure an OpenAI API key before selecting Codex');
    if(provider==='kimi'&&!org.kimiApiKeyEncrypted)throw new ConflictException('Configure a Moonshot API key before selecting Kimi Code');
    await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{modAiProvider:provider}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'mod_ai_provider_selected',resourceType:'org',resourceId:orgId,details:{provider}}})]);return{ok:true,provider};
  }
  async saveKimiSettings(orgId:string,userId:string,input:{apiKey?:string;model:string}){
    const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{kimiApiKeyEncrypted:true}});if(!existing)throw new NotFoundException('Organization not found');if(!input.apiKey&&!existing.kimiApiKeyEncrypted)throw new ConflictException('Moonshot API key is required');
    const model=input.model.trim();if(!/^[a-zA-Z0-9._/-]+$/.test(model))throw new ConflictException('Invalid Kimi model name');await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{kimiModel:model,...(input.apiKey?{kimiApiKeyEncrypted:encryptOpenAiKey(input.apiKey.trim())}:{})}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'kimi_settings_updated',resourceType:'org',resourceId:orgId,details:{model,keyReplaced:Boolean(input.apiKey)}}})]);return{ok:true,configured:true,model};
  }
  async testKimi(orgId:string){const org=await this.prisma.org.findUnique({where:{id:orgId},select:{kimiApiKeyEncrypted:true,kimiModel:true}});if(!org?.kimiApiKeyEncrypted)return{ok:false,error:'Moonshot API key is not configured'};const started=Date.now();try{const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${decryptOpenAiKey(org.kimiApiKeyEncrypted)}`,'Content-Type':'application/json','User-Agent':'Mastermind-Minecraft/0.1.0'},body:JSON.stringify({model:org.kimiModel,messages:[{role:'user',content:'Reply with OK.'}],max_tokens:16,temperature:0}),signal:AbortSignal.timeout(30000)});if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:{message?:string}};return{ok:false,error:data.error?.message||`Moonshot returned HTTP ${response.status}`,latencyMs:Date.now()-started};}return{ok:true,model:org.kimiModel,latencyMs:Date.now()-started};}catch(error){const timeout=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');return{ok:false,error:timeout?'Kimi did not respond within 30 seconds. Check the model, key, DNS, firewall, or try again.':error instanceof Error?error.message:String(error),latencyMs:Date.now()-started};}}
  async clearKimiSettings(orgId:string){await this.prisma.org.update({where:{id:orgId},data:{kimiApiKeyEncrypted:null,...({modAiProvider:'codex'} as const)}});return{ok:true,configured:false,provider:'codex'};}

  async saveCloudflareSettings(orgId: string, userId: string, apiToken: string) {
    const token = apiToken.trim();
    if (!token) throw new ConflictException('Cloudflare API token is required');
    const existing = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { cloudflareApiTokenEncrypted: true },
    });
    if (!existing) throw new NotFoundException('Organization not found');
    await this.prisma.$transaction([
      this.prisma.org.update({
        where: { id: orgId },
        data: { cloudflareApiTokenEncrypted: encryptIntegrationSecret(token) },
      }),
      this.prisma.auditLog.create({
        data: {
          orgId,
          actorId: userId,
          action: 'cloudflare_settings_updated',
          resourceType: 'org',
          resourceId: orgId,
          details: { tokenReplaced: Boolean(existing.cloudflareApiTokenEncrypted) },
        },
      }),
    ]);
    return { ok: true, configured: true };
  }

  async clearCloudflareSettings(orgId: string, userId: string) {
    await this.prisma.$transaction([
      this.prisma.org.update({ where: { id: orgId }, data: { cloudflareApiTokenEncrypted: null } }),
      this.prisma.auditLog.create({
        data: { orgId, actorId: userId, action: 'cloudflare_settings_cleared', resourceType: 'org', resourceId: orgId },
      }),
    ]);
    return { ok: true, configured: false };
  }

  async saveDigitalOceanSettings(orgId:string,userId:string,apiToken:string){const token=apiToken.trim();if(!token)throw new ConflictException('DigitalOcean API token is required');const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{digitalOceanApiTokenEncrypted:true}});if(!existing)throw new NotFoundException('Organization not found');await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{digitalOceanApiTokenEncrypted:encryptIntegrationSecret(token)}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'digitalocean_settings_updated',resourceType:'org',resourceId:orgId,details:{tokenReplaced:Boolean(existing.digitalOceanApiTokenEncrypted)}}})]);return{ok:true,configured:true};}
  async testDigitalOcean(orgId:string){const org=await this.prisma.org.findUnique({where:{id:orgId},select:{digitalOceanApiTokenEncrypted:true}});if(!org?.digitalOceanApiTokenEncrypted)return{ok:false,error:'DigitalOcean API token is not configured'};try{const response=await fetch('https://api.digitalocean.com/v2/account',{headers:{Authorization:`Bearer ${decryptOpenAiKey(org.digitalOceanApiTokenEncrypted)}`,'Content-Type':'application/json','User-Agent':'Mastermind-Minecraft/0.1.0'},signal:AbortSignal.timeout(15000)});if(!response.ok)return{ok:false,error:`DigitalOcean returned HTTP ${response.status}`};const body=await response.json() as {account?:{status?:string;email_verified?:boolean}};return{ok:true,status:body.account?.status||'unknown',emailVerified:Boolean(body.account?.email_verified)};}catch(error){return{ok:false,error:error instanceof Error?error.message:String(error)};}}
  async clearDigitalOceanSettings(orgId:string,userId:string){await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{digitalOceanApiTokenEncrypted:null}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'digitalocean_settings_cleared',resourceType:'org',resourceId:orgId}})]);return{ok:true,configured:false};}

  async saveMailgunSettings(orgId:string,userId:string,input:{apiKey?:string;domain:string;fromEmail:string;region:'us'|'eu'}) {
    const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{mailgunApiKeyEncrypted:true}});
    if(!existing)throw new NotFoundException('Organization not found');
    if(!input.apiKey&&!existing.mailgunApiKeyEncrypted)throw new ConflictException('Mailgun API key is required');
    const domain=input.domain.trim().toLowerCase();const fromEmail=input.fromEmail.trim().toLowerCase();
    if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))throw new ConflictException('Enter a valid Mailgun sending domain');
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{mailgunDomain:domain,mailgunFromEmail:fromEmail,mailgunRegion:input.region,...(input.apiKey?{mailgunApiKeyEncrypted:encryptIntegrationSecret(input.apiKey.trim())}:{})}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'mailgun_settings_updated',resourceType:'org',resourceId:orgId,details:{domain,fromEmail,region:input.region,keyReplaced:Boolean(input.apiKey)}}}),
    ]);
    return{ok:true,configured:true,domain,fromEmail,region:input.region};
  }
  async testMailgun(orgId:string,userId:string){const user=await this.prisma.user.findUnique({where:{id:userId},select:{email:true}});if(!user)throw new NotFoundException('User not found');await this.mailgun.sendTest(orgId,user.email);return{ok:true,recipient:user.email};}
  async clearMailgunSettings(orgId:string,userId:string){await this.prisma.$transaction([this.prisma.org.update({where:{id:orgId},data:{mailgunApiKeyEncrypted:null,mailgunDomain:null,mailgunFromEmail:null}}),this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'mailgun_settings_cleared',resourceType:'org',resourceId:orgId}})]);return{ok:true,configured:false};}

  async saveStripeSettings(orgId:string,userId:string,input:{secretKey?:string;webhookSecret?:string}) {
    const existing=await this.prisma.org.findUnique({where:{id:orgId},select:{stripeSecretKeyEncrypted:true,stripeWebhookSecretEncrypted:true}});
    if(!existing)throw new NotFoundException('Organization not found');
    const secretKey=input.secretKey?.trim()?parseStripeSecretKey(input.secretKey):null;
    const webhookSecret=input.webhookSecret?.trim()?parseStripeWebhookSecret(input.webhookSecret):null;
    if(input.secretKey?.trim() && !secretKey)throw new ConflictException('Enter a valid Stripe secret key (sk_test_ or sk_live_)');
    if(input.webhookSecret?.trim() && !webhookSecret)throw new ConflictException('Enter a valid Stripe webhook signing secret (whsec_)');
    if(!secretKey && !webhookSecret)throw new ConflictException('Enter a Stripe secret key or webhook signing secret');
    if(!secretKey && !existing.stripeSecretKeyEncrypted)throw new ConflictException('Stripe secret key is required');
    await this.prisma.$transaction([
      this.prisma.org.update({
        where:{id:orgId},
        data:{
          ...(secretKey?{stripeSecretKeyEncrypted:encryptIntegrationSecret(secretKey)}:{}),
          ...(webhookSecret?{stripeWebhookSecretEncrypted:encryptIntegrationSecret(webhookSecret)}:{}),
        },
      }),
      this.prisma.auditLog.create({
        data:{orgId,actorId:userId,action:'stripe_settings_updated',resourceType:'org',resourceId:orgId,details:{secretKeyReplaced:Boolean(secretKey),webhookSecretReplaced:Boolean(webhookSecret)}},
      }),
    ]);
    return{ok:true,configured:true,webhookConfigured:Boolean(webhookSecret||existing.stripeWebhookSecretEncrypted),webhookUrl:publicStripeWebhookUrl()};
  }

  async testStripe(orgId:string){
    const org=await this.prisma.org.findUnique({where:{id:orgId},select:{stripeSecretKeyEncrypted:true}});
    if(!org?.stripeSecretKeyEncrypted)return{ok:false,error:'Stripe secret key is not configured'};
    let secretKey='';
    try{secretKey=decryptIntegrationSecret(org.stripeSecretKeyEncrypted);}catch{return{ok:false,error:'Stored Stripe secret key could not be decrypted'};}
    try{
      const response=await fetch('https://api.stripe.com/v1/account',{headers:{authorization:`Bearer ${secretKey}`,'stripe-version':'2024-06-20'},signal:AbortSignal.timeout(15000)});
      if(!response.ok)return{ok:false,error:`Stripe returned HTTP ${response.status}`};
      const body=await response.json() as {livemode?:boolean;charges_enabled?:boolean;payouts_enabled?:boolean};
      return{ok:true,livemode:Boolean(body.livemode),chargesEnabled:Boolean(body.charges_enabled),payoutsEnabled:Boolean(body.payouts_enabled)};
    }catch(error){
      return{ok:false,error:error instanceof Error?error.message:String(error)};
    }
  }

  async clearStripeSettings(orgId:string,userId:string){
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{stripeSecretKeyEncrypted:null,stripeWebhookSecretEncrypted:null}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'stripe_settings_cleared',resourceType:'org',resourceId:orgId}}),
    ]);
    return{ok:true,configured:false};
  }

  async saveMaintenancePassword(orgId:string,userId:string,password:string){
    const value=normalizeMaintenancePassword(password);
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{maintenancePasswordEncrypted:encryptIntegrationSecret(value)}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'maintenance_password_updated',resourceType:'org',resourceId:orgId}}),
    ]);
    return{ok:true,configured:true};
  }

  async clearMaintenancePassword(orgId:string,userId:string){
    await this.prisma.$transaction([
      this.prisma.org.update({where:{id:orgId},data:{maintenancePasswordEncrypted:null}}),
      this.prisma.auditLog.create({data:{orgId,actorId:userId,action:'maintenance_password_cleared',resourceType:'org',resourceId:orgId}}),
    ]);
    return{ok:true,configured:false};
  }

  private async resolveRole(name: string): Promise<{ id: string; name: string }> {
    let role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      role = await this.prisma.role.create({ data: { name } });
    }
    return role;
  }
}
