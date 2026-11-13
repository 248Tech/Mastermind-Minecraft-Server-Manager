/* Mock data for the static Mastermind Minecraft demo. Everything here is fictional. */
window.MM_DATA = (function () {
  const now = Date.now();
  const min = 60000;
  const ago = (m) => now - m * min;

  const servers = [
    { id: 'srv-1', name: 'Survival SMP', world: 'world', host: 'do-nyc-01', status: 'online', players: 8, max: 20, version: 'Paper 1.21.4', tps: 19.9, mspt: 14, loaded: 612 },
    { id: 'srv-2', name: 'Create: Above & Beyond', world: 'create_world', host: 'do-nyc-01', status: 'online', players: 5, max: 12, version: 'NeoForge 21.1', tps: 18.7, mspt: 31, loaded: 944 },
    { id: 'srv-3', name: 'Creative Plots', world: 'plots', host: 'lab-eu-02', status: 'offline', players: 0, max: 30, version: 'Fabric 0.16', tps: 0, mspt: 0, loaded: 0 },
  ];

  const hosts = [
    { id: 'h1', name: 'do-nyc-01', os: 'Ubuntu 24.04', agent: 'v0.16.2', ip: '10.78.0.2', status: 'online', lastSeen: 'just now', servers: 2 },
    { id: 'h2', name: 'lab-eu-02', os: 'Debian 12', agent: 'v0.16.1', ip: '10.78.0.7', status: 'offline', lastSeen: '3 h ago', servers: 1 },
  ];

  const names = ['Steve_Builder', 'CreeperSlayer', 'NetherNomad', 'RedstoneRita', 'DiamondDave', 'EnderPearlEli', 'PixelPaula', 'Obsidian_Ollie', 'AxolotlAmy', 'Herobrine_Not', 'Villager_Vic', 'TNT_Tina', 'WitherWill', 'Quartz_Quinn', 'Mossy_Max', 'ShulkerSam', 'Beacon_Bea', 'Lapis_Lou'];
  const worlds = ['world', 'world', 'world_nether', 'world', 'world', 'world_the_end', 'world', 'world_nether', 'world', 'world', 'world', 'world', 'world_nether', 'world', 'world', 'world_the_end', 'world', 'world'];
  const modes = ['survival', 'survival', 'survival', 'creative', 'survival', 'survival', 'survival', 'survival', 'survival', 'spectator', 'survival', 'survival', 'survival', 'survival', 'survival', 'survival', 'survival', 'survival'];
  const hex = (i) => ('00000000' + ((0x1a2b3c4d + i * 0x9e3779b1) >>> 0).toString(16)).slice(-8);
  const players = names.map((n, i) => ({
    id: 'p' + i,
    name: n,
    uuid: hex(i) + '-' + hex(i + 1).slice(0, 4) + '-4' + hex(i + 2).slice(1, 4) + '-a' + hex(i + 3).slice(1, 4) + '-' + hex(i + 4) + hex(i + 5).slice(0, 4),
    online: i < 8,
    mode: modes[i],
    world: worlds[i],
    deaths: 1 + ((i * 7) % 29),
    mobs: 120 + ((i * 131) % 3200),
    ping: 14 + ((i * 13) % 80),
    playtime: 4 + ((i * 11) % 220),
    country: ['US', 'US', 'CA', 'GB', 'DE', 'AU', 'US', 'NL', 'SE', 'US', 'FR', 'US', 'BR', 'PL', 'US', 'NO', 'US', 'CA'][i],
    op: i === 0 || i === 3,
    wl: i !== 9,
    last: i < 8 ? 'online now' : ((i * 37) % 600) + ' min ago',
    x: Math.round(Math.sin(i * 2.1) * 2400),
    z: Math.round(Math.cos(i * 1.7) * 2400),
  }));

  const mods = [
    { id: 'm1', name: 'LuckPerms', type: 'plugin', version: '5.4.150', author: 'Luck', status: 'active', size: '1.6 MB', note: 'Permissions and groups' },
    { id: 'm2', name: 'EssentialsX', type: 'plugin', version: '2.21.0', author: 'EssentialsX', status: 'active', size: '1.9 MB', note: 'Homes, warps, kits, economy' },
    { id: 'm3', name: 'WorldEdit', type: 'plugin', version: '7.3.9', author: 'EngineHub', status: 'active', size: '4.1 MB', note: 'In-game map editing' },
    { id: 'm4', name: 'BlueMap', type: 'plugin', version: '5.5', author: 'Blue', status: 'active', size: '5.8 MB', note: 'Web map embedded in the dashboard' },
    { id: 'm5', name: 'Chunky', type: 'plugin', version: '1.4.28', author: 'pop4959', status: 'active', size: '0.4 MB', note: 'World pre-generation' },
    { id: 'm6', name: 'Create', type: 'mod', version: '6.0.4', author: 'Creators of Create', status: 'active', size: '18 MB', note: 'Kinetic machines (NeoForge server)' },
    { id: 'm7', name: 'Server Tweaks', type: 'mod', version: '0.6.1', author: 'community', status: 'pending', size: '0.7 MB', note: 'Requested by player AxolotlAmy, awaiting review' },
    { id: 'm8', name: 'ChestSort', type: 'plugin', version: '14.2.0', author: 'mfnalex', status: 'quarantined', size: '0.3 MB', note: 'Quarantined: conflicts with EssentialsX kit signs' },
    { id: 'm9', name: 'Dynmap', type: 'plugin', version: '3.7', author: 'webbukkit', status: 'quarantined', size: '7.2 MB', note: 'Quarantined: replaced by BlueMap; config diff ready' },
  ];

  const jobs = [
    { id: 'j-2210', type: 'safe-restart', server: 'srv-1', by: 'demo.admin', status: 'succeeded', at: ago(190), out: 'say countdown 5m, save-all, backup, kick verified, restart OK' },
    { id: 'j-2209', type: 'backup', server: 'srv-2', by: 'scheduler', status: 'succeeded', at: ago(245), out: 'World backup 2.4 GB written, retention pruned 1' },
    { id: 'j-2208', type: 'rcon', server: 'srv-1', by: 'ops.sam', status: 'succeeded', at: ago(300), out: 'say Restart in 30 minutes!' },
    { id: 'j-2207', type: 'mod-quarantine', server: 'srv-1', by: 'demo.admin', status: 'succeeded', at: ago(980), out: 'ChestSort moved to quarantine' },
    { id: 'j-2206', type: 'kick', server: 'srv-1', by: 'auto-mod', status: 'succeeded', at: ago(1400), out: 'Kicked player (chat flood, 3rd warning)' },
  ];

  const logs = [
    '[14:18:02] [Server thread/INFO]: Kestrel_MC joined the game',
    '[14:18:44] [Server thread/INFO]: CreeperSlayer has made the advancement [Monster Hunter]',
    '[14:19:10] [Server thread/INFO]: NetherNomad was slain by Piglin Brute',
    '[14:19:58] [Server thread/INFO]: <RedstoneRita> anyone need a hopper clock?',
    "[14:20:11] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 2112ms behind",
    '[14:20:40] [Server thread/INFO]: [BlueMap] Render finished for world (0.4s)',
    '[14:21:05] [Mastermind] watchdog: heap 5.1 GiB / 8 GiB - OK',
    '[14:21:33] [Server thread/INFO]: ThreadedAnvilChunkStorage: All dimensions are saved',
    '[14:22:01] [Mastermind] agent heartbeat ok (18 ms)',
  ];

  const chat = [
    { t: '14:09', who: 'AxolotlAmy', msg: 'found a mansion at -1200 / 800!', src: 'player' },
    { t: '14:11', who: 'DiamondDave', msg: 'who is up for the End tonight', src: 'player' },
    { t: '14:12', who: 'Server', msg: 'Restart in 3 hours. Safe restart is enabled.', src: 'server' },
    { t: '14:16', who: 'RedstoneRita', msg: 'anyone need a hopper clock?', src: 'player' },
    { t: '14:17', who: 'Steve_Builder', msg: 'yes please, at spawn', src: 'player' },
  ];

  const schedules = [
    { id: 's1', name: 'Nightly safe restart', server: 'srv-1', cron: '0 5 * * *', kind: 'safe-restart', next: 'in 14h 38m', enabled: true },
    { id: 's2', name: 'World backup every 6h', server: 'srv-1', cron: '0 */6 * * *', kind: 'backup', next: 'in 1h 38m', enabled: true },
    { id: 's3', name: 'Modpack nightly restart', server: 'srv-2', cron: '30 4 * * *', kind: 'safe-restart', next: 'in 14h 08m', enabled: true },
    { id: 's4', name: 'Weekly world backup', server: 'srv-2', cron: '0 3 * * 0', kind: 'backup', next: 'in 2d 12h', enabled: false },
  ];

  const saves = [
    { id: 'b1', server: 'srv-1', kind: 'World backup', world: 'world + nether + end', size: '2.1 GB', at: '2026-11-13 12:00', by: 'scheduler' },
    { id: 'b2', server: 'srv-1', kind: 'World backup', world: 'world + nether + end', size: '2.1 GB', at: '2026-11-13 06:00', by: 'scheduler' },
    { id: 'b3', server: 'srv-1', kind: 'World backup', world: 'world + nether + end', size: '2.0 GB', at: '2026-11-12 18:00', by: 'demo.admin' },
    { id: 'b4', server: 'srv-2', kind: 'World backup', world: 'create_world', size: '2.4 GB', at: '2026-11-13 04:30', by: 'scheduler' },
    { id: 'b5', server: 'srv-2', kind: 'World backup', world: 'create_world', size: '2.3 GB', at: '2026-11-12 04:30', by: 'scheduler' },
  ];

  const alerts = [
    { id: 'a1', name: 'Server offline > 2 min', channel: 'Discord #ops', kind: 'server-event', last: '2 days ago', enabled: true },
    { id: 'a2', name: "Log keyword: \"Can't keep up\"", channel: 'Discord #ops', kind: 'log-keyword', last: '6 h ago', enabled: true },
    { id: 'a3', name: 'Player joined / left', channel: 'Discord #players', kind: 'player-event', last: '4 min ago', enabled: true },
    { id: 'a4', name: 'Heap > 7 GiB', channel: 'Email', kind: 'stability', last: 'never', enabled: false },
  ];

  const triggers = [
    { id: 't1', name: 'First join kit', on: 'player.first_join', action: 'give 1x Stone Pickaxe, 16x Bread', fired: 64 },
    { id: 't2', name: '$10 donation milestone', on: 'donations.total >= $10', action: 'give 8x Diamond + chat notify', fired: 19 },
    { id: 't3', name: 'Advancement shout-out', on: 'advancement.made', action: 'say {player} earned {advancement}!', fired: 412 },
  ];

  const accounts = [
    { id: 'u1', email: 'demo.admin@mastermind.demo', role: 'admin', status: 'active', steam: 'linked', last: 'just now' },
    { id: 'u2', email: 'ops.sam@mastermind.demo', role: 'operator', status: 'active', steam: 'linked', last: '3 h ago' },
    { id: 'u3', email: 'viewer.jo@mastermind.demo', role: 'viewer', status: 'active', steam: 'not linked', last: '2 days ago' },
    { id: 'u4', email: 'new.user@mastermind.demo', role: 'viewer', status: 'pending', steam: 'not linked', last: 'never' },
  ];

  const shop = [
    { id: 'sh1', name: 'Starter Pack', price: 10, gifts: '8x Diamond, 16x Golden Carrot', sold: 52 },
    { id: 'sh2', name: 'Builder Supporter', price: 25, gifts: 'Supporter rank + chat color', sold: 23 },
    { id: 'sh3', name: 'Gold Patron', price: 50, gifts: 'Supporter + 4x Netherite Ingot', sold: 7 },
  ];

  return { servers, hosts, players, mods, jobs, logs, chat, schedules, saves, alerts, triggers, accounts, pois: [], shop };
})();
