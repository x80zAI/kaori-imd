import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkHandler, createNetworkService, normalizeNetworkData, parseNetworkQuery } from '../server/network.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
const TIME = '2026-10-04T12:00:00.000Z';
const query = value => new URLSearchParams(value);
const request = value => parseNetworkQuery(query(value));
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const job = (overrides = {}) => ({ id: ID, state: 'completed', template: 'skill:build-website', objective: 'A public job', blockedReason: null, createdAt: TIME, updatedAt: TIME, ...overrides });
const oracle = (overrides = {}) => ({ id: ID, status: 'attested', question: 'A public question', chainId: 1, answerType: 'bool', jobId: null, createdAt: TIME, updatedAt: TIME, attestedAt: TIME, ...overrides });
const overview = () => ({ at: Date.parse(TIME), health: { reachable: true, agentsOnline: 2, workingNow: 1, seatsEnrolled: 3, acceptedLastDay: 12, jobsDoneLastDay: 3, oraclesDoneLastDay: 2 }, counts: { jobs: 4, tasksInProgress: 1, launchesLive: 0, sites: 0, inferenceTokens: 100 },
  seats: { '0': { tokenId: 0, agentId: '42', working: false, queued: 0, attempts: 4, accepted: 2, rejected: 1, failed: 0, pending: 1, last: TIME } }, owners: ['0x' + 'a'.repeat(40)], events: [{ kind: 'agent', at: TIME, tokenId: 0, state: 'joined' }] });
const isUnavailable = error => error.status === 503 && error.code === 'unavailable';

test('query allows only per-view parameters and normalizes identifiers/search/cursor', () => {
  assert.deepEqual(request('view=overview'), { view: 'overview', q: '', before: null, id: null });
  assert.equal(request(`view=job&id=${ID.toUpperCase()}`).id, ID);
  assert.equal(request('view=jobs&q=+IMD+&before=2026-10-04T12%3A00%3A00Z').before, TIME);
  for (const invalid of ['', 'view=no', 'view=jobs&view=jobs', 'view=overview&q=x', 'view=jobs&id=x', 'view=job', `view=job&id=${ID}&q=x`, 'view=oracle&id=../../requests', 'view=oracles&limit=500', 'view=jobs&url=https://example.com', 'view=jobs&q=%00', `view=jobs&q=${'a'.repeat(201)}`, 'view=jobs&before=2026-02-30T12:00:00Z', 'view=jobs&before=tomorrow']) {
    assert.throws(() => request(invalid), error => error.status === 400);
  }
});

test('overview preserves one snapshot and real zero without inferring agent online', () => {
  const data = normalizeNetworkData(request('view=overview'), overview());
  assert.equal(data.observedAt, TIME);
  assert.equal(data.metrics.launchesLive, 0);
  assert.equal(data.agents[0].tokenId, '0');
  assert.equal(data.agents[0].working, false);
  assert.equal(Object.hasOwn(data.agents[0], 'online'), false);
  assert.equal(data.events[0].sourceUrl, 'https://explorer.imd.fun/agents/0');
});

test('missing, coerced, fractional or unsafe metrics never become real zero', () => {
  for (const value of [undefined, null, '2', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const raw = overview(); raw.health.agentsOnline = value;
    assert.throws(() => normalizeNetworkData(request('view=overview'), raw), isUnavailable);
  }
  const raw = overview(); raw.health.reachable = false;
  assert.throws(() => normalizeNetworkData(request('view=overview'), raw), isUnavailable);
});

test('agent IDs, owners, event identities and dates must be valid', () => {
  for (const change of [raw => { raw.seats['0'].tokenId = 2; }, raw => { raw.owners[0] = 'javascript:alert(1)'; }, raw => { raw.seats['0'].working = 'false'; }, raw => { raw.events[0].at = 'yesterday'; }, raw => { raw.events[0].jobId = '../../admin'; }]) {
    const raw = overview(); change(raw); assert.throws(() => normalizeNetworkData(request('view=overview'), raw), isUnavailable);
  }
});

test('lists return page count and a cursor only for a full page', () => {
  const items = Array.from({ length: 20 }, (_, i) => job({ id: `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`, createdAt: new Date(Date.parse(TIME) - i * 1000).toISOString() }));
  const page = normalizeNetworkData(request('view=jobs'), { count: 20, jobs: items });
  assert.equal(page.count, 20); assert.equal(page.nextBefore, items.at(-1).createdAt);
  assert.deepEqual(normalizeNetworkData(request('view=jobs'), { count: 0, jobs: [] }), { count: 0, items: [], nextBefore: null });
  assert.equal(normalizeNetworkData(request('view=oracles'), { count: 1, requests: [oracle()] }).nextBefore, null);
});

test('lists reject inconsistent counts, duplicate rows, wrong sort order and ignored cursor', () => {
  const second = job({ id: '22222222-2222-4333-8444-555555555555', createdAt: '2026-10-04T13:00:00.000Z' });
  for (const raw of [{ count: 2, jobs: [job()] }, { count: 2, jobs: [job(), job()] }, { count: 2, jobs: [job(), second] }]) assert.throws(() => normalizeNetworkData(request('view=jobs'), raw), isUnavailable);
  assert.throws(() => normalizeNetworkData(request(`view=jobs&before=${TIME}`), { count: 1, jobs: [job()] }), isUnavailable);
});

test('job details bind returned UUID to requested record and expose safe text', () => {
  const raw = job({ nodes: [{ key: 'build', role: 'implement', state: 'accepted', attempt: 1, seat: { tokenId: '0' }, verdict: { detail: '<img src=x onerror=alert(1)>' } }], media: { files: [{ name: 'image', mediaType: 'image/png' }] }, delivery: { repoUrl: 'javascript:alert(1)' } });
  const data = normalizeNetworkData(request(`view=job&id=${ID}`), raw);
  assert.equal(data.nodes[0].verdict, '<img src=x onerror=alert(1)>');
  assert.equal(data.resultText, 'image (image/png)');
  assert.equal(Object.hasOwn(data, 'delivery'), false);
  assert.equal(data.sourceUrl, `https://explorer.imd.fun/jobs/${ID}`);
  raw.id = '22222222-2222-4333-8444-555555555555';
  assert.throws(() => normalizeNetworkData(request(`view=job&id=${ID}`), raw), isUnavailable);
});

test('oracle false and zero answers are kept, absence remains unavailable, no signature verification is invented', () => {
  const read = raw => normalizeNetworkData(request(`view=oracle&id=${ID}`), raw);
  const base = oracle({ computed: { answer: false }, agreement: { answer: true, agreed: 4 }, panelSize: 5, quorum: 4, signature: '0x' + 'a'.repeat(130), signer: '0x' + 'b'.repeat(40), attestation: { expiresAt: 1791151200 }, window: { fromBlock: 1, toBlock: 2 } });
  assert.equal(read(base).resultText, 'false'); assert.equal(read(base).resultSource, 'computed');
  assert.equal(read(base).signaturePresent, true); assert.equal(Object.hasOwn(read(base), 'verified'), false);
  assert.equal(read({ ...base, computed: { answer: 0 } }).resultText, '0');
  assert.equal(read({ ...base, computed: null }).resultSource, 'agreement');
  assert.equal(read({ ...base, computed: null, agreement: null }).resultText, null);
  assert.equal(read({ ...base, computed: { answer: '900719925474099300000' } }).resultText, '900719925474099300000');
  assert.throws(() => read({ ...base, computed: { answer: Number.MAX_SAFE_INTEGER + 1 } }), isUnavailable);
});

test('oracle ABI array answer types remain readable in list and detail responses', () => {
  for (const answerType of ['bool', 'address', 'bytes32', 'uint256', 'address[]', 'bytes32[]']) {
    const raw = oracle({ answerType });
    const list = normalizeNetworkData(request('view=oracles'), { count: 1, requests: [raw] });
    assert.equal(list.items[0].answerType, answerType);
    assert.equal(normalizeNetworkData(request(`view=oracle&id=${ID}`), raw).answerType, answerType);
  }
  const answer = ['0x' + 'a'.repeat(64), '0x' + 'b'.repeat(64)];
  const detail = normalizeNetworkData(request(`view=oracle&id=${ID}`), oracle({ answerType: 'bytes32[]', computed: { answer } }));
  assert.deepEqual(JSON.parse(detail.resultText), answer);
  assert.equal(detail.resultSource, 'computed');
});

test('oracle answer types reject unsupported shapes without relaxing status validation', () => {
  for (const answerType of [undefined, null, {}, ['bool'], '', 'BOOL', 'uint256[]', 'bytes32[2]', 'bytes32[][]', 'bytes32[] ', '<script>', 'x'.repeat(61)]) {
    assert.throws(() => normalizeNetworkData(request('view=oracles'), { count: 1, requests: [oracle({ answerType })] }), isUnavailable);
  }
  assert.throws(() => normalizeNetworkData(request('view=oracles'), { count: 1, requests: [oracle({ status: 'attested[]' })] }), isUnavailable);
});

test('upstream receives one fixed-origin GET with encoded search and bounded page size', async () => {
  let seen;
  const service = createNetworkService({ fetchImpl: async (url, options) => { seen = { url, options }; return response({ count: 0, jobs: [] }); } });
  await service.getNetwork(query('view=jobs&q=https%3A%2F%2Fevil.invalid%2Fx%3Fx%3D1%26limit%3D999'));
  const url = new URL(seen.url);
  assert.equal(url.origin, 'https://api.imd.fun'); assert.equal(url.pathname, '/jobs');
  assert.equal(url.searchParams.get('limit'), '20'); assert.equal(url.searchParams.get('exclude'), 'oracle');
  assert.equal(url.searchParams.get('q'), 'https://evil.invalid/x?x=1&limit=999');
  assert.equal(seen.options.method, 'GET'); assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.headers.Authorization, undefined);
});

test('oracle details omit heavy members and bind the response', async () => {
  let seen;
  const service = createNetworkService({ fetchImpl: async url => { seen = url; return response(oracle()); } });
  await service.getNetwork(query(`view=oracle&id=${ID}`));
  assert.equal(seen, `https://api.imd.fun/oracle/requests/${ID}?members=0`);
});

test('cache/coalescing returns independent copies and expires using retrieval time', async () => {
  let calls = 0, now = 1000, release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createNetworkService({ now: () => now, cacheMs: 100, fetchImpl: async () => { calls++; await gate; return response({ count: 1, jobs: [job()] }); } });
  const first = service.getNetwork(query('view=jobs')), second = service.getNetwork(query('view=jobs'));
  release(); const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); a.data.items[0].objective = 'changed'; assert.equal(b.data.items[0].objective, 'A public job');
  assert.equal((await service.getNetwork(query('view=jobs'))).data.items[0].objective, 'A public job');
  now = 1101; await service.getNetwork(query('view=jobs')); assert.equal(calls, 2);
});

test('cache storage and distinct in-flight work are bounded', async () => {
  let calls = 0;
  const cache = createNetworkService({ maxCache: 1, fetchImpl: async () => { calls++; return response({ count: 0, jobs: [] }); } });
  await cache.getNetwork(query('view=jobs&q=a')); await cache.getNetwork(query('view=jobs&q=b')); await cache.getNetwork(query('view=jobs&q=a')); assert.equal(calls, 3);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const service = createNetworkService({ maxInflight: 1, fetchImpl: async () => { await gate; return response({ count: 0, jobs: [] }); } });
  const pending = service.getNetwork(query('view=jobs&q=a'));
  await assert.rejects(service.getNetwork(query('view=jobs&q=b')), isUnavailable); release(); await pending;
});

test('upstream failure, error bodies, wrong content type, oversized bodies and redirects cannot become data', async () => {
  const bad = [() => new Response('{}', { status: 429 }), () => response({ error: 'SECRET internal failure' }), () => new Response('{}'), () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } }), () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2000001' } }), () => { const r = response({ count: 0, jobs: [] }); Object.defineProperty(r, 'redirected', { value: true }); return r; }];
  for (const make of bad) await assert.rejects(createNetworkService({ fetchImpl: async () => make() }).getNetwork(query('view=jobs')), error => isUnavailable(error) && !error.message.includes('SECRET'));
});

test('provider deadline settles hung work and does not cache failures', async () => {
  await assert.rejects(createNetworkService({ timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }).getNetwork(query('view=jobs')), isUnavailable);
  let calls = 0;
  const service = createNetworkService({ fetchImpl: async () => { calls++; return calls === 1 ? response({ error: 'outage' }) : response({ count: 0, jobs: [] }); } });
  await assert.rejects(service.getNetwork(query('view=jobs')), isUnavailable);
  assert.equal((await service.getNetwork(query('view=jobs'))).data.count, 0); assert.equal(calls, 2);
});

test('HTTP handler is GET-only, validates URL/route/query, and hides unexpected errors', async () => {
  let reads = 0;
  const service = { getNetwork: async params => { reads++; parseNetworkQuery(params); return { view: 'overview' }; } };
  const handler = createNetworkHandler(service);
  async function run(method, url) { const result = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } }; await handler({ method, url }, result); return result; }
  assert.equal((await run('POST', '/api/network?view=overview')).statusCode, 405); assert.equal(reads, 0);
  assert.equal((await run('GET', '/api/network?view=overview')).statusCode, 200);
  assert.equal((await run('GET', '/api/network?view=jobs&url=x')).statusCode, 400);
  assert.equal((await run('GET', '/api/network/../network?view=overview')).statusCode, 400);
  assert.equal((await run('GET', '/api/wrong?view=overview')).statusCode, 404);
  service.getNetwork = async () => { throw new Error('SECRET internal details'); };
  const failure = await run('GET', '/api/network?view=overview'); assert.equal(failure.statusCode, 503); assert.equal(failure.body.error.includes('SECRET'), false);
});
