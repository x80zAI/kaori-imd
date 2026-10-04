import { useEffect, useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
import { CONTRACT, displayAmount } from './domain.mjs';
import { ADDRESS, ZERO_ADDRESS, parseApprovalReading } from './approval.mjs';
import type { ApprovalReading } from './types';

function ReadingField({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="data-field"><span className="data-label">{label}</span>{href ? <a className="data-value" href={href} target="_blank" rel="noreferrer">{value} ↗</a> : <span className="data-value">{value}</span>}</div>;
}

export default function ApprovalCheck() {
  const [owner, setOwner] = useState('');
  const [spender, setSpender] = useState('');
  const [reading, setReading] = useState<ApprovalReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  function changeAddress(kind: 'owner' | 'spender', value: string) {
    requestRef.current?.abort();
    setBusy(false); setReading(null); setError('');
    if (kind === 'owner') setOwner(value); else setSpender(value);
  }

  async function checkApproval() {
    requestRef.current?.abort();
    setReading(null); setError('');
    const wallet = owner.trim().toLowerCase();
    const application = spender.trim().toLowerCase();
    if (!ADDRESS.test(wallet) || wallet === ZERO_ADDRESS) { setBusy(false); setError('Enter your complete Ethereum wallet address: 0x followed by 40 hexadecimal characters.'); return; }
    if (!ADDRESS.test(application) || application === ZERO_ADDRESS) { setBusy(false); setError('Enter the complete Ethereum address of the application you want to check.'); return; }
    const controller = new AbortController(); requestRef.current = controller;
    setOwner(wallet); setSpender(application); setBusy(true);
    try {
      const response = await fetch(`/api/allowance?owner=${encodeURIComponent(wallet)}&spender=${encodeURIComponent(application)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The IMD approval could not be read. Please try again.');
      const verified = parseApprovalReading(data, wallet, application);
      if (!controller.signal.aborted) setReading(verified);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Ethereum is unavailable. Please try again.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  const state = reading ? reading.allowanceRaw === '0' ? 'none' : reading.unlimited ? 'maximum' : 'limited' : null;
  return <section className="approval-section" id="approvals" aria-labelledby="approval-heading"><div className="container">
    <ToolHeading id="approval-heading" title="Approval check" subtitle="See how much IMD an application can spend from your wallet." bubble="Check the permission!" />
    <div className="approval-layout">
      <div className="approval-workspace">
        <form className="approval-form" onSubmit={event => { event.preventDefault(); void checkApproval(); }} noValidate aria-busy={busy}>
          <div><label className="field-label" htmlFor="approval-owner">Your wallet address</label><input className="approval-input" id="approval-owner" value={owner} onChange={event => changeAddress('owner', event.target.value)} placeholder="Paste your Ethereum wallet address" maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby="approval-owner-help" /><p className="input-help" id="approval-owner-help">The wallet that holds your IMD. No wallet connection is needed.</p></div>
          <div><label className="field-label" htmlFor="approval-spender">Application address</label><input className="approval-input" id="approval-spender" value={spender} onChange={event => changeAddress('spender', event.target.value)} placeholder="Paste the application's spending address" maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby="approval-spender-help" /><p className="input-help" id="approval-spender-help">Use the spender address shown in your wallet's approval details or the application's official documentation.</p></div>
          <button className="button dark" type="submit" disabled={busy}>{busy ? 'Reading Ethereum…' : 'Check approval ↗'}</button>
          {error && <p className="status-message error" role="alert">{error}</p>}
          {busy && <p className="input-help" role="status">Reading this wallet and application pair from Ethereum.</p>}
        </form>
        {reading ? <div className={`approval-result approval-${state}`} role="status" aria-live="polite">
          <div className="approval-result-head"><span className="eyebrow">IMD · ETHEREUM MAINNET</span><h3>{state === 'none' ? 'No spending allowance' : state === 'maximum' ? 'Maximum approval' : 'Spending allowance'}</h3><p>{state === 'none' ? 'This application address has no IMD spending allowance from this wallet at the recorded block.' : state === 'maximum' ? 'This address has the maximum possible IMD approval from this wallet.' : 'This is the remaining IMD amount this application address is allowed to spend from this wallet.'}</p></div>
          <div className="approval-amount"><span className="data-label">Exact allowance</span><p><strong>{displayAmount(reading.allowance)}</strong> <span>IMD</span></p></div>
          <div className="receipt-grid"><ReadingField label="Wallet checked" value={reading.owner} href={`https://etherscan.io/address/${reading.owner}`} /><ReadingField label="Application checked" value={reading.spender} href={`https://etherscan.io/address/${reading.spender}`} /><ReadingField label="Snapshot block" value={reading.snapshotBlockNumber} href={`https://etherscan.io/block/${reading.snapshotBlockNumber}`} /><ReadingField label="Read at (UTC)" value={new Date(reading.retrievedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' })} /></div>
          <div className="approval-result-footer"><p className="input-help">This permission is separate from your IMD balance. This reading covers only the two addresses you entered and can change after this block.</p><div className="receipt-actions"><button className="button secondary small" disabled={busy} onClick={() => void checkApproval()}>Refresh reading ↻</button><a className="source-link" href={`https://etherscan.io/address/${CONTRACT}#readContract`} target="_blank" rel="noreferrer">IMD contract source ↗</a></div><p className="input-help">Ethereum source: {reading.provider}</p></div>
        </div> : !busy && !error && <div className="approval-empty"><span className="approval-seal" aria-hidden="true">✓</span><div><h3>Know the permission.</h3><p>Enter both addresses to read their current IMD spending allowance.</p></div></div>}
      </div>
      <aside className="approval-guide" aria-labelledby="approval-guide-heading"><p className="eyebrow">BEFORE YOU CHECK</p><h3 id="approval-guide-heading">Your wallet.<br />Their permission.</h3><p>Using an application can involve giving its address permission to spend your tokens. Kaori reads the remaining IMD permission for the address you choose.</p><ul><li><strong>Zero</strong> means no allowance for this pair.</li><li><strong>A set amount</strong> is the remaining spending limit.</li><li><strong>Maximum approval</strong> is the highest possible token allowance.</li></ul><p className="approval-guide-note">A spending allowance does not tell you whether an application is trustworthy. Kaori only reads the permission; it does not change it.</p></aside>
    </div>
  </div></section>;
}
