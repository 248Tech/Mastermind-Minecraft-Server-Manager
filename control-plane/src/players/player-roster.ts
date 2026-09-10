export type PlayerRosterRow = {
  entityId: number;
  name: string;
  identityKey: string;
  steamId: string | null;
  eosId: string | null;
  ipAddress: string | null;
  ping: number | null;
  level: number | null;
  zombieKills: number;
  playerKills: number;
  deaths: number;
  position: { x: number; y: number; z: number } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function int(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isInteger(n)) return n;
  }
  return NaN;
}

function finite(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function steamIdOf(value: string): string | null {
  const match = /(?:^|Steam_)([0-9]{15,20})$/i.exec(value.trim());
  return match ? match[1] : null;
}

function eosIdOf(value: string): string | null {
  const match = /(?:^|EOS_)([a-f0-9]{20,64})$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function rosterIdentityKey(steamId: string | null, eosId: string | null, name: string): string {
  if (steamId) return `steam:${steamId}`;
  if (eosId) return `eos:${eosId}`;
  return `name:${name.toLowerCase()}`;
}

/** Minecraft agent PLAYER_LIST_SYNC / LIST_PLAYERS result shape: { players: [{ name, uuid? }] }. */
export function parseMinecraftRoster(result: unknown): PlayerRosterRow[] | null {
  const root = asRecord(result);
  const list = Array.isArray(root?.players)
    ? root!.players
    : Array.isArray(result)
      ? result
      : null;
  if (!list) return null;
  const rows: PlayerRosterRow[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.name, row.player, row.username, row.displayName);
    if (!name || name.length > 16) continue;
    const uuidRaw = text(row.uuid, row.id, row.playerUuid);
    const uuid = /^[0-9a-f-]{32,36}$/i.test(uuidRaw) ? uuidRaw.toLowerCase() : '';
    rows.push({
      entityId: 0,
      name,
      identityKey: uuid ? `uuid:${uuid}` : `name:${name.toLowerCase()}`,
      steamId: null,
      eosId: null,
      ipAddress: null,
      ping: null,
      level: null,
      zombieKills: 0,
      playerKills: 0,
      deaths: 0,
      position: null,
    });
  }
  return rows.slice(0, 256);
}

export function cleanRosterIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || /^(unknown|none|null|n\/a)$/i.test(value)) return null;
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (v6) return v6[1].slice(0, 64);
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4) return v4[1];
  return value.slice(0, 64);
}

function positionFromRecord(row: Record<string, unknown>) {
  const nested = asRecord(row.position) || asRecord(row.pos);
  const x = finite(row.x, row.posX, nested?.x);
  const y = finite(row.y, row.posY, nested?.y);
  const z = finite(row.z, row.posZ, nested?.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}

export function mergeRosterPositions(
  rows: PlayerRosterRow[],
  locations: Array<{ id: string | number; name: string; steamId?: string; position: { x: number; y: number; z: number } }>,
): PlayerRosterRow[] {
  if (!locations.length) return rows;
  const bySteam = new Map<string, { x: number; y: number; z: number }>();
  const byEntity = new Map<number, { x: number; y: number; z: number }>();
  const byName = new Map<string, { x: number; y: number; z: number }>();
  for (const loc of locations) {
    const pos = loc.position;
    if (!pos) continue;
    const steam = text(loc.steamId).replace(/^Steam_/i, '');
    if (steam) bySteam.set(steam, pos);
    const entityId = int(loc.id);
    if (Number.isInteger(entityId) && entityId > 0) byEntity.set(entityId, pos);
    const name = loc.name.trim().toLocaleLowerCase();
    if (name) byName.set(name, pos);
  }
  return rows.map((row) => {
    if (row.position) return row;
    const position =
      (row.steamId ? bySteam.get(row.steamId) : undefined)
      ?? byEntity.get(row.entityId)
      ?? byName.get(row.name.trim().toLocaleLowerCase())
      ?? null;
    return position ? { ...row, position } : row;
  });
}

export function parseLpRoster(output: string): PlayerRosterRow[] | null {
  if (!/Total of\s+\d+\s+in the game/i.test(output)) return null;
  const rows: PlayerRosterRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const head = line.match(/^\s*\d+\.\s+id=(\d+),\s*([^,]+),/i);
    if (!head) continue;
    const steam = line.match(/(?:pltfmid|steamid)=Steam_([0-9]{15,20})/i)?.[1] ?? null;
    const eos = line.match(/(?:crossid|pltfmid)=EOS_([a-f0-9]{20,64})/i)?.[1] ?? null;
    const name = head[2].trim();
    if (!name) continue;
    const ping = int(line.match(/\bping\s*=\s*(\d+)/i)?.[1]);
    rows.push({
      entityId: Number(head[1]),
      name,
      steamId: steam,
      eosId: eos,
      identityKey: rosterIdentityKey(steam, eos, name),
      ipAddress: cleanRosterIp(line.match(/\bip\s*=\s*(\[[^\]]+\]|[^,\s]+)/i)?.[1]),
      ping: Number.isInteger(ping) ? ping : null,
      zombieKills: Number(line.match(/(?:zombies|zombiekills)\s*=\s*(\d+)/i)?.[1] ?? 0),
      playerKills: Number(line.match(/(?:players|playerkills)\s*=\s*(\d+)/i)?.[1] ?? 0),
      deaths: Number(line.match(/deaths\s*=\s*(\d+)/i)?.[1] ?? 0),
      level: Number(line.match(/level\s*=\s*(\d+)/i)?.[1] ?? 1),
      position: positionFromLpLine(line),
    });
  }
  return rows.slice(0, 256);
}

function positionFromLpLine(line: string) {
  const match = /\bpos=\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)/i.exec(line);
  if (!match) return null;
  const x = Number(match[1]), y = Number(match[2]), z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}

function playerListFromJson(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  const record = asRecord(json);
  if (!record) return null;
  const keys = ['Players', 'players', 'data', 'result'];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  for (const key of ['data', 'result']) {
    const nested = asRecord(record[key]);
    if (!nested) continue;
    for (const inner of keys) {
      if (Array.isArray(nested[inner])) return nested[inner] as unknown[];
    }
  }
  return null;
}

export function parseAllocsPlayersOnline(json: unknown): PlayerRosterRow[] | null {
  const items = playerListFromJson(json);
  if (!items) return null;
  const rows: PlayerRosterRow[] = [];
  let skippedOffline = false;
  let sawUnusableOnline = false;
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const name = text(item.name, item.playername, item.playerName, item.Name);
    const entityId = int(item.entityid, item.entityId, item.id);
    const looksLikePlayer = Boolean(name) || Number.isInteger(entityId);
    if (item.online === false) {
      if (looksLikePlayer) skippedOffline = true;
      continue;
    }
    if (!name || !Number.isInteger(entityId) || entityId < 1) {
      if (looksLikePlayer) sawUnusableOnline = true;
      continue;
    }
    const steam = steamIdOf(text(item.steamid, item.steamId, item.PlatformId, item.platformId, item.pltfmid));
    const eos = eosIdOf(text(item.crossplatformid, item.crossPlatformId, item.eossid, item.eosId, item.userid, item.crossid));
    const ping = int(item.ping, item.Ping);
    const zombieKills = int(item.zombiekills, item.zombieKills, item.zombies);
    const playerKills = int(item.playerkills, item.playerKills, item.players);
    const deaths = int(item.playerdeaths, item.playerDeaths, item.deaths);
    const level = int(item.level, item.Level);
    rows.push({
      entityId,
      name,
      steamId: steam,
      eosId: eos,
      identityKey: rosterIdentityKey(steam, eos, name),
      ipAddress: cleanRosterIp(text(item.ip, item.ipAddress, item.IP)),
      ping: Number.isInteger(ping) ? ping : null,
      zombieKills: Number.isInteger(zombieKills) ? zombieKills : 0,
      playerKills: Number.isInteger(playerKills) ? playerKills : 0,
      deaths: Number.isInteger(deaths) ? deaths : 0,
      level: Number.isInteger(level) ? Math.max(1, level) : null,
      position: positionFromRecord(item),
    });
  }
  if (rows.length > 0) return rows.slice(0, 256);
  if (items.length === 0) return [];
  if (skippedOffline && !sawUnusableOnline) return [];
  return null;
}
