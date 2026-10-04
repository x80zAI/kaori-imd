import { createPublicClient, decodeEventLog, encodeFunctionData, http, keccak256 } from 'viem';
import { mainnet } from 'viem/chains';
import { IMD_TOKEN, STAKING_VAULT, STAKING_CODE_HASH, IMD_DECIMALS, SIMD_DECIMALS, VAULT_ABI, TOKEN_ABI } from './staking.mjs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(?:0|[1-9][0-9]{0,77})$/;
const MAX_UINT = (1n << 256n) - 1n;
const ACTIONS = new Set(['approve', 'deposit', 'redeem']);
const RPC_URLS = ['https://ethereum-rpc.publicnode.com', 'https://ethereum.reth.rs/rpc'];

export class StakingWalletError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'StakingWalletError';
    this.code = code;
    this.intent = options.intent ?? null;
    this.terminal = options.terminal ?? false;
  }
}

function fail(message, code, options) { throw new StakingWalletError(message, code, options); }
function address(value) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) fail('Choose a valid Ethereum wallet address.', 'invalid');
  return value.toLowerCase();
}
function rawAmount(value) {
  if (typeof value !== 'string' || !UINT.test(value)) fail('Enter a valid positive token amount.', 'invalid');
  const amount = BigInt(value);
  if (amount === 0n || amount > MAX_UINT) fail('Enter a valid positive token amount.', 'invalid');
  return amount;
}
function normalizeIntent(value, requireHash = false) {
  if (!value || !ACTIONS.has(value.action)) fail('This staking action is invalid.', 'invalid');
  const intent = { account: address(value.account), action: value.action, amountRaw: rawAmount(value.amountRaw).toString() };
  if (requireHash) {
    if (typeof value.hash !== 'string' || !HASH.test(value.hash)) fail('This Ethereum transaction hash is invalid.', 'invalid');
    intent.hash = value.hash.toLowerCase();
  }
  if (value.submittedAfterBlock !== undefined) {
    if (typeof value.submittedAfterBlock !== 'string' || !UINT.test(value.submittedAfterBlock)) fail('This transaction record is invalid.', 'invalid');
    intent.submittedAfterBlock = value.submittedAfterBlock;
  }
  return intent;
}
function emit(callback, stage, intent) {
  // A presentation callback must never lose a broadcast transaction or change its outcome.
  try { callback?.({ stage, ...intent }); } catch { /* Tracking continues independently of the display. */ }
}
function sameAddress(left, right) { return typeof left === 'string' && left.toLowerCase() === right.toLowerCase(); }
function contractAction(intent) {
  const amount = BigInt(intent.amountRaw);
  if (intent.action === 'approve') return { address: IMD_TOKEN, abi: TOKEN_ABI, functionName: 'approve', args: [STAKING_VAULT, amount] };
  return { address: STAKING_VAULT, abi: VAULT_ABI, functionName: intent.action === 'deposit' ? 'deposit' : 'redeem', args: intent.action === 'deposit' ? [amount, intent.account] : [amount, intent.account, intent.account] };
}
function checkCurrent(isCurrent) {
  let current = false;
  try { current = typeof isCurrent === 'function' && isCurrent(); } catch { /* A changed or unavailable context is not permission to send. */ }
  if (!current) fail('Your wallet or staking details changed. Review them and try again.', 'wallet_changed');
}
async function guardWallet(provider, intent, isCurrent) {
  checkCurrent(isCurrent);
  if (!provider || typeof provider.request !== 'function') fail('Open Kaori in a browser with your Ethereum wallet installed.', 'wallet_missing');
  const chain = await provider.request({ method: 'eth_chainId' });
  if (chain !== '0x1' && chain !== '0x01' && chain !== 1) fail('Switch your wallet to Ethereum mainnet before continuing.', 'wrong_chain');
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || !sameAddress(accounts[0], intent.account)) fail('Your selected wallet changed. Review it before continuing.', 'wallet_changed');
  checkCurrent(isCurrent);
}
function errorCode(error) {
  let next = error;
  for (let index = 0; next && index < 6; index += 1) {
    if (next.code === 4001 || next.name === 'UserRejectedRequestError') return 'rejected';
    next = next.cause;
  }
  return null;
}

async function preflight(client, intent) {
  if (await client.getChainId() !== 1) fail('Ethereum mainnet data could not be verified. Try again shortly.', 'verification');
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: STAKING_VAULT, blockNumber });
  if (!code || code === '0x' || keccak256(code).toLowerCase() !== STAKING_CODE_HASH.toLowerCase()) fail('The official IMD staking contract could not be verified. No transaction was sent.', 'verification');
  const readVault = (functionName, args) => client.readContract({ address: STAKING_VAULT, abi: VAULT_ABI, functionName, args, blockNumber });
  const readToken = (functionName, args) => client.readContract({ address: IMD_TOKEN, abi: TOKEN_ABI, functionName, args, blockNumber });
  const [asset, tokenDecimals, shareDecimals, paused] = await Promise.all([readVault('asset'), readToken('decimals'), readVault('decimals'), readVault('paused')]);
  if (!sameAddress(asset, IMD_TOKEN) || Number(tokenDecimals) !== IMD_DECIMALS || Number(shareDecimals) !== SIMD_DECIMALS || typeof paused !== 'boolean') fail('The official IMD staking data could not be verified. No transaction was sent.', 'verification');
  if (paused) fail('The staking vault is paused. No transaction was sent.', 'paused');
  const amount = BigInt(intent.amountRaw);
  if (intent.action === 'redeem') {
    const [balance, maximum, preview] = await Promise.all([readVault('balanceOf', [intent.account]), readVault('maxRedeem', [intent.account]), readVault('previewRedeem', [amount])]);
    if (amount > balance) fail('This amount exceeds your sIMD balance.', 'insufficient_simd');
    if (amount > maximum) fail('This sIMD cannot be withdrawn yet. Refresh after the next Ethereum block.', 'redeem_limit');
    if (preview <= 0n) fail('This amount is too small to return any IMD. Choose a larger amount.', 'zero_quote');
  } else {
    const [balance, maximum, allowance, preview] = await Promise.all([readToken('balanceOf', [intent.account]), readVault('maxDeposit', [intent.account]), readToken('allowance', [intent.account, STAKING_VAULT]), readVault('previewDeposit', [amount])]);
    if (amount > balance) fail('This amount exceeds your IMD balance.', 'insufficient_imd');
    if (amount > maximum) fail('The staking vault cannot accept this IMD amount right now.', 'deposit_limit');
    if (preview <= 0n) fail('This amount is too small to receive any sIMD. Choose a larger amount.', 'zero_quote');
    if (intent.action === 'deposit' && allowance < amount) fail('Approve this IMD amount first, then choose Stake IMD.', 'approval_required');
  }
  const action = contractAction(intent);
  let simulated;
  let gas;
  try {
    simulated = await client.simulateContract({ ...action, account: intent.account, value: 0n });
    gas = await client.estimateGas({ account: intent.account, to: action.address, data: encodeFunctionData(action), value: 0n });
  } catch { fail('Ethereum could not confirm that this action can succeed. Refresh and review your balance before trying again.', 'simulation'); }
  if (typeof gas !== 'bigint' || gas <= 0n || gas > MAX_UINT / 2n) fail('The network fee could not be checked. No transaction was sent.', 'verification');
  if (intent.action === 'approve' ? simulated.result !== true : typeof simulated.result !== 'bigint' || simulated.result <= 0n) fail('This action would not return the expected tokens. No transaction was sent.', 'simulation');
  const paddedGas = gas + gas / 5n + 1n;
  const [ethBalance, gasPrice] = await Promise.all([client.getBalance({ address: intent.account }), client.getGasPrice()]);
  if (typeof ethBalance !== 'bigint' || typeof gasPrice !== 'bigint' || gasPrice <= 0n) fail('The network fee could not be checked. No transaction was sent.', 'verification');
  if (ethBalance < paddedGas * gasPrice) fail('Your wallet needs more ETH to cover the estimated Ethereum network fee.', 'insufficient_eth');
  return { action, gas: paddedGas, blockNumber };
}

function verifyTransaction(transaction, receipt, intent) {
  const expected = contractAction(intent);
  const expectedInput = encodeFunctionData(expected);
  if (!transaction || !sameAddress(transaction.from, intent.account) || !sameAddress(transaction.to, expected.address) || transaction.input?.toLowerCase() !== expectedInput.toLowerCase() || transaction.value !== 0n || (transaction.chainId !== undefined && transaction.chainId !== 1)) {
    fail('Your transaction was changed or cancelled in your wallet. The staking action was not confirmed.', 'replaced', { intent, terminal: true });
  }
  if (receipt.status !== 'success') fail('Ethereum confirmed that this transaction did not complete. Your tokens were not staked or withdrawn by this transaction.', 'reverted', { intent, terminal: true });
  if (!sameAddress(receipt.from, intent.account) || !sameAddress(receipt.to, expected.address) || !HASH.test(receipt.transactionHash) || transaction.hash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || typeof receipt.blockNumber !== 'bigint' || !HASH.test(receipt.blockHash) || transaction.blockNumber !== receipt.blockNumber || transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) fail('This transaction receipt could not be verified. Keep its hash and check again.', 'verification', { intent });
  if (intent.submittedAfterBlock && receipt.blockNumber < BigInt(intent.submittedAfterBlock)) fail('This transaction receipt predates your staking request. Keep its hash and check it on Etherscan.', 'verification', { intent });
  if (!Array.isArray(receipt.logs)) fail('The confirmed token movement could not be verified. Keep its hash and check again.', 'verification', { intent });
  const expectedEvent = intent.action === 'approve' ? 'Approval' : intent.action === 'deposit' ? 'Deposit' : 'Withdraw';
  const matches = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, expected.address)) continue;
    if (log.removed === true || log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() || log.blockNumber !== receipt.blockNumber) fail('Ethereum is updating this receipt. Keep its hash and check again.', 'verification', { intent });
    let event;
    try { event = decodeEventLog({ abi: expected.abi, topics: log.topics, data: log.data, strict: true }); } catch { continue; }
    if (event.eventName !== expectedEvent) continue;
    const args = event.args;
    const amount = BigInt(intent.amountRaw);
    if (intent.action === 'approve') {
      if (sameAddress(args.owner, intent.account) && sameAddress(args.spender, STAKING_VAULT) && (args.amount ?? args.value) === amount) matches.push({});
    } else if (intent.action === 'deposit') {
      if (sameAddress(args.by ?? args.sender, intent.account) && sameAddress(args.owner, intent.account) && args.assets === amount && args.shares > 0n) matches.push({ assetsRaw: args.assets.toString(), sharesRaw: args.shares.toString() });
    } else if (sameAddress(args.by ?? args.sender, intent.account) && sameAddress(args.to ?? args.receiver, intent.account) && sameAddress(args.owner, intent.account) && args.shares === amount && args.assets > 0n) matches.push({ assetsRaw: args.assets.toString(), sharesRaw: args.shares.toString() });
  }
  if (matches.length !== 1) fail('The expected token movement could not be verified. Keep the transaction hash and check again.', 'verification', { intent });
  return { ...intent, hash: receipt.transactionHash.toLowerCase(), blockNumber: receipt.blockNumber.toString(), ...matches[0] };
}

// Dependency injection is used by the private unit tests. Contract addresses, ABI and network remain fixed.
export function createStakingWalletTools({ clients, timeoutMs = 120_000 } = {}) {
  const publicClients = clients ?? RPC_URLS.map(url => createPublicClient({ chain: mainnet, transport: http(url, { timeout: 12_000, retryCount: 0 }), pollingInterval: 4_000 }));
  if (!Array.isArray(publicClients) || !publicClients.length) throw new Error('A public Ethereum client is required');

  async function trackStakingTransaction(input, onProgress) {
    let intent = normalizeIntent(input, true);
    emit(onProgress, 'pending', intent);
    for (const client of publicClients) {
      try {
        if (await client.getChainId() !== 1) throw new Error('Wrong RPC chain');
        const requestedHash = intent.hash;
        let originalTransaction;
        const receipt = await client.waitForTransactionReceipt({ hash: requestedHash, confirmations: 2, timeout: Math.max(1, Math.floor(timeoutMs / publicClients.length)), onReplaced: replacement => {
          originalTransaction = replacement?.replacedTransaction;
          const nextHash = replacement?.transaction?.hash;
          if (typeof nextHash === 'string' && HASH.test(nextHash)) {
            intent = { ...intent, hash: nextHash.toLowerCase() };
            emit(onProgress, 'pending', intent);
          }
        } });
        if (typeof receipt?.transactionHash !== 'string' || !HASH.test(receipt.transactionHash)) throw new Error('Invalid receipt hash');
        intent = { ...intent, hash: receipt.transactionHash.toLowerCase() };
        emit(onProgress, 'pending', intent);
        const [transaction, block, head] = await Promise.all([client.getTransaction({ hash: intent.hash }), client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlockNumber()]);
        if (!block || block.number !== receipt.blockNumber || block.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase() || !Array.isArray(block.transactions) || !block.transactions.some(item => typeof item === 'string' && item.toLowerCase() === intent.hash) || typeof head !== 'bigint' || head - receipt.blockNumber + 1n < 2n) fail('Ethereum is still confirming this transaction. Keep its hash and check again.', 'pending', { intent });
        if (intent.hash !== requestedHash) {
          originalTransaction ??= await client.getTransaction({ hash: requestedHash });
          if (!sameAddress(originalTransaction?.from, intent.account) || !Number.isSafeInteger(originalTransaction.nonce) || originalTransaction.nonce < 0 || originalTransaction.nonce !== transaction.nonce) fail('The replacement transaction could not be matched to your original request. Keep its hash and check again.', 'verification', { intent });
        }
        const result = verifyTransaction(transaction, receipt, intent);
        emit(onProgress, 'confirmed', result);
        return result;
      } catch (error) {
        if (error instanceof StakingWalletError && error.terminal) throw error;
      }
    }
    fail('This transaction has been sent, but its outcome could not be verified yet. Keep the hash and check again before sending another transaction.', 'pending', { intent });
  }

  async function executeStakingTransaction({ provider, account, action, amountRaw, isCurrent, onProgress }) {
    let intent = normalizeIntent({ account, action, amountRaw });
    emit(onProgress, 'checking', intent);
    try {
      await guardWallet(provider, intent, isCurrent);
      let checked;
      for (const client of publicClients) {
        try { checked = await preflight(client, intent); break; }
        catch (error) { if (error instanceof StakingWalletError) throw error; }
      }
      if (!checked) fail('Ethereum data is unavailable. No transaction was sent. Try again shortly.', 'unavailable');
      await guardWallet(provider, intent, isCurrent);
      intent = { ...intent, submittedAfterBlock: checked.blockNumber.toString() };
      emit(onProgress, 'wallet', intent);
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: intent.account, to: checked.action.address, data: encodeFunctionData(checked.action), value: '0x0', chainId: '0x1', gas: `0x${checked.gas.toString(16)}` }] });
      if (typeof hash !== 'string' || !HASH.test(hash)) fail('Your wallet did not return a valid transaction hash. Check your wallet activity before trying again.', 'unknown_broadcast');
      // Do not check isCurrent here: a broadcast belongs to its original account even if the form changes.
      intent = { ...intent, hash: hash.toLowerCase() };
      emit(onProgress, 'pending', intent);
      return await trackStakingTransaction(intent, onProgress);
    } catch (error) {
      if (error instanceof StakingWalletError) {
        if (intent.hash && !error.intent) error.intent = intent;
        throw error;
      }
      if (intent.hash) fail('Your transaction has been sent. Keep its hash and check its outcome before sending another transaction.', 'pending', { intent });
      if (errorCode(error) === 'rejected') fail('You declined the request in your wallet. No transaction was sent by Kaori.', 'rejected');
      fail('The wallet could not complete this request. Check your wallet activity before trying again.', 'wallet_error');
    }
  }
  return { executeStakingTransaction, trackStakingTransaction };
}

const defaultTools = createStakingWalletTools();
export const executeStakingTransaction = defaultTools.executeStakingTransaction;
export const trackStakingTransaction = defaultTools.trackStakingTransaction;
