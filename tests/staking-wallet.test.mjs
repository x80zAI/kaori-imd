import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData } from 'viem';
import { createStakingWalletTools, StakingWalletError } from '../src/staking-wallet.mjs';
import { IMD_TOKEN, STAKING_VAULT, VAULT_ABI, TOKEN_ABI } from '../src/staking.mjs';

const runtime = JSON.parse(await readFile(new URL('./fixtures/staking-vault-runtime.json', import.meta.url), 'utf8'));
const ACCOUNT = `0x${'12'.repeat(20)}`;
const OTHER = `0x${'34'.repeat(20)}`;
const HASH = `0x${'56'.repeat(32)}`;
const REPLACEMENT = `0x${'78'.repeat(32)}`;
const BLOCK_HASH = `0x${'9a'.repeat(32)}`;
const MAX_UINT = (1n << 256n) - 1n;
const ASSETS = 1234567890123456789n;
const SHARES = 987654321098765432109876n;

function actionData(action, amount) {
  if (action === 'approve') return { address: IMD_TOKEN, abi: TOKEN_ABI, functionName: 'approve', args: [STAKING_VAULT, amount] };
  return { address: STAKING_VAULT, abi: VAULT_ABI, functionName: action === 'deposit' ? 'deposit' : 'redeem', args: action === 'deposit' ? [amount, ACCOUNT] : [amount, ACCOUNT, ACCOUNT] };
}
function eventLog(action, amount) {
  const abi = action === 'approve' ? TOKEN_ABI : VAULT_ABI;
  const eventName = action === 'approve' ? 'Approval' : action === 'deposit' ? 'Deposit' : 'Withdraw';
  const args = action === 'approve' ? { owner: ACCOUNT, spender: STAKING_VAULT, value: amount } : action === 'deposit' ? { by: ACCOUNT, owner: ACCOUNT, assets: amount, shares: SHARES } : { by: ACCOUNT, to: ACCOUNT, owner: ACCOUNT, assets: ASSETS, shares: amount };
  const event = abi.find(item => item.type === 'event' && item.name === eventName);
  const dataInputs = event.inputs.filter(input => !input.indexed);
  return { address: action === 'approve' ? IMD_TOKEN : STAKING_VAULT, topics: encodeEventTopics({ abi, eventName, args }), data: encodeAbiParameters(dataInputs, dataInputs.map(input => args[input.name])) };
}
function fixture(action = 'deposit', options = {}) {
  const amount = action === 'redeem' ? SHARES : ASSETS;
  const calls = [];
  const actionInfo = actionData(action, amount);
  let waited = false;
  let current = true;
  const receipt = { transactionHash: HASH, status: 'success', from: ACCOUNT, to: actionInfo.address, blockNumber: 100n, blockHash: BLOCK_HASH, logs: [eventLog(action, amount)], ...options.receipt };
  receipt.logs = receipt.logs.map(log => ({ transactionHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, removed: false, ...log }));
  const transaction = { hash: receipt.transactionHash, from: ACCOUNT, to: actionInfo.address, input: encodeFunctionData(actionInfo), value: 0n, chainId: 1, nonce: 10, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...options.transaction };
  const client = {
    getChainId: async () => options.rpcChain ?? 1,
    getBlockNumber: async () => waited ? options.head ?? 101n : 100n,
    getCode: async () => options.code ?? runtime.code,
    readContract: async request => {
      calls.push({ method: 'readContract', request });
      if (options.readError) throw new Error('RPC failed');
      const values = { asset: IMD_TOKEN, decimals: request.address === IMD_TOKEN ? 18 : 24, paused: false, balanceOf: MAX_UINT, maxDeposit: MAX_UINT, maxRedeem: MAX_UINT, allowance: MAX_UINT, previewDeposit: SHARES, previewRedeem: ASSETS, ...options.reads };
      return values[request.functionName];
    },
    simulateContract: async request => { calls.push({ method: 'simulateContract', request }); if (options.simulationError) throw new Error('Call reverted'); return { result: options.simulationResult ?? (action === 'approve' ? true : action === 'deposit' ? SHARES : ASSETS) }; },
    estimateGas: async request => { calls.push({ method: 'estimateGas', request }); return options.gas ?? 100_000n; },
    getBalance: async () => options.ethBalance ?? 1_000_000_000_000_000_000n,
    getGasPrice: async () => 1_000_000_000n,
    waitForTransactionReceipt: async request => { calls.push({ method: 'wait', request }); waited = true; if (options.timeout) throw new Error('Receipt timeout'); if (options.replacement) request.onReplaced({ transaction: { hash: REPLACEMENT }, reason: options.replacement }); return receipt; },
    getTransaction: async () => transaction,
    getBlock: async () => ({ number: receipt.blockNumber, hash: options.canonicalHash ?? BLOCK_HASH, transactions: [receipt.transactionHash] }),
  };
  let guardCount = 0;
  const provider = { request: async request => {
    calls.push({ method: request.method, request });
    if (request.method === 'eth_chainId') { guardCount += 1; return options.walletChain ?? '0x1'; }
    if (request.method === 'eth_accounts') return [options.changedAccount && guardCount > 1 ? OTHER : ACCOUNT];
    if (request.method === 'eth_sendTransaction') {
      if (options.rejected) throw Object.assign(new Error('Rejected'), { code: 4001 });
      if (options.changeAfterSend) current = false;
      if (options.onSend) options.onSend();
      return options.returnedHash ?? HASH;
    }
    throw new Error(`Unexpected wallet method ${request.method}`);
  } };
  const tools = createStakingWalletTools({ clients: [client], timeoutMs: 1 });
  const progress = [];
  const input = { provider, account: ACCOUNT, action, amountRaw: amount.toString(), isCurrent: () => current, onProgress: item => progress.push(item) };
  return { tools, input, calls, progress, client, receipt, transaction };
}
const noSend = item => assert.equal(item.calls.filter(call => call.method === 'eth_sendTransaction').length, 0);
const rejectsCode = code => error => error instanceof StakingWalletError && error.code === code;

test('deposit sends only the exact IMD amount to the fixed vault and verifies real movement', async () => {
  const item = fixture();
  const result = await item.tools.executeStakingTransaction(item.input);
  const sent = item.calls.find(call => call.method === 'eth_sendTransaction').request.params[0];
  assert.equal(sent.to, STAKING_VAULT);
  assert.equal(sent.from, ACCOUNT);
  assert.equal(sent.chainId, '0x1');
  assert.equal(sent.value, '0x0');
  assert.equal(sent.data, encodeFunctionData(actionData('deposit', ASSETS)));
  assert.equal(result.assetsRaw, ASSETS.toString());
  assert.equal(result.sharesRaw, SHARES.toString());
  assert.equal(result.hash, HASH);
  assert.equal(item.progress.at(-1).stage, 'confirmed');
  assert.equal(item.calls.find(call => call.method === 'wait').request.confirmations, 2);
});
test('approval grants only the requested amount and sends no automatic deposit', async () => {
  const item = fixture('approve', { reads: { allowance: 0n } });
  await item.tools.executeStakingTransaction(item.input);
  const writes = item.calls.filter(call => call.method === 'eth_sendTransaction');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].request.params[0].to, IMD_TOKEN);
  assert.equal(writes[0].request.params[0].data, encodeFunctionData(actionData('approve', ASSETS)));
});
test('redemption preserves all 24 share decimals and always returns IMD to its owner', async () => {
  const item = fixture('redeem');
  const result = await item.tools.executeStakingTransaction(item.input);
  assert.equal(item.calls.find(call => call.method === 'eth_sendTransaction').request.params[0].data, encodeFunctionData(actionData('redeem', SHARES)));
  assert.equal(result.sharesRaw, SHARES.toString());
  assert.equal(result.assetsRaw, ASSETS.toString());
  assert.equal(item.calls.filter(call => call.method === 'readContract' && call.request.functionName === 'allowance').length, 0);
});
test('wrong wallet network and a changed selected account prevent any wallet prompt', async () => {
  const wrong = fixture('deposit', { walletChain: '0x89' });
  await assert.rejects(wrong.tools.executeStakingTransaction(wrong.input), rejectsCode('wrong_chain'));
  noSend(wrong);
  const changed = fixture('deposit', { changedAccount: true });
  await assert.rejects(changed.tools.executeStakingTransaction(changed.input), rejectsCode('wallet_changed'));
  noSend(changed);
});
test('expired form context prevents a transaction before any wallet prompt', async () => {
  const item = fixture(); item.input.isCurrent = () => false;
  await assert.rejects(item.tools.executeStakingTransaction(item.input), rejectsCode('wallet_changed'));
  noSend(item);
});
test('unknown code, changed underlying token and wrong share decimals stop deposits', async () => {
  for (const options of [{ code: '0x6000' }, { reads: { asset: OTHER } }, { reads: { decimals: 18 } }]) {
    const item = fixture('deposit', options);
    await assert.rejects(item.tools.executeStakingTransaction(item.input), rejectsCode('verification'));
    noSend(item);
  }
});
test('pause, insufficient approval, balance and zero output are not successes', async () => {
  for (const [reads, code] of [[{ paused: true }, 'paused'], [{ allowance: 0n }, 'approval_required'], [{ balanceOf: 1n }, 'insufficient_imd'], [{ previewDeposit: 0n }, 'zero_quote'], [{ maxDeposit: 0n }, 'deposit_limit']]) {
    const item = fixture('deposit', { reads });
    await assert.rejects(item.tools.executeStakingTransaction(item.input), rejectsCode(code));
    noSend(item);
  }
});
test('same-block hold and a redemption returning zero IMD never reach the wallet', async () => {
  for (const [reads, code] of [[{ maxRedeem: 0n }, 'redeem_limit'], [{ previewRedeem: 0n }, 'zero_quote'], [{ balanceOf: 1n }, 'insufficient_simd']]) {
    const item = fixture('redeem', { reads });
    await assert.rejects(item.tools.executeStakingTransaction(item.input), rejectsCode(code));
    noSend(item);
  }
});
test('RPC errors, failed eth_call and no ETH never become false balances or a broadcast', async () => {
  for (const [options, code] of [[{ readError: true }, 'unavailable'], [{ simulationError: true }, 'simulation'], [{ ethBalance: 0n }, 'insufficient_eth']]) {
    const item = fixture('deposit', options);
    await assert.rejects(item.tools.executeStakingTransaction(item.input), rejectsCode(code));
    noSend(item);
  }
});
test('a declined wallet request is reported without a fabricated transaction hash', async () => {
  const item = fixture('deposit', { rejected: true });
  await assert.rejects(item.tools.executeStakingTransaction(item.input), error => error.code === 'rejected' && error.intent === null);
  assert.equal(item.progress.some(item => item.stage === 'confirmed'), false);
});
test('a broadcast keeps its original account and intent when the form context changes', async () => {
  const item = fixture('deposit', { changeAfterSend: true });
  const result = await item.tools.executeStakingTransaction(item.input);
  assert.equal(result.account, ACCOUNT);
  assert.equal(result.hash, HASH);
});
test('timeout retains a recoverable pending hash and never reports confirmation', async () => {
  const item = fixture('deposit', { timeout: true });
  await assert.rejects(item.tools.executeStakingTransaction(item.input), error => error.code === 'pending' && error.intent.hash === HASH && error.intent.account === ACCOUNT && error.intent.amountRaw === ASSETS.toString());
  assert.equal(item.progress.some(item => item.stage === 'confirmed'), false);
});
test('a reverted receipt is terminal and retains the hash without confirmation', async () => {
  const item = fixture('deposit', { receipt: { status: 'reverted' } });
  await assert.rejects(item.tools.executeStakingTransaction(item.input), error => error.code === 'reverted' && error.terminal && error.intent.hash === HASH);
  assert.equal(item.progress.some(item => item.stage === 'confirmed'), false);
});
test('a repriced transaction with the identical action is accepted under its replacement hash', async () => {
  const item = fixture('deposit', { replacement: 'repriced', receipt: { transactionHash: REPLACEMENT } });
  const result = await item.tools.executeStakingTransaction(item.input);
  assert.equal(result.hash, REPLACEMENT);
  assert.equal(result.assetsRaw, ASSETS.toString());
});
test('cancelled or changed wallet calldata cannot be reported as staking success', async () => {
  for (const transaction of [{ to: ACCOUNT, input: '0x' }, { input: encodeFunctionData(actionData('deposit', ASSETS + 1n)) }, { value: 1n }, { from: OTHER }]) {
    const item = fixture('deposit', { transaction });
    await assert.rejects(item.tools.executeStakingTransaction(item.input), error => error.code === 'replaced' && error.terminal && error.intent.hash === HASH);
    assert.equal(item.progress.some(item => item.stage === 'confirmed'), false);
  }
});
test('successful unrelated logs, zero output, stale receipt and reorg remain unconfirmed', async () => {
  const unrelated = eventLog('deposit', ASSETS + 1n);
  const zeroLog = { ...eventLog('deposit', ASSETS), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [ASSETS, 0n]) };
  for (const options of [{ receipt: { logs: [unrelated] } }, { receipt: { logs: [zeroLog] } }, { receipt: { blockNumber: 99n } }, { canonicalHash: REPLACEMENT }, { head: 100n }]) {
    const item = fixture('deposit', options);
    await assert.rejects(item.tools.executeStakingTransaction(item.input), error => error.code === 'pending' && error.intent.hash === HASH);
    assert.equal(item.progress.some(item => item.stage === 'confirmed'), false);
  }
});
test('resume confirms an existing valid intent without asking the wallet to send anything', async () => {
  const item = fixture('redeem');
  const result = await item.tools.trackStakingTransaction({ hash: HASH, account: ACCOUNT, action: 'redeem', amountRaw: SHARES.toString() });
  assert.equal(result.assetsRaw, ASSETS.toString());
  noSend(item);
});
test('invalid raw amount is rejected without any network call', async () => {
  for (const amountRaw of ['0', '-1', '1.1', '1e18', '01', (MAX_UINT + 1n).toString()]) {
    const item = fixture();
    await assert.rejects(item.tools.executeStakingTransaction({ ...item.input, amountRaw }), rejectsCode('invalid'));
    assert.equal(item.calls.length, 0);
  }
});
test('display callback failure cannot lose an already broadcast transaction', async () => {
  const item = fixture(); item.input.onProgress = () => { throw new Error('Display failed'); };
  const result = await item.tools.executeStakingTransaction(item.input);
  assert.equal(result.hash, HASH);
});
