import {
  decodeWord, formatUnits, IMD_CONTRACT, IMD_DECIMALS, parseQuantity,
  PUBLIC_PROVIDERS, PublicError, quantityHex, readBlock, rpcBatch,
  validateContract, withDeadline,
} from './ethereum.mjs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const MAX_UINT256 = 2n ** 256n - 1n;
const ALLOWANCE_SELECTOR = '0xdd62ed3e';
const MAX_CACHE = 65;
const MAX_INFLIGHT = 32;

export function validateAllowanceAddress(value, role) {
  if (!['owner', 'spender'].includes(role)) throw new Error('Invalid address role');
  const label = role === 'owner' ? 'wallet' : 'application';
  if (typeof value !== 'string' || !ADDRESS.test(value)) {
    throw new PublicError(`Enter a complete Ethereum ${label} address: 0x followed by 40 hexadecimal characters.`, 400, 'invalid');
  }
  const address = value.toLowerCase();
  if (address === ZERO_ADDRESS) throw new PublicError(`Enter a non-zero Ethereum ${label} address.`, 400, 'invalid');
  return address;
}

async function readAllowanceSnapshot(provider, owner, spender, fetchImpl, signal, now) {
  const [chainId, latest] = await rpcBatch(provider, [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
  ], fetchImpl, signal);
  if (parseQuantity(chainId) !== 1n) throw new Error('Wrong Ethereum network');
  const snapshot = readBlock(latest);
  const blockTag = quantityHex(snapshot.number);
  const data = `${ALLOWANCE_SELECTOR}${owner.slice(2).padStart(64, '0')}${spender.slice(2).padStart(64, '0')}`;
  const [code, decimals, allowanceWord] = await rpcBatch(provider, [
    { method: 'eth_getCode', params: [IMD_CONTRACT, blockTag] },
    { method: 'eth_call', params: [{ to: IMD_CONTRACT, data: '0x313ce567' }, blockTag] },
    { method: 'eth_call', params: [{ to: IMD_CONTRACT, data }, blockTag] },
  ], fetchImpl, signal);
  validateContract(code, decimals);
  const allowance = decodeWord(allowanceWord);
  const [head] = await rpcBatch(provider, [
    { method: 'eth_getBlockByNumber', params: [blockTag, false] },
  ], fetchImpl, signal);
  // Reject a changed canonical block instead of combining observations across a reorganization.
  readBlock(head, snapshot.number, snapshot.hash);
  return {
    chainId: 1,
    contract: IMD_CONTRACT,
    tokenSymbol: 'IMD',
    decimals: IMD_DECIMALS,
    owner,
    spender,
    allowanceRaw: allowance.toString(),
    allowance: formatUnits(allowance, IMD_DECIMALS),
    unlimited: allowance === MAX_UINT256,
    snapshotBlockNumber: snapshot.number.toString(),
    snapshotBlockHash: snapshot.hash,
    snapshotTimestamp: snapshot.timestamp,
    retrievedAt: new Date(now()).toISOString(),
    provider: provider.name,
    source: provider.url,
  };
}

export function createAllowanceService({ fetchImpl = globalThis.fetch, providers = PUBLIC_PROVIDERS, timeoutMs = 12_000, cacheMs = 15_000, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Array.isArray(providers) || providers.length < 1 || providers.length > 2 ||
    !providers.every((provider) => typeof provider?.name === 'string' && typeof provider?.url === 'string') ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 12_000 || !Number.isFinite(cacheMs) || cacheMs < 0) {
    throw new Error('Invalid service configuration');
  }
  const cache = new Map();
  const pending = new Map();

  async function retrieve(owner, spender) {
    for (const provider of providers) {
      try {
        return await withDeadline((signal) => readAllowanceSnapshot(provider, owner, spender, fetchImpl, signal, now), timeoutMs);
      } catch { /* Repeat the entire snapshot with the next provider; unavailable data never becomes zero. */ }
    }
    throw new PublicError('The IMD approval could not be read from Ethereum right now. Please try again shortly.');
  }

  async function getAllowance(ownerValue, spenderValue) {
    const owner = validateAllowanceAddress(ownerValue, 'owner');
    const spender = validateAllowanceAddress(spenderValue, 'spender');
    const key = `${owner}:${spender}`;
    const entry = cache.get(key);
    const current = now();
    if (entry && current >= entry.savedAt && current - entry.savedAt < cacheMs) return structuredClone(entry.value);
    if (entry) cache.delete(key);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (pending.size >= MAX_INFLIGHT) throw new PublicError('Too many Ethereum requests are in progress. Please try again shortly.');
    const operation = retrieve(owner, spender).then((value) => {
      cache.delete(key);
      cache.set(key, { value, savedAt: now() });
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      return value;
    });
    pending.set(key, operation);
    try { return structuredClone(await operation); }
    finally { pending.delete(key); }
  }
  return { getAllowance };
}

export const allowanceService = createAllowanceService();
