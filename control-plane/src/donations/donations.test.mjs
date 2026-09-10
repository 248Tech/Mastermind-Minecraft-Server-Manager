import {
  applyChargeRefund,
  creditCompletedSession,
  parseChargeRefund,
  parseDonationAmountCents,
  parseLostDispute,
  parsePaidCheckoutSession,
} from './donations.logic.ts';
import { parseShopItemId, parseShopItemIds, parseShopName, parseShopPriceDollars, detectShopImage, parseShopImageSize } from './donations.shop.ts';
import { buildGivePlusCommand, classifyGrantOutput, parseGrantItemName } from './shop-grants.ts';
import { constructStripeEvent, constructStripeEventWithSecrets, generateTestHeaderString, parseStripeSecretKey, parseStripeWebhookSecret } from './donations.stripe.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseDonationAmountCents(500) === 500, 'accepts $5');
assert(parseDonationAmountCents(50000) === 50000, 'accepts $500');
assert(parseDonationAmountCents(499) === null, 'rejects below $5');
assert(parseDonationAmountCents(50001) === null, 'rejects above $500');
assert(parseDonationAmountCents(10.5) === null, 'rejects fractional cents');
assert(parseDonationAmountCents('1000') === null, 'rejects string amounts');
assert(parseDonationAmountCents(null) === null, 'rejects null');

const at = new Date('2026-08-17T18:00:00.000Z');
const first = creditCompletedSession(null, {
  stripeCheckoutSessionId: 'cs_test_1',
  stripePaymentIntentId: 'pi_test_1',
  amountCents: 1000,
}, { supporter: false, supporterSince: null, totalDonatedCents: 0 }, at);
assert(first.applied === true, 'first payment applies');
assert(first.player.supporter === true && first.player.totalDonatedCents === 1000, 'marks supporter and adds total');
assert(first.player.supporterSince?.toISOString() === at.toISOString(), 'sets supporterSince on first gift');

const replay = creditCompletedSession(first.donation, {
  stripeCheckoutSessionId: 'cs_test_1',
  stripePaymentIntentId: 'pi_test_1',
  amountCents: 1000,
}, first.player, at);
assert(replay.applied === false, 'duplicate checkout session does not apply');
assert(replay.player.totalDonatedCents === 1000, 'duplicate does not double-count');

const second = creditCompletedSession(null, {
  stripeCheckoutSessionId: 'cs_test_2',
  stripePaymentIntentId: 'pi_test_2',
  amountCents: 2500,
}, first.player, new Date('2026-08-18T18:00:00.000Z'));
assert(second.applied && second.player.totalDonatedCents === 3500, 'second distinct session adds');
assert(second.player.supporterSince?.toISOString() === at.toISOString(), 'keeps original supporterSince');

const partial = applyChargeRefund(second.donation, 1000, second.player);
assert(partial.applied && partial.delta === 1000, 'partial refund applies delta');
assert(partial.player.totalDonatedCents === 2500 && partial.player.supporter === true, 'partial refund keeps supporter');
assert(partial.donation.status === 'completed' && partial.donation.refundedCents === 1000, 'partial stays completed');

const partialReplay = applyChargeRefund(partial.donation, 1000, partial.player);
assert(partialReplay.applied === false && partialReplay.player.totalDonatedCents === 2500, 'same refunded amount is idempotent');

const full = applyChargeRefund(partial.donation, 2500, partial.player);
assert(full.applied && full.player.totalDonatedCents === 1000, 'full refund of second gift leaves first gift');
assert(full.donation.status === 'refunded', 'marks donation refunded when fully returned');

const cleared = applyChargeRefund(first.donation, 1000, full.player);
assert(cleared.applied && cleared.player.totalDonatedCents === 0 && cleared.player.supporter === false, 'zero total clears supporter');
assert(cleared.player.supporterSince === null, 'clears supporterSince at zero');

const paid = parsePaidCheckoutSession({
  id: 'cs_live_1',
  payment_status: 'paid',
  amount_total: 2500,
  currency: 'usd',
  payment_intent: 'pi_live_1',
  client_reference_id: 'player_1',
  metadata: { playerId: 'player_1', steamId: '76561198000000000', serverInstanceId: 'cserver1abcdefgh', orgId: 'corg1abcdefghij' },
});
assert(paid && paid.amountCents === 2500 && paid.steamId.endsWith('0000'), 'parses paid checkout metadata');
assert(parsePaidCheckoutSession({
  id: 'cs_unpaid',
  payment_status: 'unpaid',
  amount_total: 2500,
  metadata: { playerId: 'player_1', steamId: '76561198000000000', serverInstanceId: 'cserver1abcdefgh', orgId: 'corg1abcdefghij' },
}) === null, 'ignores unpaid sessions');

const refund = parseChargeRefund({ payment_intent: { id: 'pi_live_1' }, amount_refunded: 2500, refunded: true });
assert(refund && refund.paymentIntentId === 'pi_live_1' && refund.refundedCents === 2500, 'parses charge refund');
assert(parseLostDispute({ status: 'won', payment_intent: 'pi_live_1', amount: 2500 }) === null, 'ignores won disputes');
assert(parseLostDispute({ status: 'lost', payment_intent: 'pi_live_1', amount: 2500 })?.refundedCents === 2500, 'lost dispute refunds amount');
assert(paid.shopItemId === null && paid.shopItemIds.length === 0, 'custom checkout has no shop item');
const shopPaid = parsePaidCheckoutSession({
  id: 'cs_shop_1',
  payment_status: 'paid',
  amount_total: 1500,
  currency: 'usd',
  payment_intent: 'pi_shop_1',
  metadata: { playerId: 'player_1', steamId: '76561198000000000', serverInstanceId: 'cserver1abcdefgh', orgId: 'corg1abcdefghij', shopItemId: 'cshopitemabcdefghijk' },
});
assert(shopPaid && shopPaid.shopItemId === 'cshopitemabcdefghijk' && shopPaid.shopItemIds.length === 1 && shopPaid.amountCents === 1500, 'parses shop item metadata');
const cartPaid = parsePaidCheckoutSession({
  id: 'cs_cart_1',
  payment_status: 'paid',
  amount_total: 2500,
  currency: 'usd',
  payment_intent: 'pi_cart_1',
  metadata: {
    playerId: 'player_1',
    steamId: '76561198000000000',
    serverInstanceId: 'cserver1abcdefgh',
    orgId: 'corg1abcdefghij',
    shopItemIds: 'cshopitemabcdefghijk,cshopitemlmnopqrstuv',
    lineAmounts: '1000,1500',
  },
});
assert(cartPaid && cartPaid.shopItemIds.length === 2 && cartPaid.lineAmounts.join(',') === '1000,1500', 'parses cart metadata');
assert(parseShopItemIds(['cshopitemabcdefghijk', 'cshopitemlmnopqrstuv'])?.length === 2, 'parses cart ids');
assert(parseShopItemIds(['cshopitemabcdefghijk', 'cshopitemabcdefghijk']) === null, 'rejects duplicate cart ids');

assert(parseShopName('  VIP tag  ') === 'VIP tag', 'trims shop names');
assert(parseShopName('') === null, 'rejects empty shop names');
assert(parseShopPriceDollars('10') === 1000, 'parses whole-dollar shop prices');
assert(parseShopPriceDollars('7.50') === 750, 'parses fractional shop prices');
assert(parseShopPriceDollars('0.50') === null, 'rejects shop prices below $1');
assert(parseShopItemId('cshopitemabcdefghijk') === 'cshopitemabcdefghijk', 'accepts shop item ids');
assert(detectShopImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))?.ext === 'jpg', 'detects jpeg');
assert(detectShopImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext === 'png', 'detects png');
assert(detectShopImage(Buffer.from('RIFF....WEBP', 'ascii'))?.ext === 'webp', 'detects webp');
assert(detectShopImage(Buffer.from('not-an-image')) === null, 'rejects non-images');
assert(parseShopImageSize('thumb') === 'thumb', 'parses thumb size');
assert(parseShopImageSize('full') === 'full', 'parses full size');
assert(parseShopImageSize(undefined) === 'full', 'defaults to full size');

const webhookSecret = 'whsec_test_donation_signature';
const payload = JSON.stringify({
  id: 'evt_test_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_sig' } },
});
const validHeader = generateTestHeaderString(payload, webhookSecret);
const event = constructStripeEvent(payload, validHeader, webhookSecret);
assert(event.type === 'checkout.session.completed', 'accepts a valid Stripe signature');
let rejected = false;
try {
  constructStripeEvent(payload, 't=1,v1=deadbeef', webhookSecret);
} catch (error) {
  rejected = error.code === 'bad_signature';
}
assert(rejected, 'rejects a bad Stripe signature');
let stale = false;
try {
  constructStripeEvent(payload, generateTestHeaderString(payload, webhookSecret, Math.floor(Date.now() / 1000) - 301), webhookSecret);
} catch (error) {
  stale = error.code === 'bad_signature';
}
assert(stale, 'rejects an expired Stripe timestamp');
let unconfigured = false;
try {
  constructStripeEvent(payload, validHeader, '');
} catch (error) {
  unconfigured = error.code === 'unconfigured';
}
assert(unconfigured, 'fails closed without a webhook secret');

assert(parseStripeSecretKey('sk_test_abcdefghijklmnopqrstuv') === 'sk_test_abcdefghijklmnopqrstuv', 'accepts test secret keys');
assert(parseStripeSecretKey('sk_live_abcdefghijklmnopqrstuv') === 'sk_live_abcdefghijklmnopqrstuv', 'accepts live secret keys');
assert(parseStripeSecretKey('pk_test_abcdefghijklmnopqrstuv') === null, 'rejects publishable keys');
assert(parseStripeWebhookSecret('whsec_abcdefghijklmnopqrstuv') === 'whsec_abcdefghijklmnopqrstuv', 'accepts webhook secrets');
assert(parseStripeWebhookSecret('sk_test_abcdefghijklmnopqrstuv') === null, 'rejects secret keys as webhook secrets');

const otherSecret = 'whsec_other_donation_signature';
const viaFallback = constructStripeEventWithSecrets(payload, validHeader, ['whsec_wrong_secret_value_here', webhookSecret]);
assert(viaFallback.type === 'checkout.session.completed', 'accepts a later matching webhook secret');
let allBad = false;
try {
  constructStripeEventWithSecrets(payload, validHeader, [otherSecret]);
} catch (error) {
  allBad = error.code === 'bad_signature';
}
assert(allBad, 'rejects when no stored webhook secret matches');
let noneConfigured = false;
try {
  constructStripeEventWithSecrets(payload, validHeader, []);
} catch (error) {
  noneConfigured = error.code === 'unconfigured';
}
assert(noneConfigured, 'fails closed with no webhook secrets');

assert(parseGrantItemName('resourceWood') === 'resourceWood', 'accepts 7DTD item names');
assert(parseGrantItemName('all') === null, 'rejects giveplus all alias');
assert(parseGrantItemName('resourceWood; kick 1') === null, 'rejects command injection in item names');
assert(buildGivePlusCommand('Steve', 'minecraft:oak_log', 12) === 'give Steve minecraft:oak_log 12', 'builds give');
assert(buildGivePlusCommand('all', 'resourceWood', 1) === null, 'never targets all players');
assert(classifyGrantOutput('ERR: Player not found.', 'failed') === 'retry', 'offline giveplus retries');
assert(classifyGrantOutput('There is no such item', 'success') === 'failed', 'unknown items fail closed');
assert(classifyGrantOutput('Gave item', 'success') === 'delivered', 'successful giveplus delivers');

console.log('donation ledger and Stripe signature tests passed');
