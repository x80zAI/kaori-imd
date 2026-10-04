import { PublicError, withDeadline } from './ethereum.mjs';
import { parseRequestUrl, sendJson } from './http.mjs';

const API = 'https://api.imd.fun';
const EXPLORER = 'https://explorer.imd.fun';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PAGE_SIZE = 20;
const MAX_BYTES = 2_000_000;
const VIEWS = ['overview', 'jobs', 'oracles', 'job', 'oracle'];
const ORACLE_ANSWER_TYPES = new Set(['bool', 'address', 'bytes32', 'uint256', 'address[]', 'bytes32[]']);
const unavailable = () => new PublicError('IMD network data is unavailable right now. Please try again shortly.');
const invalid = () => new PublicError('Choose a valid network view and its supported search parameters.', 400, 'invalid');

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value;
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
  return value;
}
function optionalCount(value) { return value == null ? null : count(value); }
function bool(value) { if (typeof value !== 'boolean') throw unavailable(); return value; }
function text(value, max = 12_000) {
  if (typeof value !== 'string' || value.length > 300_000) throw unavailable();
  return value.length > max ? `${value.slice(0, max)}\n[Text shortened. Open the source for the full record.]` : value;
}
function optionalText(value, max) { return value == null ? null : text(value, max); }
function timestamp(value) {
  if (typeof value !== 'string' || !ISO.test(value)) throw unavailable();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) throw unavailable();
  return parsed.toISOString();
}
function optionalTime(value) { return value == null ? null : timestamp(value); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw unavailable(); return value.toLowerCase(); }
function decimalId(value) {
  if (typeof value === 'number') return String(count(value));
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw unavailable();
  return value;
}
function address(value) { if (value == null) return null; if (typeof value !== 'string' || !ADDRESS.test(value)) throw unavailable(); return value.toLowerCase(); }
function array(value, max) { if (!Array.isArray(value) || value.length > max) throw unavailable(); return value; }
function status(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_:. -]{1,60}$/.test(value)) throw unavailable(); return value; }
function answerType(value) { if (!ORACLE_ANSWER_TYPES.has(value)) throw unavailable(); return value; }
function sourceFor(view, id) {
  return view === 'job' ? `${EXPLORER}/jobs/${uuid(id)}` : view === 'agent' ? `${EXPLORER}/agents/${decimalId(id)}` : `${API}/oracle/requests/${uuid(id)}?members=0`;
}

export function parseNetworkQuery(params) {
  if (!(params instanceof URLSearchParams)) throw invalid();
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw invalid();
  const view = params.get('view');
  if (!VIEWS.includes(view)) throw invalid();
  const list = view === 'jobs' || view === 'oracles';
  const detail = view === 'job' || view === 'oracle';
  const allowed = list ? ['view', 'q', 'before'] : detail ? ['view', 'id'] : ['view'];
  if (keys.some(key => !allowed.includes(key))) throw invalid();
  const q = params.get('q') ?? '';
  if (q.length > 200 || /[\x00-\x1f\x7f]/.test(q)) throw invalid();
  let before = null;
  if (params.has('before')) { try { before = timestamp(params.get('before')); } catch { throw invalid(); } }
  let id = null;
  if (detail) { try { id = uuid(params.get('id')); } catch { throw invalid(); } }
  return { view, q: q.trim(), before, id };
}

function requestPath(request) {
  if (request.view === 'overview') return '/swarm';
  if (request.view === 'job') return `/jobs/${request.id}`;
  if (request.view === 'oracle') return `/oracle/requests/${request.id}?members=0`;
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (request.view === 'jobs') params.set('exclude', 'oracle');
  if (request.q) params.set('q', request.q);
  if (request.before) params.set('before', request.before);
  return `${request.view === 'jobs' ? '/jobs' : '/oracle/requests'}?${params}`;
}

function normalizeOverview(raw) {
  const health = object(raw.health), counts = object(raw.counts), seats = object(raw.seats);
  if (health.reachable !== true) throw unavailable();
  const at = count(raw.at);
  if (at < 1 || !Number.isFinite(new Date(at).valueOf())) throw unavailable();
  const metrics = {};
  for (const key of ['agentsOnline', 'workingNow', 'seatsEnrolled', 'acceptedLastDay', 'jobsDoneLastDay', 'oraclesDoneLastDay']) metrics[key] = count(health[key]);
  for (const key of ['jobs', 'tasksInProgress', 'launchesLive', 'sites', 'inferenceTokens']) metrics[key] = count(counts[key]);
  const owners = raw.owners == null ? [] : array(raw.owners, 20_000);
  const entries = Object.entries(seats);
  if (entries.length > 5_000) throw unavailable();
  const agents = entries.map(([key, value]) => {
    const seat = object(value), tokenId = decimalId(seat.tokenId);
    if (key !== tokenId) throw unavailable();
    return { tokenId, agentId: seat.agentId == null ? null : decimalId(seat.agentId), owner: address(owners[Number(tokenId)]),
      working: bool(seat.working), queued: count(seat.queued), attempts: count(seat.attempts), accepted: count(seat.accepted),
      rejected: count(seat.rejected), failed: count(seat.failed), pending: count(seat.pending), lastWorkedAt: optionalTime(seat.last), sourceUrl: sourceFor('agent', tokenId) };
  });
  const events = array(raw.events, 300).slice(0, 30).map(value => {
    const event = object(value), kind = status(event.kind);
    const tokenId = event.tokenId == null ? null : decimalId(event.tokenId);
    const jobId = event.jobId == null ? null : uuid(event.jobId);
    const eventState = event.state ?? event.status;
    return { kind, at: timestamp(event.at), title: event.objective != null ? text(event.objective, 280) : tokenId != null ? `Seat #${tokenId}` : event.token != null ? text(event.token, 100) : kind,
      state: eventState == null ? null : status(eventState), sourceUrl: jobId ? sourceFor('job', jobId) : tokenId != null ? sourceFor('agent', tokenId) : null };
  });
  return { observedAt: new Date(at).toISOString(), reachable: true, metrics, agents, events };
}

function normalizeJob(raw) {
  const id = uuid(raw.id);
  return { id, state: status(raw.state), template: text(raw.template, 120), objective: text(raw.objective), blockedReason: optionalText(raw.blockedReason),
    createdAt: timestamp(raw.createdAt), updatedAt: timestamp(raw.updatedAt), sourceUrl: sourceFor('job', id) };
}
function normalizeOracle(raw) {
  const id = uuid(raw.id);
  return { id, status: status(raw.status), question: text(raw.question), chainId: count(raw.chainId), answerType: answerType(raw.answerType),
    jobId: raw.jobId == null ? null : uuid(raw.jobId), createdAt: timestamp(raw.createdAt), updatedAt: timestamp(raw.updatedAt), attestedAt: optionalTime(raw.attestedAt), sourceUrl: sourceFor('oracle', id) };
}
function resultText(value) {
  if (value === null || value === undefined) return null;
  function validateResult(item, depth = 0) {
    if (depth > 12 || typeof item === 'number' && !Number.isSafeInteger(item)) throw unavailable();
    if (Array.isArray(item)) { if (item.length > 1000) throw unavailable(); for (const child of item) validateResult(child, depth + 1); }
    else if (item && typeof item === 'object') { const values = Object.values(item); if (values.length > 1000) throw unavailable(); for (const child of values) validateResult(child, depth + 1); }
  }
  validateResult(value);
  const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text(serialized, 20_000);
}
function normalizeJobDetail(raw) {
  const base = normalizeJob(raw);
  const nodes = array(raw.nodes, 500).map(value => {
    const node = object(value);
    return { key: text(node.key, 160), role: status(node.role), state: status(node.state), attempt: count(node.attempt),
      tokenId: node.seat == null ? null : decimalId(object(node.seat).tokenId), verdict: node.verdict == null ? null : optionalText(object(node.verdict).detail, 1200) };
  });
  const delivery = raw.delivery == null ? null : object(raw.delivery);
  const media = raw.media == null ? null : object(raw.media);
  const results = [];
  if (delivery?.commit != null) results.push(`Delivery commit: ${text(delivery.commit, 100)}`);
  if (media?.files != null) for (const file of array(media.files, 200)) results.push(`${text(object(file).name, 120)} (${text(file.mediaType, 120)})`);
  if (delivery?.media?.files != null && !media?.files) for (const file of array(delivery.media.files, 200)) results.push(`${text(object(file).name, 120)} (${text(file.mediaType, 120)})`);
  return { ...base, nodes, resultText: results.length ? results.join('\n') : null };
}
function normalizeOracleDetail(raw) {
  const base = normalizeOracle(raw);
  const agreement = raw.agreement == null ? null : object(raw.agreement);
  const computed = raw.computed == null ? null : object(raw.computed);
  const attestation = raw.attestation == null ? null : object(raw.attestation);
  const window = raw.window == null ? null : object(raw.window);
  const computedAnswer = computed && Object.hasOwn(computed, 'answer') && computed.answer != null;
  const agreementAnswer = agreement && Object.hasOwn(agreement, 'answer') && agreement.answer != null;
  const signaturePresent = typeof raw.signature === 'string' && /^0x[0-9a-f]{130}$/i.test(raw.signature);
  let expiresAt = null;
  if (attestation?.expiresAt != null) { const ms = count(attestation.expiresAt) * 1000; if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).valueOf())) throw unavailable(); expiresAt = new Date(ms).toISOString(); }
  return { ...base, evidence: optionalText(raw.evidence, 100), panelSize: optionalCount(raw.panelSize), quorum: optionalCount(raw.quorum), agreed: optionalCount(agreement?.agreed),
    resultText: resultText(computedAnswer ? computed.answer : agreementAnswer ? agreement.answer : null), resultSource: computedAnswer ? 'computed' : agreementAnswer ? 'agreement' : null,
    failure: resultText(raw.failure), signer: address(raw.signer), signaturePresent, expiresAt,
    fromBlock: window?.fromBlock == null ? null : decimalId(window.fromBlock), toBlock: window?.toBlock == null ? null : decimalId(window.toBlock) };
}

export function normalizeNetworkData(request, input) {
  const raw = object(input);
  if (Object.hasOwn(raw, 'error') || raw.statusCode >= 400) throw unavailable();
  if (request.view === 'overview') return normalizeOverview(raw);
  if (request.view === 'job' || request.view === 'oracle') {
    const data = request.view === 'job' ? normalizeJobDetail(raw) : normalizeOracleDetail(raw);
    if (data.id !== request.id) throw unavailable();
    return data;
  }
  const items = array(request.view === 'jobs' ? raw.jobs : raw.requests, PAGE_SIZE).map(item => request.view === 'jobs' ? normalizeJob(object(item)) : normalizeOracle(object(item)));
  if (count(raw.count) !== items.length || new Set(items.map(item => item.id)).size !== items.length) throw unavailable();
  for (let i = 0; i < items.length; i++) {
    if (request.before && items[i].createdAt >= request.before || i > 0 && items[i].createdAt > items[i - 1].createdAt) throw unavailable();
  }
  return { items, count: items.length, nextBefore: items.length === PAGE_SIZE ? items.at(-1).createdAt : null };
}

async function readJson(response, signal) {
  if (!response.ok) {
    if (response.status === 404) throw new PublicError('This public IMD record is unavailable or could not be found.', 404, 'not_found');
    throw unavailable();
  }
  if (response.redirected || !/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) throw unavailable();
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw unavailable();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw unavailable();
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export function createNetworkService({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000, cacheMs = 15_000, maxCache = 48, maxInflight = 12 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000 || !Number.isFinite(cacheMs) || cacheMs < 0 || cacheMs > 30_000 || !Number.isInteger(maxCache) || maxCache < 1 || maxCache > 64 || !Number.isInteger(maxInflight) || maxInflight < 1 || maxInflight > 16) throw new Error('Invalid network service configuration');
  const cache = new Map(), pending = new Map();
  async function getNetwork(params) {
    const request = parseNetworkQuery(params);
    const path = requestPath(request), current = now(), entry = cache.get(path);
    if (entry && current >= entry.savedAt && current - entry.savedAt < cacheMs) return structuredClone(entry.value);
    if (entry) cache.delete(path);
    if (pending.has(path)) return structuredClone(await pending.get(path));
    if (pending.size >= maxInflight) throw new PublicError('Too many network readings are in progress. Please try again shortly.');
    const task = withDeadline(async signal => {
      const response = await fetchImpl(`${API}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
      const raw = await readJson(response, signal);
      return { view: request.view, retrievedAt: new Date(now()).toISOString(), sourceUrl: `${API}${path}`, data: normalizeNetworkData(request, raw) };
    }, timeoutMs).catch(error => { throw error instanceof PublicError ? error : unavailable(); });
    pending.set(path, task);
    try {
      const value = await task;
      cache.set(path, { value, savedAt: now() });
      while (cache.size > maxCache) cache.delete(cache.keys().next().value);
      return structuredClone(value);
    } finally { pending.delete(path); }
  }
  return { getNetwork };
}

export function createNetworkHandler(service) {
  return async (request, response) => {
    try {
      if (request.method !== 'GET') { sendJson(response, 405, { error: 'Use GET to read public IMD network data.', code: 'invalid' }, { Allow: 'GET' }); return; }
      const { url, pathname } = parseRequestUrl(request.url);
      if (pathname !== '/api/network') throw new PublicError('This data endpoint does not exist.', 404, 'not_found');
      sendJson(response, 200, await service.getNetwork(url.searchParams));
    } catch (error) {
      const known = error instanceof PublicError;
      sendJson(response, known ? error.status : 503, { error: known ? error.message : unavailable().message, code: known ? error.code : 'unavailable' });
    }
  };
}
export const networkService = createNetworkService();
