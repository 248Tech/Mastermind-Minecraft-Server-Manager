import type { DiscordEmbed, DiscordWebhookPayload } from '../../discord/discord.types';
import type { AlertType } from '../alert-types';
import type { AlertContext } from '../alert-types';

/** Discord embed colors (decimal) */
const COLORS = {
  SERVER_DOWN: 0xe74c3c,       // red
  SERVER_RESTART: 0xf39c12,    // orange
  AGENT_OFFLINE: 0x9b59b6,     // purple
  FRIGATE_DETECTION: 0x3498db, // blue
  PLAYER_CONNECTED: 0x2ecc71,  // green
  PLAYER_DISCONNECTED: 0x95a5a6, // gray
  LOG_KEYWORD: 0xe67e22,       // carrot
} as const;

export function formatDiscordAlert(type: AlertType, context: AlertContext): DiscordWebhookPayload {
  const embed = buildEmbed(type, context);
  return { embeds: [embed] };
}

function buildEmbed(type: AlertType, ctx: AlertContext): DiscordEmbed {
  const color = COLORS[type] ?? 0x95a5a6;
  const title = getTitle(type);
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (ctx.orgName) fields.push({ name: 'Org', value: ctx.orgName, inline: true });
  if (ctx.serverInstanceName) fields.push({ name: 'Server', value: ctx.serverInstanceName, inline: true });
  if (ctx.hostName) fields.push({ name: 'Host', value: ctx.hostName, inline: true });
  if (ctx.serverInstanceId) fields.push({ name: 'Server ID', value: ctx.serverInstanceId, inline: false });
  if (ctx.hostId) fields.push({ name: 'Host ID', value: ctx.hostId, inline: false });
  if (ctx.lastHeartbeatAt) fields.push({ name: 'Last heartbeat', value: String(ctx.lastHeartbeatAt), inline: false });
  if (ctx.reason) fields.push({ name: 'Reason', value: String(ctx.reason), inline: false });
  if (ctx.frigateCamera) fields.push({ name: 'Camera', value: String(ctx.frigateCamera), inline: true });
  if (ctx.frigateLabel) fields.push({ name: 'Detected', value: String(ctx.frigateLabel), inline: true });
  if (ctx.frigateScore != null) fields.push({ name: 'Confidence', value: `${Math.round(Number(ctx.frigateScore) * 100)}%`, inline: true });
  if (ctx.playerName) fields.push({ name: 'Player', value: String(ctx.playerName), inline: true });
  if (ctx.steamId) fields.push({ name: 'Steam ID', value: String(ctx.steamId), inline: false });
  if (ctx.eosId) fields.push({ name: 'EOS ID', value: String(ctx.eosId), inline: false });
  if (type === 'PLAYER_DISCONNECTED' && typeof ctx.sessionSeconds === 'number') {
    fields.push({ name: 'Session playtime', value: formatDuration(ctx.sessionSeconds), inline: true });
  }
  if (type === 'LOG_KEYWORD') {
    if (ctx.keyword) fields.push({ name: 'Keyword', value: String(ctx.keyword), inline: true });
    if (ctx.ruleName) fields.push({ name: 'Rule', value: String(ctx.ruleName), inline: true });
    if (ctx.excerpt) fields.push({ name: 'Log excerpt', value: '```\n' + String(ctx.excerpt).slice(0, 900) + '\n```', inline: false });
  }

  return {
    title,
    color,
    fields: fields.length ? fields : undefined,
    footer: { text: 'Mastermind Control Plane' },
    timestamp: new Date().toISOString(),
  };
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remainder}s`].filter(Boolean).join(' ');
}

function getTitle(type: AlertType): string {
  switch (type) {
    case 'SERVER_DOWN':
      return '🔴 Server down';
    case 'SERVER_RESTART':
      return '🟠 Server restart';
    case 'AGENT_OFFLINE':
      return '🟣 Agent offline';
    case 'FRIGATE_DETECTION':
      return '📷 Frigate detection event';
    case 'PLAYER_CONNECTED':
      return '🟢 Player connected';
    case 'PLAYER_DISCONNECTED':
      return '⚪ Player disconnected';
    case 'LOG_KEYWORD':
      return '🔎 Log keyword match';
    default:
      return `Alert: ${type}`;
  }
}
