export type PlayerRosterRow = {
  entityId: number;
  name: string;
  identityKey: string;
  steamId: string | null;
  ipAddress: string | null;
  ping: number | null;
  level: number | null;
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

export function rosterIdentityKey(steamId: string | null, name: string): string {
  if (steamId) return `steam:${steamId}`;
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
      ipAddress: null,
      ping: null,
      level: null,
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
