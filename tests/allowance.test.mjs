import test from 'node:test';
import assert from 'node:assert/strict';
import { createAllowanceService, validateAllowanceAddress } from '../server/allowance.mjs';
import { IMD_CONTRACT, PublicError } from '../server/ethereum.mjs';
import { createApiHandler } from '../server/http.mjs';

const OWNER = `0x${'a1'.repeat(20)}`;
const SPENDER = `0x${'b2'.repeat(20)}`;
const HEAD_HASH = `0x${'c3'.repeat(32)}`;
const OTHER_HASH = `0x${'d4'.repeat(32)}`;
const MAX_UINT256 = 2n ** 256n - 1n;
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const address = (value) => `0x${BigInt(value).toString(16).padStart(40, '0')}`;
const provider = (name) => ({ name, url: `https://${name.toLowerCase()}.invalid/rpc` });
const block = (changes = {}) => ({ number: '0xc8', hash: HEAD_HASH, timestamp: '0x68000000', transactions: [], ...changes });
const unavailable = (error) => error instanceof PublicError && error.status === 503 && error.code === 'unavailable';

function mockRpc(overrides = {}) {
  const calls = [];
  const defaultResult = (method, params) => {
    switch (method) {
      case 'eth_chainId': return '0x1';
      case 'eth_getBlockByNumber': return block();
      case 'eth_getCode': return '0x6080';
      case 'eth_call': return params[0].data === '0x313ce567' ? word(18n) : word(123456789012345678901234567890n);
      default: throw new Error(`Unexpected RPC method ${method}`);
    }
  };
  const fetchImpl = async (url, options) => {
    const requests = JSON.parse(options.body);
    calls.push({ url, requests });
    const responses = [];
    for (const request of requests) {
      const custom = overrides[request.method];
      const result = typeof custom === 'function' ? await custom(request.params, url, calls.length, request) : Object.hasOwn(overrides, request.method) ? custom : defaultResult(request.method, request.params);
      responses.push(result?.rpcError ? { jsonrpc: '2.0', id: request.id, error: result.rpcError } : { jsonrpc: '2.0', id: request.id, result });
    }
    return new Response(JSON.stringify(responses.reverse()), { status: 200 });
  };
  return { calls, fetchImpl };
}

function service(rpc, options = {}) {
  return createAllowanceService({ fetchImpl: rpc.fetchImpl, providers: [provider('Primary')], now: () => 1_700_000_000_000, ...options });
}

test('approval addresses reject incomplete, whitespace, non-hex and zero input before any RPC request', async () => {
  const rpc = mockRpc();
  const instance = service(rpc);
  assert.equal(validateAllowanceAddress(OWNER.toUpperCase().replace('0X', '0x'), 'owner'), OWNER);
  for (const invalid of ['', null, 12, `${OWNER} `, ` ${OWNER}`, '0x1234', '0x' + 'gg'.repeat(20), '0x' + '0'.repeat(40), '<script>']) {
    await assert.rejects(instance.getAllowance(invalid, SPENDER), (error) => error.status === 400 && error.code === 'invalid');
    await assert.rejects(instance.getAllowance(OWNER, invalid), (error) => error.status === 400 && error.code === 'invalid');
  }
  assert.equal(rpc.calls.length, 0);
  assert.throws(() => validateAllowanceAddress(OWNER, 'other'));
});

test('approval encodes the exact owner and spender and reads contract, decimals and allowance at one snapshot', async () => {
  const rpc = mockRpc();
  const result = await service(rpc).getAllowance(OWNER, SPENDER);
  assert.deepEqual(result, {
    chainId: 1, contract: IMD_CONTRACT, tokenSymbol: 'IMD', decimals: 18, owner: OWNER, spender: SPENDER,
    allowanceRaw: '123456789012345678901234567890', allowance: '123456789012.34567890123456789', unlimited: false,
    snapshotBlockNumber: '200', snapshotBlockHash: HEAD_HASH, snapshotTimestamp: new Date(0x68000000 * 1_000).toISOString(),
    retrievedAt: '2023-11-14T22:13:20.000Z', provider: 'Primary', source: provider('Primary').url,
  });
  assert.equal(rpc.calls.length, 3);
  const reads = rpc.calls[1].requests;
  assert.ok(reads.every((request) => request.params[1] === '0xc8'));
  assert.equal(reads[0].params[0], IMD_CONTRACT);
  assert.equal(reads[2].params[0].to, IMD_CONTRACT);
  assert.equal(reads[2].params[0].data, `0xdd62ed3e${OWNER.slice(2).padStart(64, '0')}${SPENDER.slice(2).padStart(64, '0')}`);
  assert.deepEqual(rpc.calls[2].requests[0].params, ['0xc8', false]);
  assert.ok(rpc.calls.every((call) => call.requests.every((request) => !/send|sign/i.test(request.method))));
});

test('actual zero, one wei, full decimals and unlimited approvals remain distinct and exact', async () => {
  for (const [raw, formatted, unlimited] of [
    [0n, '0', false], [1n, '0.000000000000000001', false], [1_000_000_000_000_000_001n, '1.000000000000000001', false],
    [MAX_UINT256, '115792089237316195423570985008687907853269984665640564039457.584007913129639935', true],
    [MAX_UINT256 - 1n, '115792089237316195423570985008687907853269984665640564039457.584007913129639934', false],
  ]) {
    const rpc = mockRpc({ eth_call: (params) => params[0].data === '0x313ce567' ? word(18n) : word(raw) });
    const result = await service(rpc).getAllowance(OWNER, SPENDER);
    assert.equal(result.allowanceRaw, raw.toString());
    assert.equal(result.allowance, formatted);
    assert.equal(result.unlimited, unlimited);
  }
});

test('wrong Ethereum chain, absent code, wrong token decimals and malformed head are unavailable', async () => {
  for (const overrides of [
    { eth_chainId: '0x2' }, { eth_chainId: '0x01' },
    { eth_getCode: '0x' }, { eth_getCode: '0x0000' }, { eth_getCode: '0x123' },
    { eth_call: (params) => params[0].data === '0x313ce567' ? word(6n) : word(0n) },
    { eth_getBlockByNumber: null }, { eth_getBlockByNumber: block({ number: '0x00' }) },
    { eth_getBlockByNumber: block({ hash: '0xab' }) }, { eth_getBlockByNumber: block({ timestamp: '0x' }) },
  ]) await assert.rejects(service(mockRpc(overrides)).getAllowance(OWNER, SPENDER), unavailable);
});

test('malformed or errored allowance responses never become a zero approval', async () => {
  for (const invalid of ['0x', '0x0', '0x' + '0'.repeat(63), '0x' + '0'.repeat(65), '0x' + 'g'.repeat(64), '0', 0, null, [], {}, { rpcError: { code: -32000, message: 'private upstream reason' } }]) {
    const rpc = mockRpc({ eth_call: (params) => params[0].data === '0x313ce567' ? word(18n) : invalid });
    await assert.rejects(service(rpc).getAllowance(OWNER, SPENDER), (error) => unavailable(error) && !error.message.includes('private'));
  }
});

test('canonical hash and block-number changes invalidate an otherwise readable approval', async () => {
  for (const changes of [{ hash: OTHER_HASH }, { number: '0xc9' }]) {
    const rpc = mockRpc({ eth_getBlockByNumber: (params) => params[0] === 'latest' ? block() : block(changes) });
    await assert.rejects(service(rpc).getAllowance(OWNER, SPENDER), unavailable);
    assert.equal(rpc.calls.length, 3);
  }
});

test('provider fallback restarts the complete snapshot and returns only the successful provider observation', async () => {
  const rpc = mockRpc({
    eth_getBlockByNumber: (params, url) => url.includes('primary') && params[0] !== 'latest' ? block({ hash: OTHER_HASH }) : block(),
    eth_call: (params, url) => params[0].data === '0x313ce567' ? word(18n) : url.includes('primary') ? word(5n) : word(9n),
  });
  const result = await service(rpc, { providers: [provider('Primary'), provider('Secondary')] }).getAllowance(OWNER, SPENDER);
  assert.equal(result.allowanceRaw, '9');
  assert.equal(result.provider, 'Secondary');
  assert.equal(result.source, provider('Secondary').url);
  assert.equal(rpc.calls.filter((call) => call.url.includes('primary')).length, 3);
  assert.equal(rpc.calls.filter((call) => call.url.includes('secondary')).length, 3);
});

test('RPC HTTP errors, missing results, duplicate batch IDs and oversized bodies stay unavailable', async () => {
  const fetchers = [
    async () => new Response('{}', { status: 429 }),
    async () => new Response('{invalid JSON'),
    async () => new Response('[]'),
    async (_, options) => new Response(JSON.stringify(JSON.parse(options.body).map((request) => ({ jsonrpc: '2.0', id: request.id })))),
    async (_, options) => new Response(JSON.stringify(JSON.parse(options.body).map(() => ({ jsonrpc: '2.0', id: 1, result: '0x1' })))),
    async () => new Response('x'.repeat(2_000_001)),
  ];
  for (const fetchImpl of fetchers) {
    await assert.rejects(createAllowanceService({ fetchImpl, providers: [provider('Primary')] }).getAllowance(OWNER, SPENDER), unavailable);
  }
});

test('approval reads share in-flight work and cache only identical address pairs without leaking mutations', async () => {
  const rpc = mockRpc();
  let now = 1_700_000_000_000;
  const instance = service(rpc, { cacheMs: 100, now: () => now });
  const [first, second] = await Promise.all([instance.getAllowance(OWNER, SPENDER), instance.getAllowance(OWNER.toUpperCase().replace('0X', '0x'), SPENDER)]);
  assert.equal(rpc.calls.length, 3);
  first.allowance = 'changed';
  assert.notEqual(second.allowance, 'changed');
  assert.notEqual((await instance.getAllowance(OWNER, SPENDER)).allowance, 'changed');
  assert.equal(rpc.calls.length, 3);
  await instance.getAllowance(OWNER, address(99));
  assert.equal(rpc.calls.length, 6);
  now += 101;
  await instance.getAllowance(OWNER, SPENDER);
  assert.equal(rpc.calls.length, 9);
  now -= 102;
  await instance.getAllowance(OWNER, SPENDER);
  assert.equal(rpc.calls.length, 12);
});

test('approval cache evicts old pairs and failed reads are not cached', async () => {
  const rpc = mockRpc();
  const instance = service(rpc);
  for (let index = 1; index <= 66; index += 1) await instance.getAllowance(OWNER, address(index));
  assert.equal(rpc.calls.length, 198);
  await instance.getAllowance(OWNER, address(66));
  assert.equal(rpc.calls.length, 198);
  await instance.getAllowance(OWNER, address(1));
  assert.equal(rpc.calls.length, 201);

  const failing = mockRpc({ eth_chainId: (_, __, count) => count === 1 ? '0x2' : '0x1' });
  const retrying = service(failing);
  await assert.rejects(retrying.getAllowance(OWNER, SPENDER), unavailable);
  assert.equal((await retrying.getAllowance(OWNER, SPENDER)).allowanceRaw, '123456789012345678901234567890');
  assert.equal(failing.calls.length, 4);
});

test('all reads for a provider share one bounded deadline and hanging providers cannot hold a request open', async () => {
  const instance = createAllowanceService({ fetchImpl: () => new Promise(() => {}), providers: [provider('Primary'), provider('Secondary')], timeoutMs: 15 });
  const started = Date.now();
  await assert.rejects(instance.getAllowance(OWNER, SPENDER), unavailable);
  assert.ok(Date.now() - started < 500);
});

test('approval in-flight work is bounded while identical requests can still join an existing read', async () => {
  const instance = createAllowanceService({ fetchImpl: () => new Promise(() => {}), providers: [provider('Primary')], timeoutMs: 30 });
  const pending = Array.from({ length: 32 }, (_, index) => instance.getAllowance(OWNER, address(index + 1)));
  const shared = instance.getAllowance(OWNER, address(1));
  await assert.rejects(instance.getAllowance(OWNER, address(33)), (error) => unavailable(error) && /Too many/.test(error.message));
  assert.ok((await Promise.allSettled([...pending, shared])).every((result) => result.status === 'rejected'));
});

function captureResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
}

test('approval HTTP route enforces GET and one owner/spender pair with no extra or duplicated parameters', async () => {
  let reads = 0;
  const handler = createApiHandler('allowance', { getAllowance: async (owner, spender) => { reads += 1; return { owner, spender, allowance: '0' }; } });
  const query = `owner=${OWNER}&spender=${SPENDER}`;
  for (const [method, url, status] of [
    ['POST', `/api/allowance?${query}`, 405], ['GET', '/api/allowance', 400], ['GET', `/api/allowance?owner=${OWNER}`, 400],
    ['GET', `/api/allowance?${query}&owner=${OWNER}`, 400], ['GET', `/api/allowance?${query}&spender=${SPENDER}`, 400],
    ['GET', `/api/allowance?${query}&extra=1`, 400], ['GET', `/api/other?${query}`, 404],
    ['GET', `/api/allowance?${query}`, 200], ['GET', `/api/allowance?spender=${SPENDER}&owner=${OWNER}`, 200],
  ]) {
    const response = captureResponse();
    await handler({ method, url }, response);
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    if (status === 405) assert.equal(response.headers.Allow, 'GET');
    if (status === 200) assert.deepEqual(response.body, { owner: OWNER, spender: SPENDER, allowance: '0' });
  }
  assert.equal(reads, 2);
});

test('approval HTTP validation and upstream errors preserve truthful status without leaking details', async () => {
  const handler = createApiHandler('allowance', service(mockRpc({ eth_chainId: '0x2' })));
  for (const [url, status, code] of [
    [`/api/allowance?owner=${OWNER}&spender=${SPENDER}`, 503, 'unavailable'],
    [`/api/allowance?owner=&spender=${SPENDER}`, 400, 'invalid'],
    [`/api/allowance?owner=${OWNER}&spender=0x1234`, 400, 'invalid'],
  ]) {
    const response = captureResponse();
    await handler({ method: 'GET', url }, response);
    assert.equal(response.statusCode, status);
    assert.equal(response.body.code, code);
    assert.equal(Object.hasOwn(response.body, 'allowance'), false);
  }
  const response = captureResponse();
  await createApiHandler('allowance', { getAllowance: async () => { throw new Error('sensitive provider detail'); } })({ method: 'GET', url: `/api/allowance?owner=${OWNER}&spender=${SPENDER}` }, response);
  assert.equal(response.statusCode, 503);
  assert.ok(!JSON.stringify(response.body).includes('sensitive'));
});
