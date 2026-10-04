import { encodeFunctionData, keccak256 } from 'viem';
import {
  IMD_DECIMALS, IMD_TOKEN, SIMD_DECIMALS, STAKING_CODE_HASH, STAKING_VAULT,
  TOKEN_ABI, VAULT_ABI,
} from '../src/staking.mjs';
import {
  decodeWord, parseQuantity, PUBLIC_PROVIDERS, PublicError, quantityHex,
  readBlock, rpcBatch, validateContract, withDeadline,
} from './ethereum.mjs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_INFLIGHT = 32;

export function validateStakingRequest(owner = null, mode = null, amount = null) {
  let address = null;
  if (owner !== null) {
    if (typeof owner !== 'string' || !ADDRESS.test(owner) || owner.toLowerCase() === ZERO_ADDRESS) {
      throw new PublicError('Enter a complete, non-zero Ethereum wallet address.', 400, 'invalid');
    }
    address = owner.toLowerCase();
  }
  if (mode === null && amount === null) return { address, mode: null, amount: null };
  if (address === null || !['deposit', 'redeem'].includes(mode) || typeof amount !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(amount) || BigInt(amount) > MAX_UINT256) {
    throw new PublicError('Provide a wallet address, deposit or redeem mode, and a positive whole amount in token units.', 400, 'invalid');
  }
  return { address, mode, amount: BigInt(amount) };
}

function decodeAddress(value) {
  decodeWord(value);
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid ABI address');
  return `0x${value.slice(-40)}`.toLowerCase();
}

function decodeBoolean(value) {
  const number = decodeWord(value);
  if (number !== 0n && number !== 1n) throw new Error('Invalid ABI boolean');
  return number === 1n;
}

function call(address, abi, name, args, blockTag) {
  return { method: 'eth_call', params: [{ to: address, data: encodeFunctionData({ abi, functionName: name, args }) }, blockTag] };
}

async function readStakingSnapshot(provider, request, fetchImpl, signal, now) {
  const [chainId, latest] = await rpcBatch(provider, [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
  ], fetchImpl, signal);
  if (parseQuantity(chainId) !== 1n) throw new Error('Wrong Ethereum network');
  const snapshot = readBlock(latest);
  const blockTag = quantityHex(snapshot.number);
  const calls = [
    { method: 'eth_getCode', params: [IMD_TOKEN, blockTag] },
    { method: 'eth_getCode', params: [STAKING_VAULT, blockTag] },
    call(IMD_TOKEN, TOKEN_ABI, 'decimals', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'asset', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'decimals', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'paused', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'owner', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'totalAssets', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'totalSupply', [], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'convertToAssets', [10n ** BigInt(SIMD_DECIMALS)], blockTag),
  ];
  if (request.address) calls.push(
    call(IMD_TOKEN, TOKEN_ABI, 'balanceOf', [request.address], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'balanceOf', [request.address], blockTag),
    call(IMD_TOKEN, TOKEN_ABI, 'allowance', [request.address, STAKING_VAULT], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'maxDeposit', [request.address], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'maxRedeem', [request.address], blockTag),
    call(STAKING_VAULT, VAULT_ABI, 'lastDepositBlock', [request.address], blockTag),
    { method: 'eth_getBalance', params: [request.address, blockTag] },
  );
  const [tokenCode, vaultCode, assetDecimals, asset, shareDecimals, pause, vaultOwner, assets, supply, rate, ...position] =
    await rpcBatch(provider, calls, fetchImpl, signal);
  validateContract(tokenCode, assetDecimals);
  if (typeof vaultCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(vaultCode) ||
    keccak256(vaultCode) !== STAKING_CODE_HASH || decodeAddress(asset) !== IMD_TOKEN ||
    decodeWord(shareDecimals) !== BigInt(SIMD_DECIMALS)) throw new Error('Unexpected staking contract');
  const paused = decodeBoolean(pause);
  const owner = decodeAddress(vaultOwner);
  const totalAssets = decodeWord(assets);
  const totalSupply = decodeWord(supply);
  const assetsPerShare = decodeWord(rate);
  const virtualAssets = totalAssets + 1n;
  const virtualShares = totalSupply + 1_000_000n;
  if (assetsPerShare !== 10n ** BigInt(SIMD_DECIMALS) * virtualAssets / virtualShares) {
    throw new Error('Inconsistent staking conversion');
  }
  let wallet = null;
  if (request.address) {
    const [balance, shares, allowance, maxDeposit, maxRedeem, lastDeposit, ethBalance] = position;
    const shareBalance = decodeWord(shares);
    const lastDepositBlock = decodeWord(lastDeposit);
    const depositLimit = decodeWord(maxDeposit);
    const redeemLimit = decodeWord(maxRedeem);
    if (shareBalance > totalSupply || lastDepositBlock > snapshot.number || depositLimit !== (paused ? 0n : MAX_UINT256) ||
      redeemLimit !== (paused || lastDepositBlock === snapshot.number ? 0n : shareBalance)) {
      throw new Error('Inconsistent staking limits');
    }
    wallet = {
      address: request.address,
      imdBalanceRaw: decodeWord(balance).toString(),
      shareBalanceRaw: shareBalance.toString(),
      redeemableAssetsRaw: '',
      allowanceRaw: decodeWord(allowance).toString(),
      maxDepositRaw: depositLimit.toString(),
      maxRedeemRaw: redeemLimit.toString(),
      lastDepositBlock: lastDepositBlock.toString(),
      ethBalanceRaw: parseQuantity(ethBalance).toString(),
    };
  }
  const derivedCalls = [];
  if (wallet) derivedCalls.push(call(STAKING_VAULT, VAULT_ABI, 'convertToAssets', [BigInt(wallet.shareBalanceRaw)], blockTag));
  if (request.mode) derivedCalls.push(call(STAKING_VAULT, VAULT_ABI,
    request.mode === 'deposit' ? 'previewDeposit' : 'previewRedeem', [request.amount], blockTag));
  const derived = derivedCalls.length ? await rpcBatch(provider, derivedCalls, fetchImpl, signal) : [];
  if (wallet) {
    const redeemableAssets = decodeWord(derived.shift());
    if (redeemableAssets !== BigInt(wallet.shareBalanceRaw) * virtualAssets / virtualShares) {
      throw new Error('Inconsistent staking position');
    }
    wallet.redeemableAssetsRaw = redeemableAssets.toString();
  }
  let quote = null;
  if (request.mode) {
    const output = decodeWord(derived.shift());
    const expected = request.mode === 'deposit' ? request.amount * virtualShares / virtualAssets : request.amount * virtualAssets / virtualShares;
    if (output !== expected) throw new Error('Inconsistent staking preview');
    quote = { mode: request.mode, amountRaw: request.amount.toString(), outputRaw: output.toString() };
  }
  const [head] = await rpcBatch(provider, [
    { method: 'eth_getBlockByNumber', params: [blockTag, false] },
  ], fetchImpl, signal);
  readBlock(head, snapshot.number, snapshot.hash);
  return {
    chainId: 1, token: IMD_TOKEN, vault: STAKING_VAULT,
    assetDecimals: IMD_DECIMALS, shareDecimals: SIMD_DECIMALS, codeHash: STAKING_CODE_HASH,
    paused, owner, totalAssetsRaw: totalAssets.toString(), totalSupplyRaw: totalSupply.toString(),
    assetsPerShareRaw: assetsPerShare.toString(), wallet, quote,
    snapshotBlockNumber: snapshot.number.toString(), snapshotBlockHash: snapshot.hash, snapshotTimestamp: snapshot.timestamp,
    retrievedAt: new Date(now()).toISOString(), provider: provider.name, source: provider.url,
  };
}

export function createStakingService({ fetchImpl = globalThis.fetch, providers = PUBLIC_PROVIDERS, timeoutMs = 12_000, cacheMs = 10_000, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Array.isArray(providers) || providers.length < 1 || providers.length > 2 ||
    !providers.every((provider) => typeof provider?.name === 'string' && typeof provider?.url === 'string') ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 12_000 || !Number.isFinite(cacheMs) || cacheMs < 0 || cacheMs > 10_000) {
    throw new Error('Invalid service configuration');
  }
  let globalCache = null;
  const pending = new Map();
  async function retrieve(request) {
    for (const provider of providers) {
      try { return await withDeadline((signal) => readStakingSnapshot(provider, request, fetchImpl, signal, now), timeoutMs); }
      catch { /* Start a complete fresh snapshot on the next provider; failures never become balances. */ }
    }
    throw new PublicError('The IMD staking position could not be read from Ethereum right now. Please try again shortly.');
  }
  async function getStaking(owner = null, mode = null, amount = null) {
    const request = validateStakingRequest(owner, mode, amount);
    const key = `${request.address ?? ''}:${request.mode ?? ''}:${request.amount ?? ''}`;
    const current = now();
    if (request.address === null && globalCache && current >= globalCache.savedAt && current - globalCache.savedAt < cacheMs) {
      return structuredClone(globalCache.value);
    }
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (pending.size >= MAX_INFLIGHT) throw new PublicError('Too many Ethereum requests are in progress. Please try again shortly.');
    const operation = retrieve(request).then((value) => {
      if (request.address === null) globalCache = { value, savedAt: now() };
      return value;
    });
    pending.set(key, operation);
    try { return structuredClone(await operation); }
    finally { pending.delete(key); }
  }
  return { getStaking };
}

export const stakingService = createStakingService();
