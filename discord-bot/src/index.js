'use strict';

const {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'MASTERMIND_EMAIL', 'MASTERMIND_PASSWORD'];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

const config = {
  token: process.env.DISCORD_TOKEN.trim(),
  clientId: process.env.DISCORD_CLIENT_ID.trim(),
  guildId: process.env.DISCORD_GUILD_ID?.trim(),
  allowedRoles: csvSet(process.env.DISCORD_ALLOWED_ROLE_IDS),
  allowedUsers: csvSet(process.env.DISCORD_ALLOWED_USER_IDS),
  ephemeral: !/^false$/i.test(process.env.DISCORD_EPHEMERAL_REPLIES || 'true'),
  baseUrl: (process.env.MASTERMIND_URL || 'http://control-plane:3001').replace(/\/$/, ''),
  email: process.env.MASTERMIND_EMAIL.trim(),
  password: process.env.MASTERMIND_PASSWORD,
  orgId: process.env.MASTERMIND_ORG_ID?.trim(),
  serverId: process.env.MASTERMIND_SERVER_ID?.trim(),
  timeoutMs: Math.max(30, Number(process.env.JOB_TIMEOUT_SECONDS || 600)) * 1000,
};

const commands = [
  ['start', 'Start the configured game server', 'SERVER_START'],
  ['stop', 'Gracefully stop the configured game server', 'SERVER_STOP'],
  ['reboot', 'Restart the configured game server', 'SERVER_RESTART'],
  ['safereboot', 'Countdown, save, back up, kick players, and restart', 'SERVER_SAFE_RESTART'],
  ['saveworld', 'Send saveworld to flush the live world', 'SERVER_SAVEWORLD'],
  ['savestop', 'Save, create a backup, then shut down', 'SERVER_SAVE_STOP'],
].map(([name, description, jobType]) => ({
  jobType,
  definition: new SlashCommandBuilder().setName(name).setDescription(description),
}));

let session;

function csvSet(value = '') {
  return new Set(value.split(',').map(item => item.trim()).filter(Boolean));
}

async function api(path, options = {}, retry = true) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers.authorization = `Bearer ${session.token}`;
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  if (response.status === 401 && retry && !path.endsWith('/auth/login')) {
    session = undefined;
    await authenticate();
    return api(path, options, false);
  }
  const text = await response.text();
  const body = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const message = body?.message || body?.error || text || `${response.status} ${response.statusText}`;
    throw new Error(`Mastermind API: ${Array.isArray(message) ? message.join(', ') : message}`);
  }
  return body;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

async function authenticate() {
  const login = await api('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: config.email, password: config.password }),
  }, false);
  session = { token: login.access_token, orgId: config.orgId || login.orgId, serverId: config.serverId };
  if (!session.serverId) {
    const servers = await api(`/api/orgs/${encodeURIComponent(session.orgId)}/server-instances`);
    const server = servers.find(item => item.gameType === 'minecraft') || servers[0];
    if (!server) throw new Error('No Mastermind server instance is registered');
    session.serverId = server.id;
  }
}

function authorized(interaction) {
  if (config.allowedUsers.has(interaction.user.id)) return true;
  const roles = interaction.member?.roles?.cache;
  if (roles && [...config.allowedRoles].some(id => roles.has(id))) return true;
  if (config.allowedUsers.size || config.allowedRoles.size) return false;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function queueAndWait(jobType) {
  if (!session) await authenticate();
  const payload = jobType === 'SERVER_SAFE_RESTART' || jobType === 'SERVER_SAVE_STOP' ? { retention_count: 10 } : {};
  const queued = await api(`/api/orgs/${encodeURIComponent(session.orgId)}/jobs`, {
    method: 'POST',
    body: JSON.stringify({ serverInstanceId: session.serverId, type: jobType, payload }),
  });
  const deadline = Date.now() + config.timeoutMs;
  let lastStatus = 'pending';
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const jobs = await api(`/api/orgs/${encodeURIComponent(session.orgId)}/jobs?limit=50&serverInstanceId=${encodeURIComponent(session.serverId)}`);
    const job = jobs.find(item => item.latestRun?.id === queued.jobRunId);
    if (!job) continue;
    lastStatus = job.latestRun?.status || lastStatus;
    if (lastStatus === 'success') return { job, status: lastStatus };
    if (['failed', 'cancelled'].includes(lastStatus)) {
      const result = job.latestRun?.result || {};
      throw new Error(result.errorMessage || result.error || `${jobType} ${lastStatus}`);
    }
  }
  throw new Error(`${jobType} timed out after ${Math.round(config.timeoutMs / 1000)} seconds (last status: ${lastStatus})`);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands.map(command => command.definition.toJSON()) });
  console.log(`Registered ${commands.length} ${config.guildId ? 'guild' : 'global'} slash commands`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, ready => {
  console.log(`Discord bot ready as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.find(item => item.definition.name === interaction.commandName);
  if (!command) return;
  if (!interaction.inGuild() || !authorized(interaction)) {
    await interaction.reply({ content: 'You are not authorized to manage this server.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: config.ephemeral });
  const label = `/${interaction.commandName}`;
  await interaction.editReply(`⏳ ${label} accepted. Waiting for Mastermind…`);
  try {
    const { job } = await queueAndWait(command.jobType);
    await interaction.editReply(`✅ ${label} completed successfully for **${job.serverName || 'server'}**.`);
  } catch (error) {
    console.error(`${label} failed`, error);
    await interaction.editReply(`❌ ${label} failed: ${String(error.message || error).slice(0, 1500)}`);
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection', error));

(async () => {
  await authenticate();
  await registerCommands();
  await client.login(config.token);
})().catch(error => {
  console.error('Discord bot startup failed:', error);
  process.exit(1);
});
