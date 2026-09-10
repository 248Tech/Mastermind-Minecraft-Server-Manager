import { parseGrantItemsActionConfig, playerReachedLevel } from './catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const grants = parseGrantItemsActionConfig({
  items: [{ name: 'minecraft:diamond', quantity: 4 }, { name: 'minecraft:iron_ingot', quantity: 1 }],
  notifyPlayer: true,
  message: 'Level reward',
});
assert(grants.items.length === 2 && grants.items[0].name === 'minecraft:diamond', 'parses grant items');

let threw = false;
try {
  parseGrantItemsActionConfig({ items: [] });
} catch {
  threw = true;
}
assert(threw, 'requires at least one item');

assert(playerReachedLevel('eq', 69, 111, 100), 'exact trigger still fires when a player jumps past the level');
assert(playerReachedLevel('gte', 69, 111, 100), 'at-least trigger fires when jumping past the level');
assert(!playerReachedLevel('eq', 111, 111, 100), 'does not re-fire after the player is already past the level');
assert(!playerReachedLevel('eq', 99, 99, 100), 'does not fire below the level');
assert(playerReachedLevel('eq', 99, 100, 100), 'fires when landing exactly on the level');

console.log('trigger catalog grant-items tests passed');
