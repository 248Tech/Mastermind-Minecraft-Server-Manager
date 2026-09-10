import { parsePortalPassword, parsePortalPlayerName, parseShopReturnPath } from './player-auth.names.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parsePortalPlayerName('Steve') === 'Steve', 'accepts Minecraft names');
assert(parsePortalPlayerName('  Steve  ') === 'Steve', 'trims Minecraft names');
assert(parsePortalPlayerName('Builder_One') === 'Builder_One', 'allows underscores');
assert(parsePortalPlayerName('Builder One') === null, 'rejects spaces');
assert(parsePortalPlayerName('') === null, 'rejects empty names');
assert(parsePortalPlayerName('x'.repeat(17)) === null, 'rejects names over 16 chars');
assert(parsePortalPassword('short') === null, 'rejects short passwords');
assert(parsePortalPassword('long-enough-password') === 'long-enough-password', 'accepts passwords');
assert(parseShopReturnPath('/player/shop/cart') === '/player/shop/cart', 'allows cart return');
assert(parseShopReturnPath('/player/shop/cmsy05499016p53v1uj88qtcj') === '/player/shop/cmsy05499016p53v1uj88qtcj', 'allows item return');
assert(parseShopReturnPath('https://evil.example') === '/player/shop', 'rejects absolute urls');
assert(parseShopReturnPath('/login') === '/player/shop', 'rejects other paths');

console.log('player portal name-auth tests passed');
