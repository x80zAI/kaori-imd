export const IMD_CONTRACT = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7';
export const IMD_DECIMALS = 18;
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const RECENT_BLOCKS = 3_000n;
export const PUBLIC_PROVIDERS = Object.freeze([
  { name: 'PublicNode', url: 'https://ethereum-rpc.publicnode.com' },
  { name: 'Reth public RPC', url: 'https://ethereum.reth.rs/rpc' },
]);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_CACHE = 65;
const MAX_INFLIGHT = 32;
const CACHE_MS = 15_000;

export class PublicError extends Error {
  constructor(message, status = 503, code = 'unavailable') {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
  }
}

export function validateHash(value) {
  if (typeof value !== 'string' || !WORD.test(value)) {
    throw new PublicError('Enter a complete Ethereum transaction hash: 0x followed by 64 hexadecimal characters.', 400, 'invalid');
  }
  return value.toLowerCase();
}

export function parseQuantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value) || value.length > 66) throw new Error('Invalid RPC quantity');
  const quantity = BigInt(value);
  if (quantity > MAX_UINT256) throw new Error('Invalid RPC quantity');
  return quantity;
}

export function formatUnits(value, decimals = 18) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Invalid decimals');
  let amount;
  if (typeof value === 'bigint') amount = value;
  else if (typeof value === 'string' && (WORD.test(value) || /^\d+$/.test(value))) amount = BigInt(value);
  else throw new Error('Invalid amount');
  if (amount < 0n || amount > MAX_UINT256) throw new Error('Invalid amount');
  if (decimals === 0) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function rpcHash(value) {
  if (typeof value !== 'string' || !WORD.test(value)) throw new Error('Invalid RPC hash');
  return value.toLowerCase();
}

function rpcAddress(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('Invalid RPC address');
  return value.toLowerCase();
}

export function decodeWord(value) {
  if (typeof value !== 'string' || !WORD.test(value)) throw new Error('Invalid ABI word');
  return BigInt(value);
}

export function quantityHex(value) { return `0x${value.toString(16)}`; }

function timestampIso(value) {
  const seconds = parseQuantity(value);
  if (seconds > 8_640_000_000_000n) throw new Error('Invalid block timestamp');
  return new Date(Number(seconds) * 1_000).toISOString();
}

export function readBlock(value, expectedNumber, expectedHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Block is unavailable');
  const block = {
    number: parseQuantity(value.number), hash: rpcHash(value.hash), timestamp: timestampIso(value.timestamp),
    transactions: value.transactions,
  };
  if (expectedNumber !== undefined && block.number !== expectedNumber) throw new Error('Block number mismatch');
  if (expectedHash !== undefined && block.hash !== expectedHash) throw new Error('Block hash mismatch');
  if (!Array.isArray(block.transactions) || block.transactions.length > 100_000 || !block.transactions.every((hash) => typeof hash === 'string' && WORD.test(hash))) {
    throw new Error('Invalid block transactions');
  }
  return block;
}

function confirmBlockTransaction(block, hash, index) {
  if (index > 100_000n || block.transactions[Number(index)]?.toLowerCase() !== hash) throw new Error('Transaction is absent from the canonical block');
}

function readTransfer(log) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('Invalid log');
  if (rpcAddress(log.address) !== IMD_CONTRACT.toLowerCase()) throw new Error('Unexpected transfer contract');
  if (log.removed !== undefined && log.removed !== false) throw new Error('Removed or invalid transfer');
  if (!Array.isArray(log.topics) || log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
    !log.topics.slice(1).every((topic) => typeof topic === 'string' && WORD.test(topic) && /^0x0{24}/i.test(topic))) {
    throw new Error('Invalid transfer topics');
  }
  return {
    hash: rpcHash(log.transactionHash), blockHash: rpcHash(log.blockHash), blockNumber: parseQuantity(log.blockNumber),
    transactionIndex: parseQuantity(log.transactionIndex), logIndex: parseQuantity(log.logIndex),
    from: `0x${log.topics[1].slice(-40)}`.toLowerCase(), to: `0x${log.topics[2].slice(-40)}`.toLowerCase(),
    amount: formatUnits(decodeWord(log.data)),
  };
}

function uniqueTransfers(transfers) {
  const seen = new Map();
  for (const transfer of transfers) {
    const key = `${transfer.hash}:${transfer.logIndex}`;
    const previous = seen.get(key);
    if (previous) {
      for (const field of ['blockHash', 'blockNumber', 'transactionIndex', 'from', 'to', 'amount']) {
        if (previous[field] !== transfer[field]) throw new Error('Conflicting duplicate transfer');
      }
    } else seen.set(key, transfer);
  }
  return [...seen.values()];
}

export function decodeReceiptTransfers(logs, hash, blockNumber, blockHash, transactionIndex) {
  if (!Array.isArray(logs) || logs.length > 10_000) throw new Error('Invalid receipt logs');
  const transfers = [];
  for (const log of logs) {
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('Invalid receipt log');
    const address = rpcAddress(log.address);
    if (address !== IMD_CONTRACT.toLowerCase()) continue;
    if (!Array.isArray(log.topics) || !log.topics.every((topic) => typeof topic === 'string' && WORD.test(topic))) throw new Error('Invalid IMD log');
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const transfer = readTransfer(log);
    if (transfer.hash !== hash || transfer.blockNumber !== blockNumber || transfer.blockHash !== blockHash || transfer.transactionIndex !== transactionIndex) {
      throw new Error('Receipt transfer mismatch');
    }
    transfers.push(transfer);
  }
  return uniqueTransfers(transfers).sort((a, b) => a.logIndex < b.logIndex ? -1 : a.logIndex > b.logIndex ? 1 : 0)
    .map(({ from, to, amount, logIndex }) => ({ from, to, amount, logIndex: logIndex.toString() }));
}

export function decodeRecentTransfers(logs, fromBlock, blockNumber) {
  if (!Array.isArray(logs) || logs.length > 10_000) throw new Error('Invalid recent logs');
  const transfers = uniqueTransfers(logs.map(readTransfer));
  for (const transfer of transfers) {
    if (transfer.blockNumber < fromBlock || transfer.blockNumber > blockNumber) throw new Error('Transfer outside the requested snapshot');
  }
  transfers.sort((a, b) => {
    for (const field of ['blockNumber', 'transactionIndex', 'logIndex']) {
      if (a[field] !== b[field]) return a[field] > b[field] ? -1 : 1;
    }
    return 0;
  });
  const transactions = new Map();
  for (const transfer of transfers) {
    const previous = transactions.get(transfer.hash);
    if (previous) {
      if (previous.blockHash !== transfer.blockHash || previous.blockNumber !== transfer.blockNumber || previous.transactionIndex !== transfer.transactionIndex) {
        throw new Error('Recent transaction mismatch');
      }
      previous.transferCount += 1;
    } else transactions.set(transfer.hash, { hash: transfer.hash, blockNumber: transfer.blockNumber, blockHash: transfer.blockHash, transactionIndex: transfer.transactionIndex, transferCount: 1 });
  }
  return [...transactions.values()].slice(0, 8);
}

async function readBody(response) {
  const declared = response.headers?.get?.('content-length');
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) throw new Error('RPC response too large');
  if (!response.body?.getReader) {
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('RPC response too large');
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('RPC response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function rpcBatch(provider, requests, fetchImpl, signal) {
  const payload = requests.map(({ method, params }, index) => ({ jsonrpc: '2.0', id: index + 1, method, params }));
  const response = await fetchImpl(provider.url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload), signal,
  });
  if (!response.ok) throw new Error('RPC HTTP failure');
  const data = JSON.parse(await readBody(response));
  if (!Array.isArray(data) || data.length !== requests.length) throw new Error('Invalid RPC batch');
  const byId = new Map();
  for (const item of data) {
    if (!item || item.jsonrpc !== '2.0' || !Number.isInteger(item.id) || item.id < 1 || item.id > requests.length || byId.has(item.id)) throw new Error('Invalid RPC result');
    if (item.error) {
      if (!requests[item.id - 1].optional) throw new Error('RPC method failure');
      byId.set(item.id, null);
    } else {
      if (!Object.hasOwn(item, 'result')) throw new Error('Missing RPC result');
      byId.set(item.id, item.result);
    }
  }
  return requests.map((_, index) => byId.get(index + 1));
}

export async function withDeadline(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('RPC timeout')); }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}

export function validateContract(code, decimals) {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || /^0x(?:00)+$/.test(code)) throw new Error('IMD contract is unavailable');
  if (decodeWord(decimals) !== BigInt(IMD_DECIMALS)) throw new Error('Unexpected IMD decimals');
}

async function readSnapshot(provider, kind, hash, fetchImpl, signal, now) {
  const firstRequests = [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
  ];
  if (kind === 'receipt') firstRequests.push(
    { method: 'eth_getTransactionByHash', params: [hash] },
    { method: 'eth_getTransactionReceipt', params: [hash] },
  );
  const [chainId, latest, transaction, receipt] = await rpcBatch(provider, firstRequests, fetchImpl, signal);
  if (parseQuantity(chainId) !== 1n) throw new Error('Wrong Ethereum network');
  const snapshot = readBlock(latest);
  const blockTag = quantityHex(snapshot.number);
  const validation = [
    { method: 'eth_getCode', params: [IMD_CONTRACT, blockTag] },
    { method: 'eth_call', params: [{ to: IMD_CONTRACT, data: '0x313ce567' }, blockTag] },
  ];
  const common = { chainId: 1, contract: IMD_CONTRACT, retrievedAt: '', provider: provider.name };
  if (kind === 'recent') {
    const fromBlock = snapshot.number >= RECENT_BLOCKS - 1n ? snapshot.number - RECENT_BLOCKS + 1n : 0n;
    const [code, decimals, logs] = await rpcBatch(provider, [...validation,
      { method: 'eth_getLogs', params: [{ address: IMD_CONTRACT, topics: [TRANSFER_TOPIC], fromBlock: quantityHex(fromBlock), toBlock: blockTag }] },
    ], fetchImpl, signal);
    validateContract(code, decimals);
    const recent = decodeRecentTransfers(logs, fromBlock, snapshot.number);
    const blockNumbers = [...new Set(recent.map((item) => item.blockNumber.toString()))];
    const [head, ...blocks] = await rpcBatch(provider, [
      { method: 'eth_getBlockByNumber', params: [blockTag, false] },
      ...blockNumbers.map((number) => ({ method: 'eth_getBlockByNumber', params: [quantityHex(BigInt(number)), false] })),
    ], fetchImpl, signal);
    readBlock(head, snapshot.number, snapshot.hash);
    const byNumber = new Map(blocks.map((block, index) => [blockNumbers[index], readBlock(block, BigInt(blockNumbers[index]))]));
    for (const item of recent) {
      const block = byNumber.get(item.blockNumber.toString());
      if (block.hash !== item.blockHash) throw new Error('Recent transfer block mismatch');
      confirmBlockTransaction(block, item.hash, item.transactionIndex);
    }
    return { ...common, retrievedAt: new Date(now()).toISOString(), blockNumber: snapshot.number.toString(), fromBlock: fromBlock.toString(),
      transactions: recent.map(({ hash: transactionHash, blockNumber, transferCount }) => ({ hash: transactionHash, blockNumber: blockNumber.toString(), transferCount })) };
  }

  if (transaction === null && receipt !== null || transaction !== null && (!transaction || typeof transaction !== 'object' || Array.isArray(transaction))) throw new Error('Transaction response mismatch');
  let transactionBlock;
  let transactionIndex;
  let transactionBlockHash;
  let from;
  let to;
  if (transaction !== null) {
    if (rpcHash(transaction.hash) !== hash || transaction.chainId !== undefined && parseQuantity(transaction.chainId) !== 1n) throw new Error('Transaction identity mismatch');
    from = rpcAddress(transaction.from);
    to = rpcAddress(transaction.to, true);
    if (transaction.blockNumber !== null) {
      transactionBlock = parseQuantity(transaction.blockNumber);
      transactionIndex = parseQuantity(transaction.transactionIndex);
      transactionBlockHash = rpcHash(transaction.blockHash);
      if (transactionBlock > snapshot.number) throw new Error('Transaction is newer than the snapshot');
    } else if (transaction.blockHash !== null || transaction.transactionIndex !== null) throw new Error('Pending transaction mismatch');
  }
  const extraReads = [
    { method: 'eth_getBlockByNumber', params: [blockTag, false] },
    { method: 'eth_getBlockByNumber', params: ['finalized', false], optional: true },
  ];
  if (transactionBlock !== undefined) extraReads.push({ method: 'eth_getBlockByNumber', params: [quantityHex(transactionBlock), false] });
  const [code, decimals, head, finalized, blockValue] = await rpcBatch(provider, [...validation, ...extraReads], fetchImpl, signal);
  validateContract(code, decimals);
  readBlock(head, snapshot.number, snapshot.hash);
  if (transaction === null) throw new PublicError('This transaction was not found by the Ethereum providers. Check the hash and network.', 404, 'not_found');
  const base = { ...common, hash, from, to, snapshotBlockNumber: snapshot.number.toString(), retrievedAt: new Date(now()).toISOString() };
  if (receipt === null) {
    if (transactionBlock !== undefined) throw new Error('Mined transaction receipt is missing');
    return { ...base, status: 'pending', blockNumber: null, blockHash: null, timestamp: null, confirmations: null, finality: 'unknown',
      gasUsed: null, gasPriceWei: null, feeEth: null, transfers: [], warning: 'This transaction is pending. Its receipt and IMD transfers are not available yet.' };
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || transactionBlock === undefined) throw new Error('Invalid mined receipt');
  if (rpcHash(receipt.transactionHash) !== hash || parseQuantity(receipt.blockNumber) !== transactionBlock || rpcHash(receipt.blockHash) !== transactionBlockHash ||
    parseQuantity(receipt.transactionIndex) !== transactionIndex || rpcAddress(receipt.from) !== from || rpcAddress(receipt.to, true) !== to) throw new Error('Receipt identity mismatch');
  const block = readBlock(blockValue, transactionBlock, transactionBlockHash);
  confirmBlockTransaction(block, hash, transactionIndex);
  const statusQuantity = parseQuantity(receipt.status);
  if (statusQuantity !== 0n && statusQuantity !== 1n) throw new Error('Unknown transaction status');
  const gasUsed = parseQuantity(receipt.gasUsed);
  let gasPrice;
  if (receipt.effectiveGasPrice !== undefined && receipt.effectiveGasPrice !== null) gasPrice = parseQuantity(receipt.effectiveGasPrice);
  else if (transaction.type !== undefined && parseQuantity(transaction.type) <= 1n) gasPrice = parseQuantity(transaction.gasPrice);
  else throw new Error('Execution gas price is unavailable');
  const transfers = decodeReceiptTransfers(receipt.logs, hash, transactionBlock, transactionBlockHash, transactionIndex);
  if (statusQuantity === 0n && receipt.logs.length) throw new Error('Reverted transaction contains committed logs');
  let finality = 'unknown';
  if (finalized !== null) {
    try {
      const finalBlock = readBlock(finalized);
      if (finalBlock.number <= snapshot.number) finality = transactionBlock <= finalBlock.number ? 'finalized' : 'unfinalized';
    } catch { /* Finality stays unknown when that optional observation is unavailable. */ }
  }
  return { ...base, status: statusQuantity === 1n ? 'success' : 'reverted', blockNumber: transactionBlock.toString(), blockHash: transactionBlockHash,
    timestamp: block.timestamp, confirmations: (snapshot.number - transactionBlock + 1n).toString(), finality,
    gasUsed: gasUsed.toString(), gasPriceWei: gasPrice.toString(), feeEth: formatUnits(gasUsed * gasPrice), transfers,
    warning: statusQuantity === 0n ? 'This transaction reverted. It produced no committed IMD transfers.' :
      transfers.length === 0 ? 'This is an Ethereum transaction, but its receipt contains no Transfer events from the official IMD contract.' : null };
}

export function createEthereumService({ fetchImpl = globalThis.fetch, providers = PUBLIC_PROVIDERS, timeoutMs = 12_000, cacheMs = CACHE_MS, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Array.isArray(providers) || providers.length < 1 || providers.length > 2 ||
    !providers.every((provider) => typeof provider?.name === 'string' && typeof provider?.url === 'string') ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 12_000 || !Number.isFinite(cacheMs) || cacheMs < 0) throw new Error('Invalid service configuration');
  const cache = new Map();
  const pending = new Map();
  async function retrieve(kind, hash) {
    let notFound = 0;
    for (const provider of providers) {
      try { return await withDeadline((signal) => readSnapshot(provider, kind, hash, fetchImpl, signal, now), timeoutMs); }
      catch (error) {
        if (error instanceof PublicError && error.status === 404) notFound += 1;
        // Repeat the entire read with the next provider; never combine observations.
      }
    }
    if (notFound === providers.length) throw new PublicError('This transaction was not found by the Ethereum providers. Check the hash and network.', 404, 'not_found');
    throw new PublicError('Ethereum data is unavailable right now. Please try again shortly.');
  }
  async function get(kind, hash) {
    const key = hash ? `receipt:${hash}` : 'recent';
    const entry = cache.get(key);
    const current = now();
    if (entry && current >= entry.savedAt && current - entry.savedAt < cacheMs) return structuredClone(entry.value);
    if (entry) cache.delete(key);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (pending.size >= MAX_INFLIGHT) throw new PublicError('Too many Ethereum requests are in progress. Please try again shortly.');
    const operation = retrieve(kind, hash).then((value) => {
      cache.delete(key);
      cache.set(key, { value, savedAt: now() });
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      return value;
    });
    pending.set(key, operation);
    try { return structuredClone(await operation); }
    finally { pending.delete(key); }
  }
  return { getReceipt: (hash) => get('receipt', validateHash(hash)), getRecent: () => get('recent') };
}

export const ethereumService = createEthereumService();
