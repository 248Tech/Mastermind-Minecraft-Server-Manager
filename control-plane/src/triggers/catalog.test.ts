import { parseGrantItemsActionConfig, TRIGGER_EVENTS } from './catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(TRIGGER_EVENTS.length === 0, 'no trigger events until Minecraft progression sync exists');

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

console.log('trigger catalog grant-items tests passed');
