import {
  crossedDonationTotalCents,
  crossedPlaytimeHours,
  eventKeyForDonationTotal,
  eventKeyForFirstJoin,
  eventKeyForPlaytime,
  parseDonationTotalConfig,
  parseGrantItemsActionConfig,
  parsePlaytimeConfig,
  TRIGGER_EVENTS,
} from './catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(TRIGGER_EVENTS.some((event) => event.type === 'player_first_join'), 'first join event');
assert(TRIGGER_EVENTS.some((event) => event.type === 'player_playtime'), 'playtime event');
assert(TRIGGER_EVENTS.some((event) => event.type === 'player_donation_total'), 'donation total event');
assert(eventKeyForFirstJoin() === 'first_join', 'first join key');
assert(eventKeyForPlaytime(24) === 'playtime:24', 'playtime key');
assert(eventKeyForDonationTotal(25) === 'donation:2500', 'donation key');
assert(crossedPlaytimeHours(23 * 3600, 24 * 3600, 24), 'crosses 24h threshold');
assert(!crossedPlaytimeHours(24 * 3600, 25 * 3600, 24), 'already past does not re-fire');
assert(crossedDonationTotalCents(499, 500, 5), 'crosses $5');
assert(!crossedDonationTotalCents(500, 600, 5), 'already past $5 does not re-fire');
assert(!crossedDonationTotalCents(0, 400, 5), 'below $5 does not fire');

const playtime = parsePlaytimeConfig({ hours: 12 });
assert(playtime.hours === 12, 'parses playtime hours');

const donation = parseDonationTotalConfig({ dollars: 25 });
assert(donation.dollars === 25, 'parses donation dollars');

let threwHours = false;
try {
  parsePlaytimeConfig({ hours: 0 });
} catch {
  threwHours = true;
}
assert(threwHours, 'rejects invalid hours');

let threwDollars = false;
try {
  parseDonationTotalConfig({ dollars: 0 });
} catch {
  threwDollars = true;
}
assert(threwDollars, 'rejects invalid dollars');

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
