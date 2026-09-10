import { parseGrantItemList, formatGrantSummary, type GrantItemSpec } from '../donations/shop-grants';

export const TRIGGER_ACTION_GRANT_ITEMS = 'grant_items';

/** No in-game events are wired yet (level sync not available for Minecraft). */
export const TRIGGER_EVENTS = [] as const;
export const TRIGGER_ACTIONS = [
  { type: TRIGGER_ACTION_GRANT_ITEMS, label: 'Grant items' },
] as const;

export type GrantItemsActionConfig = { items: GrantItemSpec[]; notifyPlayer: boolean; message: string };

export function parseGrantItemsActionConfig(raw: unknown): GrantItemsActionConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = parseGrantItemList(data.items);
  if (items === false) {
    throw new Error('Each grant must be a Minecraft item id (e.g. diamond or minecraft:diamond), quantity 1–9999. Maximum 8 items.');
  }
  if (!items.length) {
    throw new Error('Select at least one item to grant');
  }
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 200) : '';
  return {
    items,
    notifyPlayer: data.notifyPlayer !== false,
    message: message || 'You received a reward.',
  };
}

export function grantItemsSummary(items: GrantItemSpec[]): string {
  return formatGrantSummary(items);
}
