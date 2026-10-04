import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import ReceiptInspector from './ReceiptInspector';
import Archive from './Archive';
import ApprovalCheck from './ApprovalCheck';
import Dashboard from './Dashboard';
import WorkspaceIcon from './WorkspaceIcon';
import { DESKS, useWorkspaceNavigation, type WorkspaceView } from './workspace-navigation';
import { useArchive } from './useArchive';
import { KAORI_CONTRACT } from './domain.mjs';
import './workspace.css';
import './workspace-tools.css';

const StakingDesk = lazy(() => import('./StakingDesk'));
const NetworkDesk = lazy(() => import('./NetworkDesk'));
const projectContract = KAORI_CONTRACT.trim();
const contractReady = /^0x[0-9a-fA-F]{40}$/.test(projectContract);
const MOTION_KEY = 'kaori-workspace-motion-v1';
function useMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(MOTION_KEY) !== 'off'; } catch { return true; } });
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function toggle() {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(MOTION_KEY, next ? 'on' : 'off'); } catch { /* Applies for this visit when storage is unavailable. */ }
  }
  return { enabled: enabled && !reduced, reduced, toggle };
}
function AboutKaori() {
  return <section className="workspace-about" id="story" aria-labelledby="about-heading">
    <div className="about-copy"><h2 id="about-heading">The chain keeps the facts.<br /><span>Kaori keeps them readable.</span></h2><p>One place for your IMD receipts, spending permissions, official staking and public network activity.</p><p>Kaori is an independent IMD project. Readings show their source and retrieval time. Personal receipts and notes stay in your browser.</p><div className="about-links"><a href="https://imd.fun/token/" target="_blank" rel="noreferrer">IMD token source <WorkspaceIcon name="external" /></a><a href="https://imd.fun/docs/" target="_blank" rel="noreferrer">IMD network docs <WorkspaceIcon name="external" /></a></div></div>
    <div className="about-art"><img src="/brand/kaori-scene.png" alt="Kaori in a pixel manga city, keeping a paper receipt" width="1536" height="1024" loading="lazy" /><span className="comic-bubble">Keep the thread.</span></div>
    <div className="about-notes"><article><h3>Read the source.</h3><p>Ethereum receipts come from the chain. Public agent, job and oracle records come from the official IMD API.</p></article><article><h3>Keep your notes.</h3><p>Your archive and watchlist belong to this browser. Export the records you want to keep elsewhere.</p></article><article><h3>Stay in control.</h3><p>Staking uses your wallet and the official vault. Review each transaction in your wallet before confirming.</p></article></div>
  </section>;
}
export default function App() {
  const { active, visited, navigate, follow } = useWorkspaceNavigation();
  const motion = useMotion();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [requestedHash, setRequestedHash] = useState<{ hash: string; sequence: number } | null>(null);
  const archive = useArchive();
  const selected = DESKS.find(desk => desk.id === active);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  function openRecord(hash: string) { navigate('receipt'); setRequestedHash(previous => ({ hash, sequence: (previous?.sequence ?? 0) + 1 })); }
  async function copyContract() {
    if (!contractReady) return;
    try { await navigator.clipboard.writeText(projectContract); setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  function panel(id: WorkspaceView, content: ReactNode) {
    return visited.has(id) ? <div className="workspace-panel" key={id} data-view={id} hidden={active !== id}>{content}</div> : null;
  }
  return <div className="kaori-workspace" data-motion={motion.enabled ? 'on' : 'off'}>
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); document.getElementById('workspace-title')?.focus(); }}>Skip to current tool</a>
    <aside className="workspace-sidebar">
      <a className="workspace-brand" href="#home" onClick={event => follow(event, 'home')} aria-label="Kaori IMD dashboard"><span className="workspace-avatar"><img src="/brand/kaori-avatar.png" alt="" width="88" height="88" /></span><span><strong>KAORI <span>IMD</span></strong><small>READ / TRACK / OWN</small></span></a>
      <nav className="workspace-nav" aria-label="Workspace navigation">{DESKS.map(desk => <a key={desk.id} href={`#${desk.id}`} onClick={event => follow(event, desk.id)} aria-current={active === desk.id ? 'page' : undefined}><WorkspaceIcon name={desk.icon} /><span>{desk.navLabel}</span><span className="nav-active-mark" aria-hidden="true" /></a>)}</nav>
      <div className="workspace-sidebar-bottom"><a href="#story" onClick={event => follow(event, 'story')} aria-current={active === 'story' ? 'page' : undefined}><WorkspaceIcon name="info" />About Kaori</a><a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer"><WorkspaceIcon name="x" />Follow on X<WorkspaceIcon name="external" /></a><a href="https://github.com/x80zAI/kaori-imd" target="_blank" rel="noreferrer"><WorkspaceIcon name="code" />Source code<WorkspaceIcon name="external" /></a><p>KEEP THE CHAIN HUMAN.</p></div>
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar"><div className="workspace-current"><WorkspaceIcon name={selected?.icon ?? 'info'} /><h1 id="workspace-title" tabIndex={-1}>{selected?.title ?? 'About Kaori'}</h1></div><div className="workspace-controls"><span className="workspace-chain"><WorkspaceIcon name="ethereum" /><span>Ethereum <span className="chain-mainnet">mainnet</span></span></span><button className="motion-toggle" type="button" aria-label={motion.reduced ? 'Animations disabled by your device preference' : motion.enabled ? 'Pause animations' : 'Enable animations'} aria-pressed={motion.enabled} disabled={motion.reduced} onClick={motion.toggle} title={motion.reduced ? 'Your device requests reduced motion.' : undefined}><span>Motion {motion.enabled ? 'on' : 'off'}</span><span className="motion-switch" aria-hidden="true" /></button></div></header>
      <main className="workspace-content" id="workspace-main">
        {panel('home', <Dashboard active={active === 'home'} motionEnabled={motion.enabled} reducedMotion={motion.reduced} onToggleMotion={motion.toggle} follow={follow} archiveCount={archive.entries.length} />)}
        {panel('receipt', <ReceiptInspector onSave={archive.save} noteFor={hash => archive.entries.find(entry => entry.hash === hash)?.note ?? ''} requestedHash={requestedHash} />)}
        {panel('approvals', <ApprovalCheck />)}
        {panel('staking', <Suspense fallback={<div className="workspace-loading" role="status">Loading the staking desk…</div>}><StakingDesk /></Suspense>)}
        {panel('network', <Suspense fallback={<div className="workspace-loading" role="status">Loading the network desk…</div>}><NetworkDesk /></Suspense>)}
        {panel('archive', <Archive entries={archive.entries} warning={archive.warning} onRemove={archive.remove} onOpen={openRecord} onRestore={archive.restore} />)}
        {panel('story', <AboutKaori />)}
      </main>
      <footer className="workspace-footer"><span className="workspace-independent"><span className="footer-pixel-flower" aria-hidden="true">✦</span>Independent IMD project</span><a className="mobile-about-link" href="#story" onClick={event => follow(event, 'story')}>About Kaori</a><a className="mobile-x-link" href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer">X <WorkspaceIcon name="external" /></a><div className="workspace-contract"><span id="contract-status">Kaori contract: {contractReady ? <a href={`https://etherscan.io/token/${projectContract}`} target="_blank" rel="noreferrer">{projectContract}</a> : <strong>Coming Soon</strong>}</span><button onClick={() => void copyContract()} disabled={!contractReady} aria-label={copied ? 'Contract copied' : 'Copy Kaori contract'} aria-describedby="contract-status" title={contractReady ? 'Copy contract address' : 'The contract address has not been announced.'}><WorkspaceIcon name={copied ? 'check' : 'copy'} /></button></div></footer>
    </div>
  </div>;
}
