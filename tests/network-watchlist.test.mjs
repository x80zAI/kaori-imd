import assert from 'node:assert/strict';
import test from 'node:test';
import { NETWORK_WATCHLIST_LIMIT, readNetworkWatchlist, saveNetworkItem, serializeNetworkWatchlist, watchlistKey } from '../src/network-watchlist.mjs';

const uuid = id => `12345678-abcd-abcd-abcd-${String(id).padStart(12, '0')}`;
const item = (id, kind = 'job') => ({ id: kind === 'agent' ? String(id) : uuid(id), kind, label: `Saved ${id}`, note: '', savedAt: '2026-10-04T20:00:00.000Z' });

test('new watchlists contain no preloaded activity', () => {
  assert.deepEqual(readNetworkWatchlist(null), []);
  assert.deepEqual(readNetworkWatchlist(''), []);
});

test('saved kinds do not collide and same-item notes update without duplication', () => {
  let list = saveNetworkItem([], item('42'));
  list = saveNetworkItem(list, item('42', 'oracle'));
  list = saveNetworkItem(list, { ...item('42'), note: 'Check the public result later.' });
  assert.equal(list.length, 2);
  assert.equal(list[0].note, 'Check the public result later.');
  assert.notEqual(watchlistKey('job', '42'), watchlistKey('oracle', '42'));
  assert.deepEqual(readNetworkWatchlist(serializeNetworkWatchlist(list)), list);
});

test('full watchlists reject new items but permit updating saved notes', () => {
  const list = Array.from({ length: NETWORK_WATCHLIST_LIMIT }, (_, i) => item(String(i)));
  assert.throws(() => saveNetworkItem(list, item('31')), /Remove one/);
  assert.equal(saveNetworkItem(list, { ...item('0'), note: 'updated' }).length, NETWORK_WATCHLIST_LIMIT);
});

test('corrupt, ambiguous, oversized or unsupported storage is rejected', () => {
  const store = entries => JSON.stringify({ version: 1, entries });
  for (const raw of ['{', JSON.stringify([]), JSON.stringify({ version: 2, entries: [] }), store([item('4'), item('4')]), store([item('../unsafe')]), store([item('3', 'other')]), store([{ ...item('3'), savedAt: 'not a date' }]), store([{ ...item('3'), note: 'a'.repeat(501) }]), store(Array.from({ length: 31 }, (_, i) => item(String(i))))]) {
    assert.throws(() => readNetworkWatchlist(raw));
  }
});

test('IDs match their record type and UUID casing cannot duplicate a save', () => {
  assert.throws(() => saveNetworkItem([], { ...item('2'), id: '2' }));
  assert.throws(() => saveNetworkItem([], { ...item('2', 'agent'), id: uuid('2') }));
  assert.throws(() => saveNetworkItem([], item('02', 'agent')));
  let list = saveNetworkItem([], item('2'));
  list = saveNetworkItem(list, { ...item('2'), id: uuid('2').toUpperCase() });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, uuid('2'));
  assert.deepEqual(readNetworkWatchlist(serializeNetworkWatchlist([item('0', 'agent')])), [item('0', 'agent')]);
});

test('export strips unrelated fields and preserves personal text as text', () => {
  const list = saveNetworkItem([], { ...item('7'), note: '<script>not executable content</script>', payload: 'untrusted extra' });
  const exported = readNetworkWatchlist(serializeNetworkWatchlist(list));
  assert.equal(exported[0].note, '<script>not executable content</script>');
  assert.equal('payload' in exported[0], false);
});
