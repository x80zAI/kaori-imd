import { useEffect, useState } from 'react';
import { STORAGE_KEY, readArchive, mergeEntry, importNotes, writeArchive } from './domain.mjs';
import type { ArchiveEntry, Receipt } from './types';
function initial() {
  try {
    const result = readArchive(localStorage.getItem(STORAGE_KEY));
    return { entries: result.entries as ArchiveEntry[], warning: result.corrupted ? 'Saved records could not be read. Your stored data has been kept so you can recover it.' : '' };
  } catch { return { entries: [] as ArchiveEntry[], warning: 'Browser storage is unavailable. Export your notes before closing this page.' }; }
}
export function useArchive() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setState(initial()); };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, []);
  function latest() {
    if (state.warning) return state.entries;
    try { const current = readArchive(localStorage.getItem(STORAGE_KEY)); return current.corrupted ? state.entries : current.entries as ArchiveEntry[]; } catch { return state.entries; }
  }
  function persist(entries: ArchiveEntry[]) {
    let warning = '';
    try { warning = writeArchive(localStorage, entries); }
    catch { warning = 'These records are kept for this visit only. Export your notes before closing the page.'; }
    setState({ entries, warning });
  }
  function save(receipt: Receipt, note: string) {
    persist(mergeEntry(latest(), { hash: receipt.hash, receipt, note: note.trim(), savedAt: new Date().toISOString() }));
  }
  return { ...state, save, remove: (hash: string) => persist(latest().filter(entry => entry.hash !== hash)), restore: (raw: string) => persist(importNotes(raw, latest())) };
}
