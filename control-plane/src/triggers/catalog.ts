import { parseGrantItemList, formatGrantSummary, type GrantItemSpec } from '../donations/shop-grants';

export const TRIGGER_EVENT_FIRST_JOIN = 'player_first_join';
export const TRIGGER_EVENT_PLAYTIME = 'player_playtime';
export const TRIGGER_EVENT_DONATION_TOTAL = 'player_donation_total';
export const TRIGGER_ACTION_GRANT_ITEMS = 'grant_items';

export const TRIGGER_EVENTS = [
  { type: TRIGGER_EVENT_FIRST_JOIN, label: 'First join' },
  { type: TRIGGER_EVENT_PLAYTIME, label: 'Lifetime playtime' },
  { type: TRIGGER_EVENT_DONATION_TOTAL, label: 'Lifetime donation total' },
] as const;

export const TRIGGER_ACTIONS = [
  { type: TRIGGER_ACTION_GRANT_ITEMS, label: 'Grant items' },
] as const;

export type FirstJoinConfig = Record<string, never>;
export type PlaytimeConfig = { hours: number };
/** Whole US dollars threshold (stored in eventConfig; compared via cents). */
export type DonationTotalConfig = { dollars: number };
export type GrantItemsActionConfig = { items: GrantItemSpec[]; notifyPlayer: boolean; message: string };

export function parseFirstJoinConfig(_raw: unknown): FirstJoinConfig {
  return {};
}

export function parsePlaytimeConfig(raw: unknown): PlaytimeConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hours = Number(data.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 10_000) {
    throw new Error('Playtime must be a whole number of hours from 1 to 10000');
  }
  return { hours };
}

export function parseDonationTotalConfig(raw: unknown): DonationTotalConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dollars = Number(data.dollars);
  if (!Number.isInteger(dollars) || dollars < 1 || dollars > 500) {
    throw new Error('Donation total must be a whole number of dollars from 1 to 500');
  }
  return { dollars };
}

export function parseEventConfig(
  eventType: string,
  raw: unknown,
): FirstJoinConfig | PlaytimeConfig | DonationTotalConfig {
  if (eventType === TRIGGER_EVENT_FIRST_JOIN) return parseFirstJoinConfig(raw);
  if (eventType === TRIGGER_EVENT_PLAYTIME) return parsePlaytimeConfig(raw);
  if (eventType === TRIGGER_EVENT_DONATION_TOTAL) return parseDonationTotalConfig(raw);
  throw new Error(`Unsupported trigger event: ${eventType}`);
}

export function eventKeyForFirstJoin(): string {
  return 'first_join';
}

export function eventKeyForPlaytime(hours: number): string {
  return `playtime:${hours}`;
}

export function donationTotalCents(dollars: number): number {
  return dollars * 100;
}

export function eventKeyForDonationTotal(dollars: number): string {
  return `donation:${donationTotalCents(dollars)}`;
}

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

export function playtimeHoursFromSeconds(lifetimeSeconds: number): number {
  return Math.floor(Math.max(0, lifetimeSeconds) / 3600);
}

/** True when lifetime crossed the hour threshold between previous and next totals. */
export function crossedPlaytimeHours(previousSeconds: number, nextSeconds: number, hours: number): boolean {
  const target = hours * 3600;
  return previousSeconds < target && nextSeconds >= target;
}

/** True when cumulative donation cents crossed the dollar threshold. */
export function crossedDonationTotalCents(previousCents: number, nextCents: number, dollars: number): boolean {
  const target = donationTotalCents(dollars);
  return previousCents < target && nextCents >= target;
}
