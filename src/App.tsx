import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import ReceiptInspector from './ReceiptInspector';
import Archive from './Archive';
import ApprovalCheck from './ApprovalCheck';
import Dashboard from './Dashboard';
import WorkspaceIcon from './WorkspaceIcon';
import { DESKS, useWorkspaceNavigation, type WorkspaceView } from './workspace-navigation';
import { useArchive } from './useArchive';
import { KAORI_CONTRACT } from './domain.mjs';
import { useLanguage } from './i18n';
import { CHINESE_DESKS } from './workspace-labels';
import './workspace.css';
import './workspace-tools.css';

const StakingDesk = lazy(() => import('./StakingDesk'));
const NetworkDesk = lazy(() => import('./NetworkDesk'));
const projectContract = KAORI_CONTRACT.trim();
const contractReady = /^0x[0-9a-fA-F]{40}$/.test(projectContract);
const MOTION_KEY = 'kaori-workspace-motion-v1';
function useMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [enabled] = useState(() => { try { return localStorage.getItem(MOTION_KEY) !== 'off'; } catch { return true; } });
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return { enabled: enabled && !reduced };
}
function AboutKaori() {
  const { t } = useLanguage();
  return <section className="workspace-about" id="story" aria-labelledby="about-heading">
    <div className="about-copy"><h2 id="about-heading">{t('The chain keeps the facts.', '区块链记录事实。')}<br /><span>{t('Kaori keeps them readable.', 'Kaori 让记录清晰易懂。')}</span></h2><p>{t('One place for your IMD receipts, spending permissions, official staking and public network activity.', '在一个地方查看 IMD 交易凭证、代币授权、官方质押和公开网络活动。')}</p><p>{t('Kaori is an independent IMD project. Readings show their source and retrieval time. Personal receipts and notes stay in your browser.', 'Kaori 是一个独立的 IMD 项目。查询结果注明来源和获取时间。你的个人凭证和笔记保存在浏览器中。')}</p><div className="about-links"><a href="https://imd.fun/token/" target="_blank" rel="noreferrer">{t('IMD token source', 'IMD 代币信息来源')} <WorkspaceIcon name="external" /></a><a href="https://imd.fun/docs/" target="_blank" rel="noreferrer">{t('IMD network docs', 'IMD 网络文档')} <WorkspaceIcon name="external" /></a></div></div>
    <div className="about-art"><img src="/brand/kaori-scene.png" alt={t('Kaori in a pixel manga city, keeping a paper receipt', 'Kaori 在像素漫画城市里拿着纸质凭证')} width="1536" height="1024" loading="lazy" /><span className="comic-bubble">{t('Keep the thread.', '让故事延续。')}</span></div>
    <div className="about-notes"><article><h3>{t('Read the source.', '查看信息来源。')}</h3><p>{t('Ethereum receipts come from the chain. Public agent, job and oracle records come from the official IMD API.', '以太坊交易凭证来自链上。公开的智能体、任务和预言机记录来自 IMD 官方 API。')}</p></article><article><h3>{t('Keep your notes.', '保存你的笔记。')}</h3><p>{t('Your archive and watchlist belong to this browser. Export the records you want to keep elsewhere.', '存档和关注列表保存在当前浏览器中。你可以导出需要另行保存的记录。')}</p></article><article><h3>{t('Stay in control.', '始终由你掌控。')}</h3><p>{t('Staking uses your wallet and the official vault. Review each transaction in your wallet before confirming.', '质押通过你的钱包和官方金库完成。确认前，请在钱包中核对每笔交易。')}</p></article></div>
  </section>;
}
export default function App() {
  const { language, setLanguage, t } = useLanguage();
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
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); document.getElementById('workspace-title')?.focus(); }}>{t('Skip to current tool', '跳转到当前工具')}</a>
    <aside className="workspace-sidebar">
      <a className="workspace-brand" href="#home" onClick={event => follow(event, 'home')} aria-label={t('Kaori IMD dashboard', 'Kaori IMD 仪表盘')}><span className="workspace-avatar"><img src="/brand/kaori-avatar.png" alt="" width="88" height="88" /></span><span><strong>KAORI <span>IMD</span></strong><small>{t('READ / TRACK / OWN', '读取 / 追踪 / 掌控')}</small></span></a>
      <nav className="workspace-nav" aria-label={t('Workspace navigation', '工作台导航')}>{DESKS.map(desk => <a key={desk.id} href={`#${desk.id}`} onClick={event => follow(event, desk.id)} aria-current={active === desk.id ? 'page' : undefined}><WorkspaceIcon name={desk.icon} /><span>{t(desk.navLabel, CHINESE_DESKS[desk.id as keyof typeof CHINESE_DESKS].navLabel)}</span><span className="nav-active-mark" aria-hidden="true" /></a>)}</nav>
      <div className="workspace-sidebar-bottom"><a href="#story" onClick={event => follow(event, 'story')} aria-current={active === 'story' ? 'page' : undefined}><WorkspaceIcon name="info" />{t('About Kaori', '关于 Kaori')}</a><a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer"><WorkspaceIcon name="x" />{t('Follow on X', '关注 X')}<WorkspaceIcon name="external" /></a><a href="/research/Kaori-IMD-Research.pdf" target="_blank" rel="noopener noreferrer"><WorkspaceIcon name="receipt" />{t('Research PDF', '研究 PDF')}<WorkspaceIcon name="external" /></a><p>{t('KEEP THE CHAIN HUMAN.', '让链上记录更有温度。')}</p></div>
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar">
        <div className="workspace-current"><WorkspaceIcon name={selected?.icon ?? 'info'} /><h1 id="workspace-title" tabIndex={-1}>{selected ? t(selected.title, CHINESE_DESKS[selected.id as keyof typeof CHINESE_DESKS].title) : t('About Kaori', '关于 Kaori')}</h1></div>
        <div className="workspace-controls">
          <span className="workspace-chain"><WorkspaceIcon name="ethereum" /><span>{t('Ethereum', '以太坊')} <span className="chain-mainnet">{t('mainnet', '主网')}</span></span></span>
          <div className="language-switch" role="group" aria-label={t('Language', '语言')}><button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button><button type="button" lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button></div>
          <div className="header-contract">
            <span className="header-contract-label">{t('Kaori CA', 'Kaori 合约')}</span>
            <span id="header-contract-status">{contractReady ? <a href={`https://etherscan.io/token/${projectContract}`} target="_blank" rel="noreferrer" title={projectContract}>{projectContract.slice(0, 6)}…{projectContract.slice(-4)}</a> : <strong>{t('Coming Soon', '即将公布')}</strong>}</span>
            <button type="button" onClick={() => void copyContract()} disabled={!contractReady} aria-label={copied ? t('Contract copied', '合约已复制') : t('Copy Kaori contract', '复制 Kaori 合约')} aria-describedby="header-contract-status" title={contractReady ? t('Copy contract address', '复制合约地址') : t('The contract address has not been announced.', '合约地址尚未公布。')}><WorkspaceIcon name={copied ? 'check' : 'copy'} /></button>
          </div>
        </div>
      </header>
      <main className="workspace-content" id="workspace-main">
        {panel('home', <Dashboard active={active === 'home'} follow={follow} archiveCount={archive.entries.length} />)}
        {panel('receipt', <ReceiptInspector onSave={archive.save} noteFor={hash => archive.entries.find(entry => entry.hash === hash)?.note ?? ''} requestedHash={requestedHash} />)}
        {panel('approvals', <ApprovalCheck />)}
        {panel('staking', <Suspense fallback={<div className="workspace-loading" role="status">{t('Loading the staking desk…', '正在加载质押工作台…')}</div>}><StakingDesk /></Suspense>)}
        {panel('network', <Suspense fallback={<div className="workspace-loading" role="status">{t('Loading the network desk…', '正在加载网络工作台…')}</div>}><NetworkDesk /></Suspense>)}
        {panel('archive', <Archive entries={archive.entries} warning={archive.warning} onRemove={archive.remove} onOpen={openRecord} onRestore={archive.restore} />)}
        {panel('story', <AboutKaori />)}
      </main>
      <footer className="workspace-footer"><span className="workspace-independent"><span className="footer-pixel-flower" aria-hidden="true">✦</span>{t('Independent IMD project', '独立 IMD 项目')}</span><a className="footer-research-link" href="/research/kaori">{t('Research paper', '研究文章')} <WorkspaceIcon name="arrow" /></a><a className="mobile-about-link" href="#story" onClick={event => follow(event, 'story')}>{t('About Kaori', '关于 Kaori')}</a><a className="mobile-x-link" href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer">X <WorkspaceIcon name="external" /></a><div className="workspace-contract"><span id="contract-status">{t('Kaori contract: ', 'Kaori 合约：')}{contractReady ? <a href={`https://etherscan.io/token/${projectContract}`} target="_blank" rel="noreferrer">{projectContract}</a> : <strong>{t('Coming Soon', '即将公布')}</strong>}</span><button onClick={() => void copyContract()} disabled={!contractReady} aria-label={copied ? t('Contract copied', '合约已复制') : t('Copy Kaori contract', '复制 Kaori 合约')} aria-describedby="contract-status" title={contractReady ? t('Copy contract address', '复制合约地址') : t('The contract address has not been announced.', '合约地址尚未公布。')}><WorkspaceIcon name={copied ? 'check' : 'copy'} /></button></div></footer>
    </div>
  </div>;
}
