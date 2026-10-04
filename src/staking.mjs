import { CONTRACT } from './domain.mjs';
export { VAULT_ABI, TOKEN_ABI } from './staking-abi.mjs';

export const IMD_TOKEN = CONTRACT.toLowerCase();
export const STAKING_VAULT = '0x9efa934d9fad4ae28c998a40195646b965a97247';
export const STAKING_CODE_HASH = '0xe8333ecf3ae9263b14d6a1ab59d6f384c16d8609c1725edf31b0dcd1780280e5';
export const IMD_DECIMALS = 18;
export const SIMD_DECIMALS = 24;
export const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const MAX_UINT = (1n << 256n) - 1n;

export function isStakingAddress(value) {
  return typeof value === 'string' && ADDRESS.test(value) && value.toLowerCase() !== ZERO_ADDRESS;
}

export function parseStakingAmount(value, decimals) {
  if (![IMD_DECIMALS, SIMD_DECIMALS].includes(decimals) || typeof value !== 'string' || value.length > 104) throw new Error('Enter a valid amount.');
  const text = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) throw new Error('Use a positive number with a decimal point, without commas or exponent notation.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports up to ${decimals} decimal places. Extra digits cannot be rounded away.`);
  const raw = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (raw <= 0n || raw > MAX_UINT) throw new Error('Enter an amount greater than zero within the token limit.');
  return raw.toString();
}

export function formatStakingUnits(raw, decimals) {
  const text = typeof raw === 'bigint' ? raw.toString() : raw;
  if (![IMD_DECIMALS, SIMD_DECIMALS].includes(decimals) || typeof text !== 'string' || !UINT.test(text) || BigInt(text) > MAX_UINT) throw new Error('Invalid token amount.');
  const padded = text.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}

/**
 * @param {string|null} [expectedOwner]
 * @param {string|null} [expectedMode]
 * @param {string|null} [expectedAmount]
 */
export function parseStakingReading(value, expectedOwner = null, expectedMode = null, expectedAmount = null) {
  const invalid = () => { throw new Error('Staking data could not be verified. Refresh the reading before continuing.'); };
  const uint = item => typeof item === 'string' && UINT.test(item) && BigInt(item) <= MAX_UINT;
  const address = item => typeof item === 'string' && /^0x[0-9a-f]{40}$/.test(item);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.chainId !== 1 || typeof value.token !== 'string' || value.token.toLowerCase() !== IMD_TOKEN ||
      value.vault !== STAKING_VAULT || value.codeHash !== STAKING_CODE_HASH || value.assetDecimals !== 18 || value.shareDecimals !== 24 ||
      typeof value.paused !== 'boolean' || !address(value.owner) ||
      ![value.totalAssetsRaw, value.totalSupplyRaw, value.assetsPerShareRaw, value.snapshotBlockNumber].every(uint) ||
      !/^0x[0-9a-f]{64}$/.test(value.snapshotBlockHash) ||
      ![value.snapshotTimestamp, value.retrievedAt].every(item => typeof item === 'string' && Number.isFinite(Date.parse(item))) ||
      typeof value.provider !== 'string' || !value.provider.trim() || typeof value.source !== 'string' || !value.source.startsWith('https://')) invalid();
  if (BigInt(value.snapshotBlockNumber) === 0n || BigInt(value.assetsPerShareRaw) === 0n) invalid();
  const virtualAssets = BigInt(value.totalAssetsRaw) + 1n;
  const virtualShares = BigInt(value.totalSupplyRaw) + 1_000_000n;
  if (BigInt(value.assetsPerShareRaw) !== 10n ** 24n * virtualAssets / virtualShares) invalid();
  if (expectedOwner === null) {
    if (value.wallet !== null) invalid();
  } else {
    const wallet = value.wallet;
    if (!isStakingAddress(expectedOwner) || !wallet || wallet.address !== expectedOwner.toLowerCase() ||
        ![wallet.imdBalanceRaw, wallet.shareBalanceRaw, wallet.redeemableAssetsRaw, wallet.allowanceRaw, wallet.maxDepositRaw,
          wallet.maxRedeemRaw, wallet.lastDepositBlock, wallet.ethBalanceRaw].every(uint) ||
        BigInt(wallet.shareBalanceRaw) > BigInt(value.totalSupplyRaw) || BigInt(wallet.lastDepositBlock) > BigInt(value.snapshotBlockNumber)) invalid();
    if (BigInt(wallet.maxDepositRaw) !== (value.paused ? 0n : MAX_UINT) || BigInt(wallet.maxRedeemRaw) !== (value.paused || wallet.lastDepositBlock === value.snapshotBlockNumber ? 0n : BigInt(wallet.shareBalanceRaw))) invalid();
    if (BigInt(wallet.redeemableAssetsRaw) !== BigInt(wallet.shareBalanceRaw) * virtualAssets / virtualShares) invalid();
  }
  if (expectedMode === null && expectedAmount === null) {
    if (value.quote !== null) invalid();
  } else if (expectedOwner === null || !['deposit', 'redeem'].includes(expectedMode) || !uint(expectedAmount) || expectedAmount === '0' ||
      value.quote?.mode !== expectedMode || value.quote.amountRaw !== expectedAmount || !uint(value.quote.outputRaw)) invalid();
  if (value.quote && BigInt(value.quote.outputRaw) !== (expectedMode === 'deposit' ? BigInt(expectedAmount) * virtualShares / virtualAssets : BigInt(expectedAmount) * virtualAssets / virtualShares)) invalid();
  return value;
}

export function parsePendingStaking(value) {
  if (!value || typeof value !== 'object' || !/^0x[0-9a-fA-F]{64}$/.test(value.hash) || !isStakingAddress(value.account) ||
      !['approve', 'deposit', 'redeem'].includes(value.action) || typeof value.amountRaw !== 'string' || !UINT.test(value.amountRaw) ||
      BigInt(value.amountRaw) <= 0n || BigInt(value.amountRaw) > MAX_UINT) return null;
  if (value.submittedAfterBlock !== undefined && (typeof value.submittedAfterBlock !== 'string' || !UINT.test(value.submittedAfterBlock) || BigInt(value.submittedAfterBlock) > MAX_UINT)) return null;
  return { hash: value.hash.toLowerCase(), account: value.account.toLowerCase(), action: value.action, amountRaw: value.amountRaw,
    ...(value.submittedAfterBlock !== undefined ? { submittedAfterBlock: value.submittedAfterBlock } : {}) };
}
