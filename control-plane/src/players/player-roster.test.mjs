import { cleanRosterIp, parseMinecraftRoster, rosterIdentityKey } from './player-roster.ts';
import assert from 'node:assert/strict';

assert(rosterIdentityKey('76561198000000000', 'Steve') === 'steam:76561198000000000', 'steam identity key');
assert(rosterIdentityKey(null, 'Alex') === 'name:alex', 'name identity key is lowercased');

assert(cleanRosterIp('203.0.113.10:25565') === '203.0.113.10', 'strips v4 port');
assert(cleanRosterIp('[2001:db8::1]:25565') === '2001:db8::1', 'strips v6 brackets and port');
assert(cleanRosterIp('unknown') === null, 'rejects unknown placeholder');
assert(cleanRosterIp(null) === null, 'null ip stays null');

const roster = parseMinecraftRoster({
  players: [
    { name: 'Steve', uuid: '550e8400-e29b-41d4-a716-446655440000' },
    { name: 'Alex' },
    { name: 'TooLongNameForMinecraft' },
    { player: 'Bob', id: 'aabbccddeeff00112233445566778899' },
  ],
});
assert(Array.isArray(roster) && roster.length === 3, 'parses minecraft players and skips invalid names');
assert(roster[0].name === 'Steve' && roster[0].identityKey === 'uuid:550e8400-e29b-41d4-a716-446655440000', 'uuid identity');
assert(roster[1].name === 'Alex' && roster[1].identityKey === 'name:alex', 'name fallback identity');
assert(roster[2].name === 'Bob' && roster[2].identityKey.startsWith('uuid:'), 'accepts id as uuid');
assert(roster.every((row) => row.playerKills === undefined && row.deaths === 0), 'no playerKills; deaths default 0');

assert(parseMinecraftRoster({ players: [] })?.length === 0, 'empty players list is usable');
assert(parseMinecraftRoster(null) === null, 'null result falls back');
assert(parseMinecraftRoster({ hello: true }) === null, 'unknown object falls back');
assert(parseMinecraftRoster([{ name: 'Inline' }])?.[0].name === 'Inline', 'accepts bare array');

console.log('player roster minecraft tests passed');
