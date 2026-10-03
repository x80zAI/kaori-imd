import test from 'node:test';
import assert from 'node:assert/strict';
import { readArchive, importNotes, mergeEntry, exportNotes, displayAmount, writeArchive } from '../src/domain.mjs';
const hash = `0x${'a'.repeat(64)}`;
const entry = { hash, note: 'Personal receipt', savedAt: '2026-10-03T09:00:00.000Z', receipt: null };
test('corrupt browser data is flagged without creating a receipt', () => {
  assert.deepEqual(readArchive('{broken'), { entries: [], corrupted: true });
  assert.deepEqual(readArchive(JSON.stringify([{ ...entry, hash: '<script>' }])), { entries: [], corrupted: true });
});
test('notes backup roundtrip preserves the hash and note without trusting imported blockchain snapshots', () => {
  const raw = JSON.parse(exportNotes([entry]));
  raw.records[0].receipt = { status: 'success', transfers: [{ amount: '999' }] };
  const imported = importNotes(JSON.stringify(raw), []);
  assert.equal(imported[0].receipt, null);
  assert.equal(imported[0].hash, hash);
  assert.equal(imported[0].note, entry.note);
});
test('import is atomic and respects capacity', () => {
  const existing = Array.from({ length: 30 }, (_, i) => ({ ...entry, hash: `0x${i.toString(16).padStart(64, '0')}` }));
  assert.throws(() => importNotes(exportNotes([entry]), existing), /exceed/);
  assert.equal(existing.length, 30);
  assert.throws(() => importNotes('{"project":"Kaori IMD","version":1,"records":[null]}', []));
});
test('saving again updates a record rather than duplicating it', () => {
  assert.deepEqual(mergeEntry([entry], { ...entry, hash: hash.toUpperCase().replace('0X', '0x'), note: 'Updated' }).map(item => item.note), ['Updated']);
});
test('readable token amounts retain exact smallest units', () => {
  assert.equal(displayAmount('1748854.651351348125736904'), '1,748,854.651351348125736904');
  assert.equal(displayAmount('0.000000000000000001'), '0.000000000000000001');
});
test('new records cannot overwrite a damaged archive', () => {
  let original = '{damaged';
  const storage = { getItem: () => original, setItem: (_, value) => { original = value; } };
  assert.match(writeArchive(storage, [entry]), /preserved/);
  assert.equal(original, '{damaged');
});
