import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTRACT, HASH, displayAmount, receiptText, short } from './domain.mjs';
import { download } from './download';
import type { Receipt, Recent } from './types';

function Field({ label, value, link }: { label: string; value: string; link?: string }) {
  return <div className="data-field"><span className="data-label">{label}</span>{link ? <a className="data-value address-value" href={link} target="_blank" rel="noreferrer" title={value}>{value}</a> : <span className="data-value">{value}</span>}</div>;
}

export default function ReceiptInspector({ onSave, noteFor, requestedHash }: { onSave: (receipt: Receipt, note: string) => void; noteFor: (hash: string) => string; requestedHash: { hash: string; sequence: number } | null }) {
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get('tx') ?? '');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [recentError, setRecentError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const noteForRef = useRef(noteFor);
  useEffect(() => { noteForRef.current = noteFor; }, [noteFor]);

  const lookup = useCallback(async (value: string) => {
    const normalized = value.trim().toLowerCase();
    requestRef.current?.abort();
    setReceipt(null); setMessage(''); setError('');
    if (!HASH.test(normalized)) { setBusy(false); setError('Enter a complete Ethereum transaction hash: 0x followed by 64 hexadecimal characters.'); return; }
    const controller = new AbortController(); requestRef.current = controller;
    setHash(normalized); setBusy(true); setNote('');
    try {
      const response = await fetch(`/api/receipt?hash=${encodeURIComponent(normalized)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'This transaction could not be read. Please try again.');
      if (controller.signal.aborted) return;
      setReceipt(data); setNote(noteForRef.current(normalized));
      const url = new URL(location.href); url.searchParams.set('tx', normalized); history.replaceState(null, '', url);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Ethereum is unavailable. Please try again.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);

  useEffect(() => {
    const initialHash = new URLSearchParams(location.search).get('tx');
    if (initialHash) void lookup(initialHash);
    return () => requestRef.current?.abort();
  }, [lookup]);
  useEffect(() => { if (requestedHash) void lookup(requestedHash.hash); }, [requestedHash, lookup]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/recent', { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Recent transactions are unavailable.');
      setRecent(data);
    }).catch(failure => { if (!controller.signal.aborted) setRecentError(failure.message); });
    return () => controller.abort();
  }, []);

  const canSave = receipt?.status === 'success' && receipt.transfers.length > 0;
  function save() {
    if (!receipt || !canSave) return;
    try { onSave(receipt, note); setMessage('Receipt saved to your personal archive.'); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : 'This record could not be saved.'); }
  }
  return <section className="console-section" id="receipt" aria-labelledby="receipt-heading">
    <div className="container">
      <div className="section-head"><div><p className="eyebrow"><span className="section-index">01</span> THE RECEIPT DESK</p><h2 className="section-title" id="receipt-heading">A hash in.<br /><span>A story out.</span></h2></div><p className="section-copy">Read the record behind an IMD transfer. Exact amounts, actual addresses, and a timestamp from Ethereum.</p></div>
      <div className="inspector-layout"><div className="inspector-main">
        <form className="query-form" onSubmit={event => { event.preventDefault(); void lookup(hash); }}>
          <label className="field-label" htmlFor="transaction-hash">Ethereum transaction hash</label>
          <div className="input-row"><input id="transaction-hash" className="hash-input" value={hash} onChange={event => setHash(event.target.value)} maxLength={66} placeholder="Paste your transaction hash" autoComplete="off" spellCheck={false} /><button className="button primary" type="submit" disabled={busy}>{busy ? 'Reading…' : 'Read receipt'}<span aria-hidden="true">↗</span></button></div>
          <p className="input-help">Ethereum mainnet · Official IMD transfer events · No wallet connection required</p>
        </form>
        {error && <p className="status-message error" role="alert">{error}</p>}
        {busy && <div className="receipt-empty loading" role="status"><span className="story-drawing" aria-hidden="true">▤</span><h3>Following the paper trail…</h3><p>Reading the transaction and its Ethereum receipt.</p></div>}
        {!receipt && !busy && !error && <div className="receipt-empty"><span className="story-drawing" aria-hidden="true">▤</span><h3>Your next record starts here.</h3><p>Paste a transaction hash, or select a recent IMD transaction from the desk.</p><span className="chapter-tag">READY WHEN YOU ARE</span></div>}
        {receipt && <div className="receipt-result" aria-live="polite">
          <div className="receipt-topline"><div><p className="eyebrow">ETHEREUM RECORD</p><h3 className="receipt-title">{receipt.transfers.length ? 'IMD transfer receipt' : 'Ethereum transaction'}</h3></div><span className={`status-badge ${receipt.status}`}>{receipt.status === 'success' ? 'Executed' : receipt.status === 'reverted' ? 'Reverted' : 'Pending'}</span></div>
          {receipt.warning && <p className="status-message">{receipt.warning}</p>}
          <div className="receipt-grid">
            <Field label="Transaction" value={receipt.hash} link={`https://etherscan.io/tx/${receipt.hash}`} />
            <Field label="Block" value={receipt.blockNumber ?? 'Not mined yet'} />
            <Field label="Block time" value={receipt.timestamp ? new Date(receipt.timestamp).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Not mined yet'} />
            <Field label="Confirmations at reading" value={receipt.confirmations ?? 'Not mined yet'} />
            <Field label="Finality" value={receipt.finality === 'finalized' ? 'Finalized on Ethereum' : receipt.finality === 'unfinalized' ? 'Awaiting finality' : 'Not available from provider'} />
            <Field label="Execution gas fee" value={receipt.feeEth ? `${receipt.feeEth} ETH` : 'Not available yet'} />
            <Field label="Transaction sender" value={receipt.from} link={`https://etherscan.io/address/${receipt.from}`} />
            <Field label="Transaction recipient" value={receipt.to ?? 'Contract creation'} link={receipt.to ? `https://etherscan.io/address/${receipt.to}` : undefined} />
          </div>
          {receipt.transfers.length > 0 && <div className="transfer-list"><p className="field-label">IMD transfer events · {receipt.transfers.length}</p>{receipt.transfers.map((transfer, index) => <div className="transfer-row" key={transfer.logIndex}><span className="section-index">{String(index + 1).padStart(2, '0')}</span><div><div className="transfer-amount">{displayAmount(transfer.amount)} <span>IMD</span></div><p className="transfer-path"><a href={`https://etherscan.io/address/${transfer.from}`} target="_blank" rel="noreferrer" title={transfer.from}>{short(transfer.from)}</a><span aria-hidden="true">→</span><a href={`https://etherscan.io/address/${transfer.to}`} target="_blank" rel="noreferrer" title={transfer.to}>{short(transfer.to)}</a></p></div></div>)}</div>}
          <p className="input-help">Read {new Date(receipt.retrievedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC · Snapshot block {receipt.snapshotBlockNumber} · {receipt.provider}</p>
          {canSave && <div className="note-field"><label className="field-label" htmlFor="receipt-note">Your personal note <span>(optional)</span></label><textarea className="note-input" id="receipt-note" value={note} onChange={event => setNote(event.target.value)} maxLength={600} rows={3} placeholder="What would you like to remember about this transfer?" /><p className="input-help">Your note stays in this browser. It is not sent to Ethereum.</p></div>}
          <div className="receipt-actions">{canSave && <button className="button primary" onClick={save}>Save to archive <span aria-hidden="true">＋</span></button>}<button className="button secondary small" onClick={() => download(receiptText(receipt, note), `kaori-${receipt.hash.slice(2, 10)}.txt`, 'text/plain;charset=utf-8')}>Download record</button><button className="button secondary small" onClick={() => download(JSON.stringify({ project: 'Kaori IMD', receipt, personalNote: note }, null, 2), `kaori-${receipt.hash.slice(2, 10)}.json`)}>Export JSON</button><button className="button secondary small" onClick={() => void lookup(receipt.hash)}>Refresh</button></div>
          {message && <p className="status-message success" role="status">{message}</p>}
        </div>}
      </div><aside className="recent-panel" aria-labelledby="recent-heading"><div className="recent-head"><span className="pixel-dot" aria-hidden="true" /><h3 id="recent-heading">Fresh from Ethereum</h3></div><p className="input-help">Recent transactions containing IMD transfers. Select one to read its record.</p>{recentError ? <p className="status-message error">{recentError}</p> : !recent ? <p role="status" className="input-help">Reading recent transactions…</p> : <><div className="recent-list">{recent.transactions.map(transaction => <button className="recent-item" key={transaction.hash} disabled={busy} onClick={() => void lookup(transaction.hash)}><span className="recent-hash">{short(transaction.hash, 8)} <span aria-hidden="true">↗</span></span><span className="recent-meta">Block {transaction.blockNumber} · {transaction.transferCount} IMD event{transaction.transferCount === 1 ? '' : 's'}</span></button>)}</div>{recent.transactions.length === 0 && <p className="input-help">No IMD transfers were found in this block window.</p>}<p className="input-help">Blocks {recent.fromBlock}–{recent.blockNumber}<br />Read {new Date(recent.retrievedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC</p></>}<a className="source-link" href={`https://etherscan.io/token/${CONTRACT}`} target="_blank" rel="noreferrer">Open IMD on Etherscan ↗</a></aside></div>
    </div>
  </section>;
}
