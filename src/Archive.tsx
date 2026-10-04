import { useRef, useState } from 'react';
import { exportNotes, short } from './domain.mjs';
import { download } from './download';
import type { ArchiveEntry } from './types';
export default function Archive({ entries, warning, onRemove, onOpen, onRestore }: { entries: ArchiveEntry[]; warning: string; onRemove: (hash: string) => void; onOpen: (hash: string) => void; onRestore: (raw: string) => void }) {
  const [query, setQuery] = useState(''); const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = entries.filter(entry => `${entry.hash} ${entry.note}`.toLowerCase().includes(query.toLowerCase()));
  async function restore(file: File | undefined) {
    if (!file) return;
    try { if (file.size > 100000) throw new Error('Choose a notes backup smaller than 100 KB.'); onRestore(await file.text()); setMessage('Notes restored. Open a record to read its current Ethereum data.'); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : 'The notes could not be restored.'); }
    if (fileRef.current) fileRef.current.value = '';
  }
  return <section className="archive-section" id="archive" aria-labelledby="archive-heading"><div className="container">
    <div className="archive-head"><div><p className="eyebrow"><span className="section-index">06</span> YOUR PAPER TRAIL</p><h2 className="section-title" id="archive-heading">Keep the chapters<br />that matter.</h2></div><div className="archive-tools"><span className="chapter-tag">{entries.length} / 30 RECORDS</span><button className="button dark small" disabled={!entries.length} onClick={() => download(exportNotes(entries), 'kaori-imd-notes.json')}>Export notes ↗</button><button className="button secondary small" onClick={() => fileRef.current?.click()}>Restore notes</button><input ref={fileRef} hidden type="file" accept="application/json,.json" aria-label="Restore Kaori IMD notes backup" onChange={event => void restore(event.target.files?.[0])} /></div></div>
    <p className="section-copy">Your archive lives in this browser. Keep a notes backup if you want to move it to another device. Saved readings retain their original timestamp; open a record to refresh it.</p>
    {warning && <p className="archive-warning" role="alert">{warning}</p>}{message && <p className="status-message" role="status">{message}</p>}
    {entries.length > 0 && <label className="field-label">Find a record<input className="archive-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes or transaction hashes" /></label>}
    {entries.length === 0 ? <div className="archive-empty"><span className="story-drawing" aria-hidden="true">▤</span><div><h3>A blank page. Yours to fill.</h3><p>Read an IMD receipt, add a note, and save your first record.</p></div><a className="button dark" href="#receipt">Go to the receipt desk ↗</a></div> : <div className="archive-list">{shown.map(entry => <article className="archive-card" key={entry.hash}><div className="archive-card-top"><span className="chapter-tag">{entry.receipt ? 'SAVED READING' : 'RESTORED NOTE'}</span><h3 title={entry.hash}>{short(entry.hash, 10)}</h3></div><p className="archive-note">{entry.note || 'No personal note added.'}</p><p className="archive-meta">Saved {new Date(entry.savedAt).toLocaleDateString('en-GB')}{entry.receipt ? ` · Read at block ${entry.receipt.snapshotBlockNumber}` : ' · Open to retrieve Ethereum data'}</p><div className="archive-card-actions"><button className="button dark small" onClick={() => onOpen(entry.hash)}>Open & refresh ↗</button><a className="source-link" href={`https://etherscan.io/tx/${entry.hash}`} target="_blank" rel="noreferrer">Etherscan ↗</a><button className="source-link" onClick={() => onRemove(entry.hash)} aria-label={`Remove saved record ${short(entry.hash)}`}>Remove</button></div></article>)}{shown.length === 0 && <p className="input-help">No saved records match your search.</p>}</div>}
  </div></section>;
}
