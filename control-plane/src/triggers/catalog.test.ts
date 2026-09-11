import {
  crossedPlaytimeHours,
  eventKeyForFirstJoin,
  eventKeyForPlaytime,
  parseGrantItemsActionConfig,
  parsePlaytimeConfig,
  TRIGGER_EVENTS,
} from './catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(TRIGGER_EVENTS.some((event) => event.type === 'player_first_join'), 'first join event');
assert(TRIGGER_EVENTS.some((event) => event.type === 'player_playtime'), 'playtime event');
assert(eventKeyForFirstJoin() === 'first_join', 'first join key');
assert(eventKeyForPlaytime(24) === 'playtime:24', 'playtime key');
assert(crossedPlaytimeHours(23 * 3600, 24 * 3600, 24), 'crosses 24h threshold');
assert(!crossedPlaytimeHours(24 * 3600, 25 * 3600, 24), 'already past does not re-fire');

const playtime = parsePlaytimeConfig({ hours: 12 });
assert(playtime.hours === 12, 'parses playtime hours');

let threwHours = false;
try {
  parsePlaytimeConfig({ hours: 0 });
} catch {
  threwHours = true;
}
assert(threwHours, 'rejects invalid hours');

const grants = parseGrantItemsActionConfig({
  items: [{ name: 'minecraft:diamond', quantity: 4 }, { name: 'minecraft:iron_ingot', quantity: 1 }],
  notifyPlayer: true,
  message: 'Reward',
});
assert(grants.items.length === 2 && grants.items[0].name === 'minecraft:diamond', 'parses grant items');

let threw = false;
try {
  parseGrantItemsActionConfig({ items: [] });
} catch {
  threw = true;
}
assert(threw, 'requires at least one item');

console.log('trigger catalog tests passed');
