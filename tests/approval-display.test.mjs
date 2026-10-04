import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApprovalReading } from '../src/approval.mjs';
import { CONTRACT } from '../src/domain.mjs';

const owner = `0x${'1'.repeat(40)}`;
const spender = `0x${'2'.repeat(40)}`;
const reading = {
  chainId: 1, contract: CONTRACT, tokenSymbol: 'IMD', decimals: 18, owner, spender,
  allowanceRaw: '1', allowance: '0.000000000000000001', unlimited: false,
  snapshotBlockNumber: '25000000', snapshotBlockHash: `0x${'a'.repeat(64)}`,
  snapshotTimestamp: '2026-10-04T10:00:00Z', retrievedAt: '2026-10-04T10:00:01Z', provider: 'Ethereum public provider',
};

test('the display preserves the smallest IMD unit and a real zero', () => {
  assert.equal(parseApprovalReading(reading, owner, spender).allowance, '0.000000000000000001');
  assert.equal(parseApprovalReading({ ...reading, allowanceRaw: '0', allowance: '0' }, owner, spender).allowance, '0');
});

test('the maximum allowance is classified exactly, without rounding', () => {
  const raw = ((1n << 256n) - 1n).toString();
  const allowance = '115792089237316195423570985008687907853269984665640564039457.584007913129639935';
  assert.equal(parseApprovalReading({ ...reading, allowanceRaw: raw, allowance, unlimited: true }, owner, spender).unlimited, true);
  assert.throws(() => parseApprovalReading({ ...reading, unlimited: true }, owner, spender), /could not be verified/);
  assert.throws(() => parseApprovalReading({ ...reading, allowanceRaw: (1n << 256n).toString() }, owner, spender), /could not be verified/);
});

test('a different wallet, spender, token or network cannot become a displayed result', () => {
  for (const changed of [{ owner: spender }, { spender: owner }, { contract: owner }, { chainId: 10 }, { decimals: 6 }, { tokenSymbol: 'OTHER' }]) {
    assert.throws(() => parseApprovalReading({ ...reading, ...changed }, owner, spender), /could not be verified/);
  }
});

test('malformed or inconsistent data stays unavailable rather than appearing as zero', () => {
  for (const changed of [{ allowanceRaw: '-1' }, { allowanceRaw: '0x1' }, { allowanceRaw: '01' }, { allowance: '0' }, { snapshotBlockHash: '0x0' }, { retrievedAt: 'not a date' }, { provider: '' }]) {
    assert.throws(() => parseApprovalReading({ ...reading, ...changed }, owner, spender), /could not be verified/);
  }
  assert.throws(() => parseApprovalReading({ error: 'Unavailable' }, owner, spender), /could not be verified/);
  assert.throws(() => parseApprovalReading(null, owner, spender), /could not be verified/);
});
