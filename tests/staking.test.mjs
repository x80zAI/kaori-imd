import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStakingService, validateStakingRequest } from '../server/staking.mjs';
import { createApiHandler } from '../server/http.mjs';
import { PublicError } from '../server/ethereum.mjs';
import { IMD_TOKEN, STAKING_CODE_HASH, STAKING_VAULT } from '../src/staking.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/staking-vault-runtime.json', import.meta.url), 'utf8'));
const OWNER = `0x${'a1'.repeat(20)}`;
const ZERO = `0x${'0'.repeat(40)}`;
const HEAD_HASH = `0x${'c3'.repeat(32)}`;
const OTHER_HASH = `0x${'d4'.repeat(32)}`;
const MAX_UINT256 = 2n ** 256n - 1n;
const WORD = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const provider = name => ({ name, url: `https://${name.toLowerCase()}.invalid/rpc` });
const block = (changes = {}) => ({ number: '0xc8', hash: HEAD_HASH, timestamp: '0x68000000', transactions: [], ...changes });
const unavailable = error => error instanceof PublicError && error.status === 503 && error.code === 'unavailable';
const SELECTORS = {
  asset: '0x38d52e0f', balanceOf: '0x70a08231', convertToAssets: '0x07a2d13a', decimals: '0x313ce567',
  lastDepositBlock: '0x9ce1024b', maxDeposit: '0x402d267d', maxRedeem: '0xd905777e', owner: '0x8da5cb5b',
  paused: '0x5c975abb', previewDeposit: '0xef8b30f7', previewRedeem: '0x4cdad506',
  totalAssets: '0x01e1d114', totalSupply: '0x18160ddd', allowance: '0xdd62ed3e',
};

function mockRpc(overrides = {}, stateOverrides = {}) {
  const state = {
    assets: 1_000_000_000_000_000_000_003n,
    supply: 400_000_000_000_000_000_000_000_007n,
    imdBalance: 50_000_000_000_000_000_001n,
    shares: 2_000_000_000_000_000_000_000_001n,
    allowance: 3_000_000_000_000_000_001n,
    lastDeposit: 195n, paused: false,
    ...stateOverrides,
  };
  const calls = [];
  function defaultResult(method, params) {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return block();
    if (method === 'eth_getCode') return params[0] === STAKING_VAULT ? FIXTURE.code : '0x6080';
    if (method === 'eth_getBalance') return '0x20000000000000';
    if (method !== 'eth_call') throw new Error(`Unexpected RPC method ${method}`);
    const request = params[0];
    const selector = request.data.slice(0, 10);
    const argument = request.data.length > 10 ? BigInt(`0x${request.data.slice(10, 74)}`) : null;
    const name = Object.keys(SELECTORS).find(key => SELECTORS[key] === selector);
    const conversion = shares => shares * (state.assets + 1n) / (state.supply + 1_000_000n);
    switch (name) {
      case 'asset': return WORD(IMD_TOKEN);
      case 'decimals': return WORD(request.to === IMD_TOKEN ? 18n : 24n);
      case 'paused': return WORD(state.paused ? 1n : 0n);
      case 'owner': return WORD(0n);
      case 'totalAssets': return WORD(state.assets);
      case 'totalSupply': return WORD(state.supply);
      case 'convertToAssets': return WORD(conversion(argument));
      case 'balanceOf': return WORD(request.to === IMD_TOKEN ? state.imdBalance : state.shares);
      case 'allowance': return WORD(state.allowance);
      case 'maxDeposit': return WORD(state.paused ? 0n : MAX_UINT256);
      case 'maxRedeem': return WORD(state.paused || state.lastDeposit === 200n ? 0n : state.shares);
      case 'lastDepositBlock': return WORD(state.lastDeposit);
      case 'previewDeposit': return WORD(argument * (state.supply + 1_000_000n) / (state.assets + 1n));
      case 'previewRedeem': return WORD(conversion(argument));
      default: throw new Error(`Unexpected selector ${selector}`);
    }
  }
  const fetchImpl = async (url, options) => {
    const requests = JSON.parse(options.body);
    calls.push({ url, requests });
    const responses = [];
    for (const request of requests) {
      const custom = overrides[request.method];
      const result = typeof custom === 'function' ? await custom(request.params, url, calls.length, request, defaultResult) :
        Object.hasOwn(overrides, request.method) ? custom : defaultResult(request.method, request.params);
      responses.push(result?.rpcError ? { jsonrpc: '2.0', id: request.id, error: result.rpcError } : { jsonrpc: '2.0', id: request.id, result });
    }
    return new Response(JSON.stringify(responses.reverse()), { status: 200 });
  };
  return { calls, state, fetchImpl, defaultResult };
}

const service = (rpc, options = {}) => createStakingService({ fetchImpl: rpc.fetchImpl, providers: [provider('Primary')], now: () => 1_700_000_000_000, ...options });

test('staking requests reject invalid wallets, quote combinations and noncanonical positive uint256 amounts before RPC', async () => {
  const rpc = mockRpc();
  const instance = service(rpc);
  assert.deepEqual(validateStakingRequest(), { address: null, mode: null, amount: null });
  assert.equal(validateStakingRequest(OWNER.toUpperCase().replace('0X', '0x')).address, OWNER);
  for (const owner of ['', 1, {}, ZERO, ` ${OWNER}`, `${OWNER} `, '0x1234', '0x' + 'gg'.repeat(20)]) {
    await assert.rejects(instance.getStaking(owner), error => error.status === 400);
  }
  for (const [owner, mode, amount] of [
    [null, 'deposit', '1'], [OWNER, 'withdraw', '1'], [OWNER, 'Deposit', '1'], [OWNER, 'deposit', null],
    [OWNER, null, '1'], [OWNER, 'deposit', '0'], [OWNER, 'redeem', '01'], [OWNER, 'deposit', '1.0'],
    [OWNER, 'deposit', '1e18'], [OWNER, 'deposit', '+1'], [OWNER, 'deposit', '-1'], [OWNER, 'deposit', 1],
    [OWNER, 'deposit', (MAX_UINT256 + 1n).toString()], [OWNER, 'deposit', '9'.repeat(79)],
  ]) await assert.rejects(instance.getStaking(owner, mode, amount), error => error.status === 400 && error.code === 'invalid');
  assert.equal(validateStakingRequest(OWNER, 'deposit', MAX_UINT256.toString()).amount, MAX_UINT256);
  assert.equal(rpc.calls.length, 0);
});

test('staking API binds the official runtime, asset and decimal precision to one canonical snapshot with no write RPC', async () => {
  const rpc = mockRpc();
  const result = await service(rpc).getStaking(OWNER);
  assert.equal(result.chainId, 1);
  assert.equal(result.token, IMD_TOKEN);
  assert.equal(result.vault, STAKING_VAULT);
  assert.equal(result.codeHash, FIXTURE.keccak256);
  assert.equal(result.codeHash, STAKING_CODE_HASH);
  assert.equal(result.assetDecimals, 18);
  assert.equal(result.shareDecimals, 24);
  assert.equal(result.owner, ZERO);
  assert.equal(result.paused, false);
  assert.equal(result.totalAssetsRaw, rpc.state.assets.toString());
  assert.equal(result.totalSupplyRaw, rpc.state.supply.toString());
  assert.equal(result.wallet.imdBalanceRaw, '50000000000000000001');
  assert.equal(result.wallet.shareBalanceRaw, '2000000000000000000000001');
  assert.equal(result.wallet.allowanceRaw, '3000000000000000001');
  assert.equal(result.wallet.maxDepositRaw, MAX_UINT256.toString());
  assert.equal(result.wallet.maxRedeemRaw, result.wallet.shareBalanceRaw);
  assert.equal(result.wallet.ethBalanceRaw, BigInt('0x20000000000000').toString());
  assert.equal(result.wallet.lastDepositBlock, '195');
  assert.equal(result.quote, null);
  assert.equal(result.snapshotBlockNumber, '200');
  assert.equal(result.snapshotBlockHash, HEAD_HASH);
  assert.equal(result.provider, 'Primary');
  assert.equal(result.source, provider('Primary').url);
  assert.equal(result.retrievedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(rpc.calls.length, 4);
  assert.ok(rpc.calls.slice(1, -1).every(batch => batch.requests.every(request => request.params[1] === '0xc8')));
  assert.ok(rpc.calls.every(batch => batch.requests.every(request => !/send|sign|estimate/i.test(request.method))));
  assert.deepEqual(rpc.calls.at(-1).requests[0].params, ['0xc8', false]);
  const allowanceCall = rpc.calls[1].requests.find(request => request.params[0]?.data?.startsWith(SELECTORS.allowance));
  assert.equal(allowanceCall.params[0].data, `${SELECTORS.allowance}${OWNER.slice(2).padStart(64, '0')}${STAKING_VAULT.slice(2).padStart(64, '0')}`);
});

test('deposit and redeem quotes retain exact wei and 24-decimal shares using verified Solady floor rounding', async () => {
  const rpc = mockRpc();
  const instance = service(rpc);
  for (const [mode, amount] of [['deposit', '1000000000000000001'], ['redeem', '1000000000000000000000001'], ['deposit', '1'], ['redeem', '1']]) {
    const result = await instance.getStaking(OWNER, mode, amount);
    const virtualAssets = rpc.state.assets + 1n;
    const virtualShares = rpc.state.supply + 1_000_000n;
    const expected = mode === 'deposit' ? BigInt(amount) * virtualShares / virtualAssets : BigInt(amount) * virtualAssets / virtualShares;
    assert.deepEqual(result.quote, { mode, amountRaw: amount, outputRaw: expected.toString() });
  }
  assert.equal(rpc.calls.length, 16, 'wallet quotes always read again');
});

test('paused and same-block deposit holds return truthful zero limits without turning read failures into zero', async () => {
  for (const overrides of [{ paused: true }, { lastDeposit: 200n }, { shares: 0n }]) {
    const result = await service(mockRpc({}, overrides)).getStaking(OWNER);
    assert.equal(result.wallet.maxRedeemRaw, '0');
    assert.equal(result.wallet.maxDepositRaw, overrides.paused ? '0' : MAX_UINT256.toString());
    if (overrides.shares === 0n) assert.equal(result.wallet.redeemableAssetsRaw, '0');
  }
});

test('wrong chain, runtime, asset, decimals, malformed ABI values and contradictory limits stay unavailable', async () => {
  const invalidCases = [
    { eth_chainId: '0x2' }, { eth_chainId: '0x01' }, { eth_getBlockByNumber: null },
    { eth_getCode: params => params[0] === STAKING_VAULT ? '0x6080' : '0x6080' },
    { eth_getCode: '0x' }, { eth_getCode: '0x0000' }, { eth_getCode: '0x123' },
  ];
  for (const overrides of invalidCases) await assert.rejects(service(mockRpc(overrides)).getStaking(OWNER), unavailable);
  for (const [name, invalid] of [
    ['asset', WORD(123)], ['asset', '0x1' + '0'.repeat(63)], ['decimals', WORD(6)], ['paused', WORD(2)],
    ['owner', '0x1' + '0'.repeat(63)], ['totalAssets', '0x0'], ['totalSupply', '0x' + 'g'.repeat(64)],
    ['convertToAssets', WORD(999)], ['lastDepositBlock', WORD(201)], ['maxRedeem', WORD(1)], ['maxDeposit', WORD(1)],
  ]) {
    const rpc = mockRpc({ eth_call: (params, _, __, ___, fallback) => params[0].data.startsWith(SELECTORS[name]) ? invalid : fallback('eth_call', params) });
    await assert.rejects(service(rpc).getStaking(OWNER), unavailable);
  }
  const futureShares = mockRpc({}, { shares: 500_000_000_000_000_000_000_000_000n });
  await assert.rejects(service(futureShares).getStaking(OWNER), unavailable);
  await assert.rejects(service(mockRpc({ eth_getBalance: '0x00' })).getStaking(OWNER), unavailable);
});

test('malformed quote, inconsistent position conversion and private upstream failures cannot look successful', async () => {
  for (const invalid of ['0x', '0x0', WORD(999), null, { rpcError: { code: -32000, message: 'private upstream reason' } }]) {
    const rpc = mockRpc({ eth_call: (params, _, __, ___, fallback) => params[0].data.startsWith(SELECTORS.previewDeposit) ? invalid : fallback('eth_call', params) });
    await assert.rejects(service(rpc).getStaking(OWNER, 'deposit', '1'), error => unavailable(error) && !error.message.includes('private'));
  }
  const rpc = mockRpc({ eth_call: (params, _, batch, __, fallback) => batch === 3 ? WORD(999) : fallback('eth_call', params) });
  await assert.rejects(service(rpc).getStaking(OWNER), unavailable);
});

test('canonical block changes reject the snapshot and fallback starts every read again on one provider', async () => {
  for (const changes of [{ hash: OTHER_HASH }, { number: '0xc9' }]) {
    const rpc = mockRpc({ eth_getBlockByNumber: params => params[0] === 'latest' ? block() : block(changes) });
    await assert.rejects(service(rpc).getStaking(OWNER), unavailable);
  }
  const rpc = mockRpc({ eth_getBlockByNumber: (params, url) => url.includes('primary') && params[0] !== 'latest' ? block({ hash: OTHER_HASH }) : block() });
  const result = await service(rpc, { providers: [provider('Primary'), provider('Secondary')] }).getStaking(OWNER, 'redeem', '1000000000000000000000000');
  assert.equal(result.provider, 'Secondary');
  assert.equal(rpc.calls.filter(item => item.url.includes('primary')).length, 4);
  assert.equal(rpc.calls.filter(item => item.url.includes('secondary')).length, 4);
});

test('only global data can use short cache; wallet reads and quotes are fresh and in-flight clones cannot leak mutations', async () => {
  const rpc = mockRpc();
  let now = 1_700_000_000_000;
  const instance = service(rpc, { cacheMs: 100, now: () => now });
  const [first, second] = await Promise.all([instance.getStaking(), instance.getStaking()]);
  assert.equal(rpc.calls.length, 3);
  assert.equal(first.wallet, null);
  assert.equal(first.quote, null);
  first.totalAssetsRaw = 'changed';
  assert.notEqual(second.totalAssetsRaw, 'changed');
  assert.notEqual((await instance.getStaking()).totalAssetsRaw, 'changed');
  assert.equal(rpc.calls.length, 3);
  await instance.getStaking(OWNER);
  await instance.getStaking(OWNER);
  assert.equal(rpc.calls.length, 11);
  now += 101;
  await instance.getStaking();
  assert.equal(rpc.calls.length, 14);
  now -= 102;
  await instance.getStaking();
  assert.equal(rpc.calls.length, 17);
});

test('staking HTTP, malformed batches and bounded timeouts do not become amounts; concurrent requests are limited', async () => {
  for (const fetchImpl of [
    async () => new Response('{}', { status: 429 }), async () => new Response('{invalid JSON'),
    async () => new Response('[]'), async () => new Response('x'.repeat(2_000_001)),
    async (_, options) => new Response(JSON.stringify(JSON.parse(options.body).map(() => ({ jsonrpc: '2.0', id: 1, result: '0x1' })))),
  ]) await assert.rejects(createStakingService({ fetchImpl, providers: [provider('Primary')] }).getStaking(OWNER), unavailable);
  const hanging = createStakingService({ fetchImpl: () => new Promise(() => {}), providers: [provider('Primary')], timeoutMs: 30 });
  const pending = Array.from({ length: 32 }, (_, index) => hanging.getStaking(`0x${(index + 1).toString(16).padStart(40, '0')}`));
  await assert.rejects(hanging.getStaking(`0x${'f1'.repeat(20)}`), error => unavailable(error) && /Too many/.test(error.message));
  assert.ok((await Promise.allSettled(pending)).every(result => result.status === 'rejected'));
});

function captureResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
}

test('staking HTTP accepts global, wallet and complete quote reads and rejects duplicates, extras and non-GET methods', async () => {
  let reads = 0;
  const handler = createApiHandler('staking', { getStaking: async (owner, mode, amount) => { reads += 1; return { owner, mode, amount }; } });
  for (const [method, query, status] of [
    ['GET', '', 200], ['GET', `?owner=${OWNER}`, 200], ['GET', `?owner=${OWNER}&mode=deposit&amount=1`, 200],
    ['POST', '', 405], ['GET', '?mode=deposit&amount=1', 400], ['GET', `?owner=${OWNER}&mode=deposit`, 400],
    ['GET', `?owner=${OWNER}&amount=1`, 400], ['GET', `?owner=${OWNER}&owner=${OWNER}`, 400],
    ['GET', `?owner=${OWNER}&mode=deposit&amount=1&amount=2`, 400], ['GET', '?extra=1', 400],
  ]) {
    const response = captureResponse();
    await handler({ method, url: `/api/staking${query}` }, response);
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    if (status === 405) assert.equal(response.headers.Allow, 'GET');
  }
  assert.equal(reads, 3);
});

test('staking HTTP validation and upstream errors preserve meaningful status without leaking data', async () => {
  const handler = createApiHandler('staking', service(mockRpc({ eth_chainId: '0x2' })));
  for (const [query, status] of [[`?owner=${OWNER}`, 503], ['?owner=', 400], [`?owner=${OWNER}&mode=deposit&amount=0`, 400]]) {
    const response = captureResponse();
    await handler({ method: 'GET', url: `/api/staking${query}` }, response);
    assert.equal(response.statusCode, status);
    assert.equal(Object.hasOwn(response.body, 'wallet'), false);
    assert.equal(Object.hasOwn(response.body, 'quote'), false);
    assert.equal(Object.hasOwn(response.body, 'totalAssetsRaw'), false);
  }
});
