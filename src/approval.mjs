import { CONTRACT } from './domain.mjs';

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const MAX_ALLOWANCE = (1n << 256n) - 1n;
const UINT = /^(0|[1-9][0-9]{0,77})$/;

export function parseApprovalReading(value, owner, spender) {
  const invalid = () => { throw new Error('IMD approval data could not be verified. Please try again.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.chainId !== 1 ||
      typeof value.contract !== 'string' || value.contract.toLowerCase() !== CONTRACT.toLowerCase() ||
      value.tokenSymbol !== 'IMD' || value.decimals !== 18 || value.owner !== owner || value.spender !== spender ||
      typeof value.allowanceRaw !== 'string' || !UINT.test(value.allowanceRaw) ||
      typeof value.snapshotBlockNumber !== 'string' || !UINT.test(value.snapshotBlockNumber) ||
      typeof value.snapshotBlockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.snapshotBlockHash) ||
      typeof value.snapshotTimestamp !== 'string' || !Number.isFinite(Date.parse(value.snapshotTimestamp)) ||
      typeof value.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.retrievedAt)) ||
      typeof value.provider !== 'string' || !value.provider.trim()) invalid();
  const raw = BigInt(value.allowanceRaw);
  if (raw > MAX_ALLOWANCE) invalid();
  const padded = value.allowanceRaw.padStart(19, '0');
  const fraction = padded.slice(-18).replace(/0+$/, '');
  const expectedAmount = `${padded.slice(0, -18)}${fraction ? `.${fraction}` : ''}`;
  if (value.allowance !== expectedAmount || value.unlimited !== (raw === MAX_ALLOWANCE)) invalid();
  return value;
}
