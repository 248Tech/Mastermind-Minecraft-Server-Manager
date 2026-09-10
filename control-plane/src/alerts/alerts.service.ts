import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DiscordService } from '../discord/discord.service';
import { formatDiscordAlert } from './formatters/discord-alert.formatter';
import type { AlertType, AlertContext } from './alert-types';
import { ALERT_TYPES } from './alert-types';

@Injectable()
export class AlertsService {
  private readonly recentPlayerLifecycleAlerts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordService,
  ) {}

  /**
   * Send an alert for an org. Uses org's Discord webhook if configured.
   * Rate limited, retried, and audited.
   */
  async sendAlert(
    type: AlertType,
    context: AlertContext,
  ): Promise<{ sent: boolean; error?: string }> {
    if (!ALERT_TYPES.includes(type)) {
      return { sent: false, error: `Unknown alert type: ${type}` };
    }

    const org = await this.prisma.org.findUnique({
      where: { id: context.orgId },
      select: { discordWebhookUrl: true, name: true },
    });

    if (!org?.discordWebhookUrl?.trim()) {
      await this.auditAlert(context.orgId, type, context, false, 'No webhook configured');
      return { sent: false, error: 'No Discord webhook configured for org' };
    }

    const payload = formatDiscordAlert(type, { ...context, orgName: org.name });
    const result = await this.discord.send(
      org.discordWebhookUrl,
      payload,
      context.orgId,
    );

    if (result.ok) {
      await this.auditAlert(context.orgId, type, context, true);
      return { sent: true };
    }

    await this.auditAlert(context.orgId, type, context, false, result.error);
    return { sent: false, error: result.error };
  }

  // ─── Alert Rule CRUD ───────────────────────────────────────────────────────

  async listRules(orgId: string) {
    const rules = await this.prisma.alertRule.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map((r) => this.toDto(r));
  }

  async createRule(
    orgId: string,
    data: { name: string; condition: unknown; channel: unknown; enabled?: boolean },
  ) {
    const rule = await this.prisma.alertRule.create({
      data: {
        orgId,
        name: data.name,
        condition: data.condition as Prisma.InputJsonValue,
        channel: data.channel as Prisma.InputJsonValue,
        enabled: data.enabled ?? true,
      },
    });
    return this.toDto(rule);
  }

  async updateRule(
    orgId: string,
    ruleId: string,
    data: { enabled?: boolean; name?: string; condition?: unknown; channel?: unknown },
  ) {
    const existing = await this.prisma.alertRule.findFirst({ where: { id: ruleId, orgId } });
    if (!existing) throw new Error('Alert rule not found');

    const updated = await this.prisma.alertRule.update({
      where: { id: ruleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.condition !== undefined && { condition: data.condition as Prisma.InputJsonValue }),
        ...(data.channel !== undefined && { channel: data.channel as Prisma.InputJsonValue }),
      },
    });
    return this.toDto(updated);
  }

  async deleteRule(orgId: string, ruleId: string): Promise<void> {
    const existing = await this.prisma.alertRule.findFirst({ where: { id: ruleId, orgId } });
    if (!existing) throw new Error('Alert rule not found');
    await this.prisma.alertRule.delete({ where: { id: ruleId } });
  }

  async sendMatchingRules(type: AlertType, context: AlertContext): Promise<void> {
    if (type === 'PLAYER_CONNECTED' || type === 'PLAYER_DISCONNECTED') {
      const player = context.playerName?.trim().toLocaleLowerCase() || context.steamId;
      if (player) {
        const now = Date.now();
        const key = `${context.orgId}:${context.serverInstanceId}:${type}:${player}`;
        const previous = this.recentPlayerLifecycleAlerts.get(key);
        if (previous !== undefined && now - previous < 15_000) return;
        this.recentPlayerLifecycleAlerts.set(key, now);
        if (this.recentPlayerLifecycleAlerts.size > 1_000) {
          for (const [candidate, timestamp] of this.recentPlayerLifecycleAlerts) {
            if (now - timestamp >= 15_000) this.recentPlayerLifecycleAlerts.delete(candidate);
          }
        }
      }
    }

    const [org, rules] = await Promise.all([
      this.prisma.org.findUnique({ where: { id: context.orgId }, select: { name: true } }),
      this.prisma.alertRule.findMany({ where: { orgId: context.orgId, enabled: true } }),
    ]);
    const matching = rules.filter(rule => {
      const condition = rule.condition as Record<string, unknown>;
      if (String(condition?.type ?? '').toUpperCase() !== type) return false;
      if (type === 'LOG_KEYWORD' && context.ruleId && rule.id !== context.ruleId) return false;
      return true;
    });
    const payload = formatDiscordAlert(type, { ...context, orgName: org?.name });
    for (const rule of matching) {
      const channel = rule.channel as Record<string, unknown>;
      if (String(channel?.type ?? '').toLowerCase() !== 'discord') continue;
      const webhookUrl = String(channel.webhookUrl ?? '').trim();
      if (!webhookUrl) continue;
      const result = await this.discord.send(webhookUrl, payload, `${context.orgId}:${rule.id}`);
      await this.auditAlert(context.orgId, type, context, result.ok, result.ok ? undefined : result.error);
    }
  }

  async relayPlayerChat(context: { eventId: string; orgId: string; serverInstanceId: string; serverInstanceName: string; playerName: string; playerId: string; channel: string; message: string }): Promise<{ configured: boolean; sent: boolean; error?: string }> {
    const rules = await this.prisma.alertRule.findMany({ where: { orgId: context.orgId, enabled: true } });
    const matching = rules.filter(rule => {
      const condition = rule.condition as Record<string, unknown>;
      return condition?.type === 'chat_relay' && (!condition.serverInstanceId || condition.serverInstanceId === context.serverInstanceId);
    });
    let configured = false;
    let error: string | undefined;
    for (const rule of matching) {
      const channel = rule.channel as Record<string, unknown>;
      if (String(channel?.type ?? '').toLowerCase() !== 'discord') continue;
      const webhookUrl = String(channel.webhookUrl ?? '').trim();
      if (!webhookUrl) continue;
      configured = true;
      const safeName = context.playerName.replace(/[*_`~|>]/g, '\\$&').slice(0, 80);
      const safeMessage = context.message.replace(/@/g, '@\u200b').slice(0, 1800);
      const result = await this.discord.send(webhookUrl, {
        embeds: [{ title: `💬 ${safeName}`, description: safeMessage, color: 0x5865f2,
          fields: [{ name: 'Server', value: context.serverInstanceName, inline: true }, { name: 'Channel', value: context.channel, inline: true }],
          footer: { text: `Minecraft player chat · ${context.playerId}` }, timestamp: new Date().toISOString() }],
      // Each persisted chat event gets its own local limiter key. Discord's
      // webhook response still enforces its real limit and uses normal retries;
      // busy player chat is no longer silently dropped by the alert-rule bucket.
      }, `${context.orgId}:${rule.id}:${context.eventId}`);
      if (!result.ok) error = result.error;
    }
    return { configured, sent: !error, ...(error ? { error } : {}) };
  }

  async testRule(orgId: string, ruleId: string, userId: string) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id: ruleId, orgId } });
    if (!rule) throw new Error('Alert rule not found');
    const channel = rule.channel as Record<string, unknown>;
    if (String(channel?.type ?? '').toLowerCase() !== 'discord') {
      return { sent: false, error: `Testing is not supported for ${String(channel?.type ?? 'this')} channels` };
    }
    const webhookUrl = String(channel.webhookUrl ?? '').trim();
    let parsed: URL;
    try { parsed = new URL(webhookUrl); } catch { return { sent: false, error: 'Saved Discord webhook URL is invalid' }; }
    if (parsed.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(parsed.hostname.toLowerCase()) || !parsed.pathname.startsWith('/api/webhooks/')) {
      return { sent: false, error: 'Saved channel is not a valid Discord webhook URL' };
    }
    const result = await this.discord.send(webhookUrl, {
      embeds: [{
        title: '🧪 Mastermind alert pipeline test',
        description: `Alert rule **${rule.name}** successfully reached its configured Discord channel.`,
        color: 0x6366f1,
        fields: [{ name: 'Result', value: 'Webhook delivery successful', inline: true }],
        footer: { text: 'Mastermind Control Plane · Manual Test' },
        timestamp: new Date().toISOString(),
      }],
    }, `${orgId}:rule-test`);
    await this.prisma.auditLog.create({ data: {
      orgId, actorId: userId, action: 'alert_test', resourceType: 'alert_rule', resourceId: ruleId,
      details: { name: rule.name, success: result.ok, ...(!result.ok && { error: result.error }) },
    }});
    return result.ok ? { sent: true, message: 'Test alert delivered successfully' } : { sent: false, error: result.error };
  }

  private toDto(r: {
    id: string; orgId: string; name: string; condition: unknown;
    channel: unknown; enabled: boolean; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      condition: r.condition,
      channel: r.channel,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async auditAlert(
    orgId: string,
    alertType: string,
    context: AlertContext,
    success: boolean,
    error?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        action: 'alert_sent',
        resourceType: 'discord',
        resourceId: orgId,
        details: {
          alertType,
          success,
          ...(error && { error }),
          serverInstanceId: context.serverInstanceId,
          hostId: context.hostId,
        },
      },
    });
  }
}
