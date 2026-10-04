import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStakingUnits, IMD_TOKEN, parsePendingStaking, parseStakingAmount, parseStakingReading, STAKING_CODE_HASH, STAKING_VAULT, ZERO_ADDRESS } from '../src/staking.mjs';

const wallet = '0x20564d3de7dd48c7fc717aa8f9f0ad87ddbd6063';
const maximum = ((1n << 256n) - 1n).toString();
function reading() {
  return { chainId: 1, token: IMD_TOKEN, vault: STAKING_VAULT, codeHash: STAKING_CODE_HASH, assetDecimals: 18, shareDecimals: 24,
    paused: false, owner: ZERO_ADDRESS, totalAssetsRaw: '999999999999999999', totalSupplyRaw: '999999999999999999000000', assetsPerShareRaw: '1000000000000000000',
    wallet: { address: wallet, imdBalanceRaw: '1000000000000000000', shareBalanceRaw: '100000000000000000000000', redeemableAssetsRaw: '100000000000000000', allowanceRaw: '0', maxDepositRaw: maximum, maxRedeemRaw: '100000000000000000000000', lastDepositBlock: '190', ethBalanceRaw: '1000000000000000000' },
    quote: { mode: 'deposit', amountRaw: '1', outputRaw: '1000000' }, snapshotBlockNumber: '200', snapshotBlockHash: `0x${'12'.repeat(32)}`, snapshotTimestamp: '2026-10-04T10:00:00.000Z', retrievedAt: '2026-10-04T10:00:01.000Z', provider: 'PublicNode', source: 'https://ethereum-rpc.publicnode.com' };
}

test('staking amount input preserves every asset/share digit and rejects silent rounding or invalid numeric notation', () => {
  assert.equal(parseStakingAmount('0.000000000000000001', 18), '1');
  assert.equal(parseStakingAmount('0.000000000000000000000001', 24), '1');
  assert.equal(parseStakingAmount('12345678901234567890.123456789012345678901234', 24), '12345678901234567890123456789012345678901234');
  for (const text of ['0', '-1', '+1', '1e18', '1,25', '1.', '.5', 'NaN', 'Infinity', '01', '0.0000000000000000001', maximum]) assert.throws(() => parseStakingAmount(text, 18));
  assert.equal(formatStakingUnits('1', 24), '0.000000000000000000000001');
  assert.equal(formatStakingUnits('1000000000000000001', 18), '1.000000000000000001');
});

test('staking display accepts only the expected verified network, asset, vault, account and exact quote', () => {
  assert.equal(parseStakingReading(reading(), wallet, 'deposit', '1').quote.outputRaw, '1000000');
  for (const patch of [{ chainId: 2 }, { token: 18 }, { token: STAKING_VAULT }, { vault: wallet }, { codeHash: `0x${'33'.repeat(32)}` }, { shareDecimals: 18 }, { assetsPerShareRaw: '0' }, { totalSupplyRaw: '0' }, { quote: null }]) assert.throws(() => parseStakingReading({ ...reading(), ...patch }, wallet, 'deposit', '1'));
  assert.throws(() => parseStakingReading(reading(), ZERO_ADDRESS, 'deposit', '1'));
  assert.throws(() => parseStakingReading(reading(), wallet, 'redeem', '1'));
  assert.throws(() => parseStakingReading(reading(), wallet, 'deposit', '2'));
  const global = { ...reading(), wallet: null, quote: null };
  assert.equal(parseStakingReading(global).wallet, null);
});

test('inconsistent position, hold limits, uint overflow and conversion cannot become a usable staking reading', () => {
  for (const patch of [{ maxRedeemRaw: '0' }, { redeemableAssetsRaw: '0' }, { lastDepositBlock: '201' }, { shareBalanceRaw: maximum }, { maxDepositRaw: '0' }, { ethBalanceRaw: (1n << 256n).toString() }]) assert.throws(() => parseStakingReading({ ...reading(), wallet: { ...reading().wallet, ...patch } }, wallet, 'deposit', '1'));
  assert.throws(() => parseStakingReading({ ...reading(), quote: { mode: 'deposit', amountRaw: '1', outputRaw: '1000001' } }, wallet, 'deposit', '1'));
  const held = reading(); held.wallet.lastDepositBlock = '200'; held.wallet.maxRedeemRaw = '0';
  assert.equal(parseStakingReading(held, wallet, 'deposit', '1').wallet.maxRedeemRaw, '0');
});

test('pending recovery keeps exact original intent and submission block, never trusts malformed session data', () => {
  const intent = { hash: `0x${'aa'.repeat(32)}`, account: wallet, action: 'redeem', amountRaw: '1', submittedAfterBlock: '200' };
  assert.deepEqual(parsePendingStaking(intent), intent);
  for (const patch of [{ action: 'send' }, { hash: '0x1234' }, { account: ZERO_ADDRESS }, { amountRaw: '0' }, { amountRaw: '1e18' }, { submittedAfterBlock: '-1' }]) assert.equal(parsePendingStaking({ ...intent, ...patch }), null);
});
