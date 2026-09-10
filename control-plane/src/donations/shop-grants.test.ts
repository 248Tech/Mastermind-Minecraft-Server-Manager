import { parseGrantItemList, grantSpecsFromFields, lineGrantItems, aggregateGrantStatus, snapshotLineGrants, buildGiveCommand, classifyGrantOutput } from './shop-grants';
import assert from 'node:assert/strict';

const parsed = parseGrantItemList([
  { name: 'minecraft:oak_log', quantity: 10 },
  { name: 'diamond', quantity: 5, quality: 3 },
]);
assert(Array.isArray(parsed) && parsed.length === 2, 'parses grant list');
assert(parsed[0].name === 'minecraft:oak_log' && parsed[0].quantity === 10 && parsed[0].quality === null, 'first grant item');
assert(parsed[1].name === 'diamond' && parsed[1].quality === 3, 'second grant item quality kept for compat');
assert(parseGrantItemList('[{ "name": "all", "quantity": 1 }]') === false, 'rejects all alias');

assert(buildGiveCommand('Steve', 'minecraft:diamond', 64) === 'give Steve minecraft:diamond 64', 'builds give');
assert(classifyGrantOutput('No player was found', 'failed') === 'retry', 'offline give retries');
assert(classifyGrantOutput('Gave 64 [Diamond] to Steve', 'success') === 'delivered', 'successful give delivers');

const snap = snapshotLineGrants([{ name: 'minecraft:oak_log', quantity: 1, quality: null }, { name: 'diamond', quantity: 2, quality: 4 }]);
assert(snap.length === 2 && snap[0].status === 'pending', 'snapshot pending');
assert(aggregateGrantStatus(lineGrantItems(snap)) === 'pending', 'aggregate pending');

const fromFields = grantSpecsFromFields('dirt', 3, null);
assert(Array.isArray(fromFields) && fromFields.length === 1, 'fields to specs');
console.log('shop-grants multi-item tests passed');
