export const NETWORK_WATCHLIST_KEY = 'kaori-imd-network-watchlist-v1';
export const NETWORK_WATCHLIST_LIMIT = 30;
const KINDS = new Set(['agent', 'job', 'oracle']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEAT = /^(0|[1-9][0-9]{0,77})$/;

export function watchlistKey(kind, id) { return `${kind}:${String(id).toLowerCase()}`; }

function entry(value) {
  if (!value || typeof value !== 'object' || !KINDS.has(value.kind) || typeof value.id !== 'string' || !(value.kind === 'agent' ? SEAT : UUID).test(value.id)
    || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 180
    || typeof value.note !== 'string' || value.note.length > 500
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error('This saved network item could not be read.');
  }
  return { kind: value.kind, id: value.id.toLowerCase(), label: value.label.trim(), note: value.note, savedAt: value.savedAt };
}

export function readNetworkWatchlist(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw !== 'string' || raw.length > 100_000) throw new Error('The saved network list could not be read.');
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > NETWORK_WATCHLIST_LIMIT) throw new Error('The saved network list could not be read.');
  const entries = data.entries.map(entry);
  if (new Set(entries.map(item => watchlistKey(item.kind, item.id))).size !== entries.length) throw new Error('The saved network list contains duplicate items.');
  return entries;
}

export function saveNetworkItem(entries, value) {
  const next = entry(value);
  const key = watchlistKey(next.kind, next.id);
  const existing = entries.find(item => watchlistKey(item.kind, item.id) === key);
  if (!existing && entries.length >= NETWORK_WATCHLIST_LIMIT) throw new Error(`Your watchlist holds up to ${NETWORK_WATCHLIST_LIMIT} items. Remove one before saving another.`);
  return [next, ...entries.filter(item => watchlistKey(item.kind, item.id) !== key)];
}

export function serializeNetworkWatchlist(entries) {
  return JSON.stringify({ version: 1, entries: readNetworkWatchlist(JSON.stringify({ version: 1, entries })) });
}
