import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEthereumService, decodeReceiptTransfers, decodeRecentTransfers, formatUnits, IMD_CONTRACT, parseQuantity, PublicError, TRANSFER_TOPIC, validateHash } from '../server/ethereum.mjs';
import { createApiHandler, parseRequestUrl } from '../server/http.mjs';
import { isWithinDirectory, resolveStaticFile } from '../server/static.mjs';

const HASH = `0x${'ab'.repeat(32)}`;
const BLOCK_HASH = `0x${'cd'.repeat(32)}`;
const HEAD_HASH = `0x${'ef'.repeat(32)}`;
const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const block = (number = 190n, hash = BLOCK_HASH, transactions = [HASH]) => ({ number: hex(number), hash, timestamp: '0x68000000', transactions });
const log = (changes = {}) => ({ address: IMD_CONTRACT, removed: false, topics: [TRANSFER_TOPIC, `0x${FROM.slice(2).padStart(64, '0')}`, `0x${TO.slice(2).padStart(64, '0')}`],
  data: word(123456789012345678901234567890n), transactionHash: HASH, blockHash: BLOCK_HASH, blockNumber: '0xbe', transactionIndex: '0x0', logIndex: '0x2', ...changes });
const tx = (changes = {}) => ({ hash: HASH, chainId: '0x1', from: FROM, to: TO, blockNumber: '0xbe', blockHash: BLOCK_HASH, transactionIndex: '0x0', type: '0x2', gasPrice: '0x3b9aca00', ...changes });
const receipt = (changes = {}) => ({ transactionHash: HASH, from: FROM, to: TO, blockNumber: '0xbe', blockHash: BLOCK_HASH, transactionIndex: '0x0', status: '0x1',
  gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', logs: [log()], ...changes });
const provider = (name) => ({ name, url: `https://${name.toLowerCase()}.invalid/rpc` });

function mockRpc(overrides = {}) {
  const calls = [];
  const defaultResult = (method, params) => {
    switch (method) {
      case 'eth_chainId': return '0x1';
      case 'eth_getCode': return '0x6080';
      case 'eth_call': return word(18n);
      case 'eth_getTransactionByHash': return tx();
      case 'eth_getTransactionReceipt': return receipt();
      case 'eth_getLogs': return [log()];
      case 'eth_getBlockByNumber':
        if (params[0] === 'latest' || params[0] === '0xc8') return block(200n, HEAD_HASH, []);
        if (params[0] === 'finalized') return block();
        return block(BigInt(params[0]));
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
    return new Response(JSON.stringify(responses.reverse()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

function service(rpc, extra = {}) { return createEthereumService({ fetchImpl: rpc.fetchImpl, providers: [provider('Primary')], now: () => 1_700_000_000_000, ...extra }); }

test('exact decimal amounts preserve tiny fractions and integers beyond Number precision', () => {
  assert.equal(formatUnits(1n), '0.000000000000000001');
  assert.equal(formatUnits(123456789012345678901234567890n), '123456789012.34567890123456789');
  assert.equal(formatUnits(1_000_000_000_000_000_000n), '1');
  assert.equal(parseQuantity('0x20000000000001'), 9_007_199_254_740_993n);
  assert.throws(() => formatUnits(-1n));
  assert.throws(() => formatUnits(2n ** 256n));
  assert.throws(() => parseQuantity('0x01'));
  assert.throws(() => parseQuantity('0x'));
  assert.throws(() => formatUnits(1n, 37));
});

test('hash validation rejects whitespace, addresses and script-like input before an RPC call', () => {
  assert.equal(validateHash(HASH.toUpperCase().replace('0X', '0x')), HASH);
  for (const hash of [FROM, '', `${HASH} `, '<script>', null, 12]) assert.throws(() => validateHash(hash), (error) => error instanceof PublicError && error.status === 400);
});

test('mined receipt uses exact fees, verified snapshot confirmations and official transfers', async () => {
  const rpc = mockRpc();
  const result = await service(rpc).getReceipt(HASH);
  assert.equal(result.status, 'success');
  assert.equal(result.blockNumber, '190');
  assert.equal(result.snapshotBlockNumber, '200');
  assert.equal(result.confirmations, '11');
  assert.equal(result.gasUsed, '21000');
  assert.equal(result.gasPriceWei, '1000000000');
  assert.equal(result.feeEth, '0.000021');
  assert.equal(result.finality, 'finalized');
  assert.equal(result.transfers[0].amount, '123456789012.34567890123456789');
  assert.equal(result.warning, null);
  assert.equal(result.provider, 'Primary');
  assert.equal(rpc.calls[1].requests.find((item) => item.method === 'eth_call').params[1], '0xc8');
});

test('pending transaction exposes no invented block, fee, timestamp, confirmations or transfers', async () => {
  const rpc = mockRpc({ eth_getTransactionByHash: tx({ blockNumber: null, blockHash: null, transactionIndex: null }), eth_getTransactionReceipt: null });
  const result = await service(rpc).getReceipt(HASH);
  assert.equal(result.status, 'pending');
  for (const field of ['blockNumber', 'blockHash', 'timestamp', 'confirmations', 'gasUsed', 'gasPriceWei', 'feeEth']) assert.equal(result[field], null);
  assert.equal(result.finality, 'unknown');
  assert.deepEqual(result.transfers, []);
  assert.match(result.warning, /pending/i);
});

test('reverted and non-IMD transactions retain their truthful Ethereum status', async () => {
  const reverted = await service(mockRpc({ eth_getTransactionReceipt: receipt({ status: '0x0', logs: [] }) })).getReceipt(HASH);
  assert.equal(reverted.status, 'reverted');
  assert.equal(reverted.feeEth, '0.000021');
  assert.deepEqual(reverted.transfers, []);
  const noImd = await service(mockRpc({ eth_getTransactionReceipt: receipt({ logs: [log({ address: FROM })] }) })).getReceipt(HASH);
  assert.equal(noImd.status, 'success');
  assert.deepEqual(noImd.transfers, []);
  assert.match(noImd.warning, /no Transfer events/);
  await assert.rejects(service(mockRpc({ eth_getTransactionReceipt: receipt({ status: '0x0' }) })).getReceipt(HASH), (error) => error.status === 503);
});

test('unavailable finality is unknown and does not prevent a valid receipt', async () => {
  const rpc = mockRpc({ eth_getBlockByNumber: (params) => params[0] === 'finalized' ? { rpcError: { code: -32602, message: 'Unsupported tag' } } : params[0] === 'latest' || params[0] === '0xc8' ? block(200n, HEAD_HASH, []) : block() });
  const result = await service(rpc).getReceipt(HASH);
  assert.equal(result.finality, 'unknown');
  assert.equal(result.status, 'success');
});

test('unfinalized receipt keeps its known state separate from finality', async () => {
  const rpc = mockRpc({ eth_getBlockByNumber: (params) => params[0] === 'finalized' ? block(180n) : params[0] === 'latest' || params[0] === '0xc8' ? block(200n, HEAD_HASH, []) : block() });
  assert.equal((await service(rpc).getReceipt(HASH)).finality, 'unfinalized');
});

test('complete provider fallback never mixes token, transaction or block observations', async () => {
  const rpc = mockRpc({ eth_getTransactionReceipt: (_, url) => url.includes('primary') ? receipt({ blockHash: HEAD_HASH }) : receipt() });
  const result = await service(rpc, { providers: [provider('Primary'), provider('Secondary')] }).getReceipt(HASH);
  assert.equal(result.provider, 'Secondary');
  assert.equal(rpc.calls.filter((call) => call.url.includes('secondary')).length, 2);
  assert.equal(rpc.calls.filter((call) => call.url.includes('primary')).length, 2);
});

test('wrong network, absent contract, wrong decimals and changed head produce unavailable responses', async () => {
  for (const overrides of [
    { eth_chainId: '0x2' }, { eth_getCode: '0x' }, { eth_call: word(6n) },
    { eth_getBlockByNumber: (params) => params[0] === 'latest' ? block(200n, HEAD_HASH, []) : params[0] === '0xc8' ? block(200n, BLOCK_HASH, []) : block() },
  ]) await assert.rejects(service(mockRpc(overrides)).getReceipt(HASH), (error) => error.status === 503 && error.code === 'unavailable');
});

test('receipt, canonical block and transfer disagreements are rejected', async () => {
  for (const overrides of [
    { eth_getTransactionReceipt: receipt({ transactionHash: HEAD_HASH }) },
    { eth_getTransactionReceipt: receipt({ from: TO }) },
    { eth_getTransactionReceipt: receipt({ transactionIndex: '0x1' }) },
    { eth_getTransactionReceipt: receipt({ logs: [log({ blockHash: HEAD_HASH })] }) },
    { eth_getTransactionReceipt: receipt({ logs: [log({ transactionHash: HEAD_HASH })] }) },
    { eth_getTransactionReceipt: receipt({ logs: [log({ removed: true })] }) },
    { eth_getBlockByNumber: (params) => params[0] === 'latest' || params[0] === '0xc8' ? block(200n, HEAD_HASH, []) : block(190n, BLOCK_HASH, [HEAD_HASH]) },
  ]) await assert.rejects(service(mockRpc(overrides)).getReceipt(HASH), (error) => error.status === 503);
});

test('missing transactions are 404 only when every complete provider read reports absence', async () => {
  const rpc = mockRpc({ eth_getTransactionByHash: null, eth_getTransactionReceipt: null });
  await assert.rejects(service(rpc, { providers: [provider('Primary'), provider('Secondary')] }).getReceipt(HASH), (error) => error.status === 404 && error.code === 'not_found');
  assert.equal(rpc.calls.length, 4);
  const mixed = mockRpc({ eth_getTransactionByHash: null, eth_getTransactionReceipt: null, eth_chainId: (_, url) => url.includes('secondary') ? '0x2' : '0x1' });
  await assert.rejects(service(mixed, { providers: [provider('Primary'), provider('Secondary')] }).getReceipt(HASH), (error) => error.status === 503);
});

test('null receipt cannot turn a mined transaction into pending', async () => {
  await assert.rejects(service(mockRpc({ eth_getTransactionReceipt: null })).getReceipt(HASH), (error) => error.status === 503);
});

test('transfer decoding excludes unrelated logs and detects contradictory duplicates', () => {
  assert.equal(decodeReceiptTransfers([log(), log(), log({ address: FROM })], HASH, 190n, BLOCK_HASH, 0n).length, 1);
  assert.throws(() => decodeReceiptTransfers([log(), log({ data: word(1n) })], HASH, 190n, BLOCK_HASH, 0n));
  assert.throws(() => decodeReceiptTransfers([log({ topics: [TRANSFER_TOPIC, word(2n ** 160n), word(1n)] })], HASH, 190n, BLOCK_HASH, 0n));
});

test('recent list groups repeated transfers, sorts newest first and verifies canonical transaction membership', async () => {
  const secondHash = `0x${'12'.repeat(32)}`;
  const recentLogs = [log(), log({ logIndex: '0x3' }), log({ transactionHash: secondHash, transactionIndex: '0x1', logIndex: '0x4' })];
  const rpc = mockRpc({ eth_getLogs: recentLogs, eth_getBlockByNumber: (params) => params[0] === 'latest' || params[0] === '0xc8' ? block(200n, HEAD_HASH, []) : block(190n, BLOCK_HASH, [HASH, secondHash]) });
  const result = await service(rpc).getRecent();
  assert.equal(result.fromBlock, '0');
  assert.deepEqual(result.transactions, [{ hash: secondHash, blockNumber: '190', transferCount: 1 }, { hash: HASH, blockNumber: '190', transferCount: 2 }]);
  assert.equal(rpc.calls.flatMap(call => call.requests).find((item) => item.method === 'eth_getLogs').params[0].toBlock, '0xc8');
});

test('recent window is bounded and genuinely empty logs remain an empty list', async () => {
  const rpc = mockRpc({ eth_getLogs: [], eth_getBlockByNumber: (params) => block(params[0] === 'latest' ? 10_000n : BigInt(params[0]), HEAD_HASH, []) });
  const result = await service(rpc).getRecent();
  assert.equal(result.blockNumber, '10000');
  assert.equal(result.fromBlock, '7001');
  assert.deepEqual(result.transactions, []);
});

function chunkLog(number, hashNumber, transactionIndex = 0, logIndex = 0) {
  return log({ blockNumber: hex(number), blockHash: word(number), transactionHash: word(hashNumber), transactionIndex: hex(transactionIndex), logIndex: hex(logIndex) });
}

function chunkRpc(getLogs) {
  const seen = new Map();
  const sizes = [];
  const rpc = mockRpc({
    eth_getLogs: async (params, url) => {
      const values = await getLogs(params[0], url);
      if (Array.isArray(values)) {
        sizes.push(Buffer.byteLength(JSON.stringify([{ jsonrpc: '2.0', id: 1, result: values }])));
        for (const value of values) {
          const key = `${url}:${BigInt(value.blockNumber)}`;
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key)[Number(BigInt(value.transactionIndex))] = value.transactionHash;
        }
      }
      return values;
    },
    eth_getBlockByNumber: (params, url) => {
      const number = params[0] === 'latest' ? 10_000n : BigInt(params[0]);
      return block(number, number === 10_000n ? HEAD_HASH : word(number), seen.get(`${url}:${number}`) ?? []);
    },
  });
  return { ...rpc, sizes };
}

function scannedRanges(rpc, providerName = null) {
  return rpc.calls.filter(call => !providerName || call.url.includes(providerName)).flatMap(call => call.requests)
    .filter(request => request.method === 'eth_getLogs').map(request => [BigInt(request.params[0].fromBlock), BigInt(request.params[0].toBlock)]);
}

test('recent scans newest complete 500-block chunks and stops after eight distinct hashes', async () => {
  const rpc = chunkRpc(params => {
    if (BigInt(params.toBlock) === 10_000n) return [chunkLog(9_999n, 1n), chunkLog(9_998n, 2n)];
    return Array.from({ length: 7 }, (_, index) => chunkLog(9_450n - BigInt(index), BigInt(index + 3)));
  });
  const result = await service(rpc).getRecent();
  assert.equal(result.fromBlock, '9001');
  assert.equal(result.transactions.length, 8);
  assert.deepEqual(result.transactions.map(item => item.hash), Array.from({ length: 8 }, (_, index) => word(index + 1)));
  assert.deepEqual(scannedRanges(rpc), [[9_501n, 10_000n], [9_001n, 9_500n]]);
  assert.ok(rpc.calls.filter(call => call.requests.some(request => request.method === 'eth_getLogs')).every(call => call.requests.length === 1));
});

test('an empty recent window scans every contiguous chunk without exceeding 3000 blocks', async () => {
  const rpc = chunkRpc(() => []);
  const result = await service(rpc).getRecent();
  assert.equal(result.fromBlock, '7001');
  assert.deepEqual(result.transactions, []);
  const ranges = scannedRanges(rpc);
  assert.equal(ranges.length, 6);
  assert.equal(ranges.reduce((total, [start, end]) => total + end - start + 1n, 0n), 3_000n);
  assert.equal(ranges[0][1], 10_000n);
  assert.equal(ranges.at(-1)[0], 7_001n);
  for (let index = 1; index < ranges.length; index += 1) assert.equal(ranges[index][1], ranges[index - 1][0] - 1n);
});

test('recent handles an aggregate log result over two megabytes using bounded separate responses', async () => {
  const newest = Array.from({ length: 1_900 }, (_, index) => chunkLog(9_999n, BigInt(index % 7 + 1), index % 7, index));
  const older = Array.from({ length: 1_900 }, (_, index) => chunkLog(9_400n, 8n, 0, index));
  const rpc = chunkRpc(params => BigInt(params.toBlock) === 10_000n ? newest.toReversed() : older.toReversed());
  const result = await service(rpc).getRecent();
  assert.equal(result.transactions.length, 8);
  assert.equal(result.fromBlock, '9001');
  assert.ok(rpc.sizes.every(size => size < 2_000_000));
  assert.ok(rpc.sizes.reduce((total, size) => total + size, 0) > 2_000_000);
  assert.deepEqual(result.transactions.map(item => item.hash), [7n, 6n, 5n, 4n, 3n, 2n, 1n, 8n].map(word));
  assert.equal(result.transactions.at(-1).transferCount, 1_900);
  assert.equal(result.transactions.reduce((total, item) => total + item.transferCount, 0), 3_800);
});

test('recent rejects logs outside their own chunk, removed events and cross-chunk conflicts', async () => {
  for (const getLogs of [
    () => [chunkLog(9_500n, 1n)],
    () => [chunkLog(10_001n, 1n)],
    () => [{ ...chunkLog(9_999n, 1n), removed: true }],
    params => BigInt(params.toBlock) === 10_000n ? [chunkLog(9_999n, 1n)] : [chunkLog(9_400n, 1n)],
  ]) await assert.rejects(service(chunkRpc(getLogs)).getRecent(), error => error.status === 503);
});

test('recent chunk failure never returns partial data and fallback restarts the entire observation', async () => {
  const primaryOnly = chunkRpc(params => BigInt(params.toBlock) === 10_000n ? [chunkLog(9_999n, 90n)] : { rpcError: { code: -32000, message: 'Chunk unavailable' } });
  await assert.rejects(service(primaryOnly).getRecent(), error => error.status === 503);
  const rpc = chunkRpc((params, url) => {
    if (url.includes('primary')) return BigInt(params.toBlock) === 10_000n ? [chunkLog(9_999n, 90n)] : { rpcError: { code: -32000, message: 'Chunk unavailable' } };
    return Array.from({ length: 8 }, (_, index) => chunkLog(9_999n - BigInt(index), BigInt(index + 1)));
  });
  const result = await service(rpc, { providers: [provider('Primary'), provider('Secondary')] }).getRecent();
  assert.equal(result.provider, 'Secondary');
  assert.equal(result.fromBlock, '9501');
  assert.ok(result.transactions.every(item => item.hash !== word(90n)));
  assert.deepEqual(scannedRanges(rpc, 'primary'), [[9_501n, 10_000n], [9_001n, 9_500n]]);
  assert.deepEqual(scannedRanges(rpc, 'secondary'), [[9_501n, 10_000n]]);
});

test('recent keeps the two-megabyte bound on every individual chunk response', async () => {
  const rpc = chunkRpc(() => [{ ...chunkLog(9_999n, 1n), extra: 'x'.repeat(2_000_001) }]);
  await assert.rejects(service(rpc).getRecent(), error => error.status === 503);
  const ranges = scannedRanges(rpc);
  assert.ok(ranges.length > 1);
  assert.deepEqual(ranges.at(-1), [10_000n, 10_000n]);
  assert.ok(ranges.every(([start, end]) => end === 10_000n && end - start + 1n <= 500n));
});

test('an oversized recent chunk is discarded and a smaller same-provider range can succeed', async () => {
  const rpc = chunkRpc(params => {
    const width = BigInt(params.toBlock) - BigInt(params.fromBlock) + 1n;
    if (width > 250n) return [{ ...chunkLog(9_999n, 90n), extra: 'x'.repeat(2_000_001) }];
    return Array.from({ length: 8 }, (_, index) => chunkLog(9_999n - BigInt(index), BigInt(index + 1)));
  });
  const result = await service(rpc).getRecent();
  assert.equal(result.provider, 'Primary');
  assert.equal(result.fromBlock, '9751');
  assert.equal(result.transactions.length, 8);
  assert.ok(result.transactions.every(item => item.hash !== word(90n)));
  assert.deepEqual(scannedRanges(rpc), [[9_501n, 10_000n], [9_751n, 10_000n]]);
});

test('recent chunks share the original provider deadline rather than each receiving a new deadline', async () => {
  const rpc = chunkRpc(async () => { await new Promise(resolve => setTimeout(resolve, 12)); return []; });
  const started = Date.now();
  await assert.rejects(service(rpc, { timeoutMs: 20 }).getRecent(), error => error.status === 503);
  assert.ok(Date.now() - started < 250);
  assert.ok(scannedRanges(rpc).length < 6);
});

test('recent returns at most eight distinct transaction hashes and rejects out-of-window or conflicting records', () => {
  const logs = Array.from({ length: 12 }, (_, index) => log({ transactionHash: word(index + 1), transactionIndex: hex(index), logIndex: hex(index) }));
  assert.equal(decodeRecentTransfers(logs, 0n, 200n).length, 8);
  assert.equal(decodeRecentTransfers(logs, 0n, 200n)[0].hash, word(12));
  assert.throws(() => decodeRecentTransfers([log()], 191n, 200n));
  assert.throws(() => decodeRecentTransfers([log(), log({ blockHash: HEAD_HASH })], 0n, 200n));
});

test('cache and in-flight sharing do not expose mutable shared results', async () => {
  const rpc = mockRpc();
  let now = 1_700_000_000_000;
  const instance = service(rpc, { now: () => now, cacheMs: 100 });
  const [first, second] = await Promise.all([instance.getReceipt(HASH), instance.getReceipt(HASH)]);
  assert.equal(rpc.calls.length, 2);
  first.transfers[0].amount = 'changed';
  assert.notEqual(second.transfers[0].amount, 'changed');
  assert.notEqual((await instance.getReceipt(HASH)).transfers[0].amount, 'changed');
  assert.equal(rpc.calls.length, 2);
  now += 101;
  await instance.getReceipt(HASH);
  assert.equal(rpc.calls.length, 4);
});

test('receipt cache evicts old entries instead of growing without a bound', async () => {
  const receiptHashes = Array.from({ length: 66 }, (_, index) => word(index + 1));
  let currentHash;
  const rpc = mockRpc({
    eth_getTransactionByHash: (params) => { currentHash = params[0]; return tx({ hash: currentHash }); },
    eth_getTransactionReceipt: (params) => receipt({ transactionHash: params[0], logs: [log({ transactionHash: params[0] })] }),
    eth_getBlockByNumber: (params) => params[0] === 'latest' || params[0] === '0xc8' ? block(200n, HEAD_HASH, []) : block(190n, BLOCK_HASH, [currentHash]),
  });
  const instance = service(rpc);
  for (const hash of receiptHashes) await instance.getReceipt(hash);
  assert.equal(rpc.calls.length, 132);
  await instance.getReceipt(receiptHashes[65]);
  assert.equal(rpc.calls.length, 132);
  await instance.getReceipt(receiptHashes[0]);
  assert.equal(rpc.calls.length, 134);
});

test('slow providers obey deadlines and never leak raw upstream errors', async () => {
  const instance = createEthereumService({ fetchImpl: () => new Promise(() => {}), providers: [provider('Primary'), provider('Secondary')], timeoutMs: 15 });
  const started = Date.now();
  await assert.rejects(instance.getReceipt(HASH), (error) => error.status === 503 && !error.message.includes('timeout'));
  assert.ok(Date.now() - started < 500);
});

test('in-flight request count is bounded', async () => {
  const instance = createEthereumService({ fetchImpl: () => new Promise(() => {}), providers: [provider('Primary')], timeoutMs: 30 });
  const requests = Array.from({ length: 32 }, (_, index) => instance.getReceipt(word(index + 1)));
  await assert.rejects(instance.getReceipt(word(100)), (error) => error.status === 503 && /Too many/.test(error.message));
  await Promise.allSettled(requests);
});

test('oversized and duplicate-ID RPC responses are rejected', async () => {
  const oversized = createEthereumService({ fetchImpl: async () => new Response('x'.repeat(2_000_001)), providers: [provider('Primary')] });
  await assert.rejects(oversized.getReceipt(HASH), (error) => error.status === 503);
  const duplicates = createEthereumService({ fetchImpl: async (_, options) => new Response(JSON.stringify(JSON.parse(options.body).map(() => ({ jsonrpc: '2.0', id: 1, result: '0x1' })))), providers: [provider('Primary')] });
  await assert.rejects(duplicates.getReceipt(HASH), (error) => error.status === 503);
});

function captureResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
}

test('HTTP handlers enforce GET, exact parameters and safe unavailable errors', async () => {
  let reads = 0;
  const instance = { getReceipt: async () => { reads += 1; throw new Error('secret upstream detail'); }, getRecent: async () => ({ transactions: [] }) };
  const handler = createApiHandler('receipt', instance);
  for (const [method, url, status] of [
    ['POST', `/api/receipt?hash=${HASH}`, 405], ['GET', '/api/receipt', 400],
    ['GET', `/api/receipt?hash=${HASH}&hash=${HASH}`, 400], ['GET', `/api/receipt?hash=${HASH}&extra=1`, 400],
    ['GET', `/api/wrong?hash=${HASH}`, 404], ['GET', `/api/receipt?hash=${HASH}`, 503],
  ]) {
    const response = captureResponse();
    await handler({ method, url }, response);
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(response.body).includes('secret'));
  }
  assert.equal(reads, 1);
  const response = captureResponse();
  await createApiHandler('recent', instance)({ method: 'GET', url: '/api/recent?hash=1' }, response);
  assert.equal(response.statusCode, 400);
});

test('request parser rejects traversal, malformed encodings and non-local URLs', () => {
  for (const url of ['http://evil.invalid/a', '//evil.invalid/a', '/a/../secret', '/%2e%2e/secret', '/%2e%2e%2fsecret', '/a%5cb', '/a%00b', '/%zz', '/api/recent?x=%zz', '/#fragment']) {
    assert.throws(() => parseRequestUrl(url), (error) => error.status === 400);
  }
  assert.equal(parseRequestUrl('/api/recent').pathname, '/api/recent');
});

test('production static serving protects dotfiles, traversal and symlinks outside dist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaori-static-'));
  assert.ok(isWithinDirectory(resolve(tmpdir()), resolve(directory)) && directory.includes('kaori-static-'));
  const dist = join(directory, 'dist');
  const outside = join(directory, 'outside');
  try {
    await mkdir(dist);
    await mkdir(outside);
    await writeFile(join(dist, 'index.html'), '<main>Kaori</main>');
    await writeFile(join(dist, 'style.css'), 'body{}');
    await mkdir(join(dist, 'research'));
    await writeFile(join(dist, 'research', 'kaori.html'), '<article>Kaori research</article>');
    await writeFile(join(dist, 'research', 'Kaori-IMD-Research.pdf'), '%PDF-1.7');
    await writeFile(join(outside, 'private.txt'), 'Private file');
    assert.equal((await resolveStaticFile(dist, '/', 'text/html')).type, 'text/html; charset=utf-8');
    assert.equal((await resolveStaticFile(dist, '/saved-receipts', 'text/html')).path, join(dist, 'index.html'));
    assert.equal((await resolveStaticFile(dist, '/style.css')).type, 'text/css; charset=utf-8');
    for (const articleUrl of ['/research/kaori', '/research/kaori/', '/research/kaori?source=x']) {
      const article = await resolveStaticFile(dist, articleUrl, 'text/html');
      assert.equal(article.path, join(dist, 'research', 'kaori.html'));
      assert.equal(article.type, 'text/html; charset=utf-8');
    }
    assert.equal((await resolveStaticFile(dist, '/research/Kaori-IMD-Research.pdf')).type, 'application/pdf');
    await assert.rejects(resolveStaticFile(dist, '/.env', 'text/html'), (error) => error.status === 404);
    await assert.rejects(resolveStaticFile(dist, '/%2e%2e/outside/private.txt'), (error) => error.status === 400);
    assert.equal(isWithinDirectory(dist, resolve(dist, '..', 'other')), false);
    await symlink(outside, join(dist, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveStaticFile(dist, '/escape/private.txt'), (error) => error.status === 404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
