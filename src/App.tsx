import { useEffect, useState } from 'react';
import ReceiptInspector from './ReceiptInspector';
import Archive from './Archive';
import { useArchive } from './useArchive';
import { KAORI_CONTRACT } from './domain.mjs';

const projectContract = KAORI_CONTRACT.trim();
const contractReady = /^0x[0-9a-fA-F]{40}$/.test(projectContract);

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [requestedHash, setRequestedHash] = useState<{ hash: string; sequence: number } | null>(null);
  const archive = useArchive();
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setMenuOpen(false); }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  function openRecord(hash: string) { setRequestedHash(previous => ({ hash, sequence: (previous?.sequence ?? 0) + 1 })); document.getElementById('receipt')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  async function copyContract() {
    if (!contractReady) { setCopied(false); return; }
    try { await navigator.clipboard.writeText(projectContract); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); }
  }
  return <>
    <a className="skip-link" href="#receipt">Skip to receipt desk</a>
    <header className="site-header"><a href="#home" className="brand" aria-label="Kaori IMD home"><img className="brand-avatar" src="/brand/kaori-avatar.png" width="48" height="48" alt="" /><span className="brand-wordmark">KAORI <span>IMD</span></span></a><nav className="nav-links" aria-label="Main navigation"><a href="#receipt">Receipt desk</a><a href="#story">The story</a><a href="#archive">My archive</a><a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer" aria-label="Kaori IMD on X">X ↗</a></nav><a href="#receipt" className="button dark small header-cta">Read a receipt <span aria-hidden="true">↗</span></a><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}>{menuOpen ? '×' : '☰'}</button>{menuOpen && <nav id="mobile-nav" className="mobile-menu" aria-label="Mobile navigation">{[['#receipt', 'Receipt desk'], ['#story', 'The story'], ['#archive', 'My archive']].map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label} ↗</a>)}<a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer" aria-label="Kaori IMD on X" onClick={() => setMenuOpen(false)}>X ↗</a></nav>}</header>
    <main id="home"><section className="hero container" aria-labelledby="hero-heading"><div className="hero-copy"><p className="eyebrow"><span className="pixel-dot" /> AN IMD STORY, WRITTEN ON ETHEREUM</p><h1 className="hero-title" id="hero-heading">KAORI<br /><span>IMD<span className="seal" aria-hidden="true">記</span></span></h1><p className="hero-lead">Every transfer<br /><strong>has a story.</strong></p><p className="section-copy">Meet your pixel archivist. Turn an IMD transaction into a record you can read, keep, and come back to.</p><div className="hero-actions"><a className="button primary" href="#receipt">Find your receipt <span aria-hidden="true">↗</span></a><a className="button secondary" href="#story">Meet Kaori <span aria-hidden="true">↓</span></a></div><p className="input-help">REAL ETHEREUM RECORDS. YOUR OWN PAPER TRAIL.</p></div><div className="hero-art"><div className="art-topline"><span>KAORI'S ARCHIVE</span><span>CHAPTER 01 ↙</span></div><img className="scene-image" src="/brand/kaori-scene.png" alt="Pixel manga archivist Kaori holding a paper receipt in an ink-blue and cherry-red city alley" width="1536" height="1024" fetchPriority="high" /><div className="art-caption"><span>A small record.<br />A lasting memory.</span><span className="chapter-tag">ETHEREUM<br />MAINNET</span></div><div className="floating-receipt" aria-hidden="true"><span>▤</span><span>FROM THE CHAIN.<br />TO YOUR ARCHIVE.</span></div></div></section>
      <div className="ticker" aria-label="IMD receipts, exact amounts, personal notes, Ethereum mainnet"><div className="ticker-track" aria-hidden="true">IMD RECEIPTS <span>✦</span> EXACT AMOUNTS <span>✦</span> PERSONAL NOTES <span>✦</span> ETHEREUM MAINNET <span>✦</span> IMD RECEIPTS <span>✦</span> EXACT AMOUNTS <span>✦</span> PERSONAL NOTES <span>✦</span></div></div>
      <ReceiptInspector onSave={archive.save} noteFor={hash => archive.entries.find(entry => entry.hash === hash)?.note ?? ''} requestedHash={requestedHash} />
      <section className="story-section" id="story" aria-labelledby="story-heading"><div className="container"><div className="story-heading"><div><p className="eyebrow"><span className="section-index">02</span> MEET YOUR ARCHIVIST</p><h2 className="section-title" id="story-heading">The chain keeps the facts.<br /><span>Kaori keeps them readable.</span></h2></div><p className="section-copy">A pixel character with a practical job: help you follow the details of your IMD transfers without losing the thread.</p></div><div className="story-strip">{[
        ['01', '↗', 'Follow the hash.', 'A transaction hash leads to the original Ethereum record. Kaori reads its receipt and checks for the official IMD transfer events.'],
        ['02', '▤', 'Read every detail.', 'See exact IMD amounts, transfer addresses, block time and execution gas fee. Each reading shows when it was retrieved.'],
        ['03', '＋', 'Keep your chapter.', 'Add a personal note, save the receipt in your browser, and export a readable record or a notes backup.']
      ].map(([number, symbol, title, text]) => <article className="story-panel" key={number}><span className="story-number">{number}</span><span className="story-drawing" aria-hidden="true">{symbol}</span><div className="story-text"><h3>{title}</h3><p>{text}</p></div></article>)}</div></div></section>
      <Archive entries={archive.entries} warning={archive.warning} onRemove={archive.remove} onOpen={openRecord} onRestore={archive.restore} />
      <section className="source-strip"><div className="container"><div><p className="eyebrow">KAORI IMD CONTRACT</p><p className="source-contract" id="contract-status">{contractReady ? <a href={`https://etherscan.io/token/${projectContract}`} target="_blank" rel="noreferrer">{projectContract}</a> : <strong className="contract-pending">Coming Soon</strong>}</p></div><div className="receipt-actions"><button className="button secondary small contract-copy" onClick={() => void copyContract()} disabled={!contractReady} aria-describedby="contract-status">{copied ? 'Copied ✓' : 'Copy contract'}</button><a className="source-link" href="https://imd.fun/token/" target="_blank" rel="noreferrer">IMD data source ↗</a><a className="source-link" href="https://imd.fun/docs/" target="_blank" rel="noreferrer">IMD network docs ↗</a></div></div></section>
    </main><footer className="site-footer"><div className="footer-brand"><img src="/brand/kaori-avatar.png" width="48" height="48" alt="" loading="lazy" /><div><span className="brand-wordmark">KAORI IMD</span><p>Every transfer has a story.</p></div></div><div className="footer-nav"><a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer">Follow on X ↗</a><a href="https://github.com/x80zAI/kaori-imd" target="_blank" rel="noreferrer">Source code ↗</a><a href="#home">Back to the first page ↑</a><span>Independent IMD project · Ethereum mainnet</span></div></footer>
  </>;
}
