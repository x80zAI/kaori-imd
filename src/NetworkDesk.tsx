import { useEffect, useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
import type { FormEvent } from 'react';
import { download } from './download';
import { useLanguage } from './i18n';
import { NETWORK_WATCHLIST_KEY, NETWORK_WATCHLIST_LIMIT, readNetworkWatchlist, saveNetworkItem, serializeNetworkWatchlist, watchlistKey } from './network-watchlist.mjs';
import type { NetworkJob, NetworkJobDetail, NetworkOracle, NetworkOracleDetail, NetworkOverview, NetworkEnvelope, NetworkPage } from './network-types';
import './network-desk.css';

type Kind = 'agent' | 'job' | 'oracle';
type Tab = 'agents' | 'jobs' | 'oracles' | 'saved';
type Selected = { kind: Kind; id: string };
type SavedItem = Selected & { label: string; note: string; savedAt: string };
type Reading = NetworkEnvelope<string, NetworkOverview | NetworkPage<NetworkJob> | NetworkPage<NetworkOracle> | NetworkJobDetail | NetworkOracleDetail>;
type Resource = { key: string | null; reading: Reading | null; busy: boolean; error: string };
const SOURCE_HOSTS = new Set(['api.imd.fun', 'explorer.imd.fun']);
const STALE_AFTER = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (value: string, length = 18) => value.length > length ? `${value.slice(0, length)}…` : value;
const date = (value: string, locale: string) => new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' });
type Translate = (english: string, chinese: string) => string;
const messages: Record<string, string> = {
  'The network returned an incomplete reading. Please try refreshing.': '网络返回的数据不完整，请尝试刷新。',
  'The public network is unavailable. Please try again.': '公共网络暂时无法访问，请重试。',
  'The returned record does not match the item you selected. Please refresh.': '返回的记录与所选项目不符，请刷新。',
  'The network took too long to respond. Please try refreshing.': '网络响应超时，请尝试刷新。',
  'Saved items could not be read. Existing browser data has been kept. New saves stay in this visit; export them before closing.': '无法读取已保存的项目。现有浏览器数据已保留。新保存的内容仅在本次访问期间保留，请在关闭前导出。',
  'These saves are kept for this visit only. Export your watchlist before closing the page.': '这些内容仅在本次访问期间保留，请在关闭页面前导出关注列表。',
  'This item could not be saved.': '无法保存此项目。',
  'Saved note updated.': '已更新保存的笔记。',
  'Added to your browser watchlist.': '已添加至本浏览器的关注列表。',
  'Removed from your watchlist.': '已从关注列表移除。',
  'This saved network item could not be read.': '无法读取此已保存的网络项目。',
  'The saved network list could not be read.': '无法读取已保存的网络列表。',
  'The saved network list contains duplicate items.': '已保存的网络列表中存在重复项目。',
  [`Your watchlist holds up to ${NETWORK_WATCHLIST_LIMIT} items. Remove one before saving another.`]: `关注列表最多可保存 ${NETWORK_WATCHLIST_LIMIT} 个项目，请先移除一个项目后再保存。`,
  'IMD network data is unavailable right now. Please try again shortly.': '暂时无法获取 IMD 网络数据，请稍后重试。',
  'Choose a valid network view and its supported search parameters.': '请选择有效的网络视图及其支持的搜索条件。',
  'This public IMD record is unavailable or could not be found.': '此 IMD 公开记录暂不可用或未找到。',
  'Too many network readings are in progress. Please try again shortly.': '当前读取网络的请求过多，请稍后重试。',
  'Use GET to read public IMD network data.': '请使用 GET 读取 IMD 公开网络数据。',
  'This data endpoint does not exist.': '此数据接口不存在。',
  'Failed to fetch': '网络连接失败，请重试。',
};
const message = (value: string, t: Translate) => t(value, messages[value] ?? value);
const kindLabel = (kind: Kind, t: Translate) => kind === 'agent' ? t('agent', '智能体') : kind === 'job' ? t('job', '任务') : t('oracle', '预言机');
const stamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown) => value === null || text(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function safeSource(value: unknown): string | null {
  try {
    if (!text(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && SOURCE_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
function validAgent(value: unknown) {
  return record(value) && text(value.tokenId) && /^\d+$/.test(value.tokenId) && nullableText(value.agentId) && nullableText(value.owner) && typeof value.working === 'boolean'
    && ['queued', 'attempts', 'accepted', 'rejected', 'failed', 'pending'].every(key => count(value[key])) && (value.lastWorkedAt === null || stamp(value.lastWorkedAt)) && !!safeSource(value.sourceUrl);
}
function validJob(value: unknown) {
  return record(value) && text(value.id) && UUID.test(value.id) && text(value.state) && text(value.template) && text(value.objective) && nullableText(value.blockedReason) && stamp(value.createdAt) && stamp(value.updatedAt) && !!safeSource(value.sourceUrl);
}
function validOracle(value: unknown) {
  return record(value) && text(value.id) && UUID.test(value.id) && text(value.status) && text(value.question) && count(value.chainId) && text(value.answerType) && (value.jobId === null || text(value.jobId) && UUID.test(value.jobId))
    && stamp(value.createdAt) && stamp(value.updatedAt) && (value.attestedAt === null || stamp(value.attestedAt)) && !!safeSource(value.sourceUrl);
}
function parseReading(value: unknown, expectedView: string): Reading {
  const fail = () => { throw new Error('The network returned an incomplete reading. Please try refreshing.'); };
  if (!record(value) || value.view !== expectedView || !stamp(value.retrievedAt) || !safeSource(value.sourceUrl) || !record(value.data)) return fail();
  const data = value.data;
  if (expectedView === 'overview') {
    const metricNames = ['agentsOnline', 'workingNow', 'seatsEnrolled', 'acceptedLastDay', 'jobsDoneLastDay', 'oraclesDoneLastDay', 'jobs', 'tasksInProgress', 'launchesLive', 'sites', 'inferenceTokens'];
    if (!stamp(data.observedAt) || typeof data.reachable !== 'boolean' || !record(data.metrics) || !metricNames.every(key => count((data.metrics as Record<string, unknown>)[key])) || !Array.isArray(data.agents) || !data.agents.every(validAgent)
      || !Array.isArray(data.events) || !data.events.every(event => record(event) && text(event.kind) && stamp(event.at) && text(event.title) && nullableText(event.state) && (event.sourceUrl === null || !!safeSource(event.sourceUrl)))) return fail();
  } else if (expectedView === 'jobs' || expectedView === 'oracles') {
    if (!Array.isArray(data.items) || data.items.length > 20 || !data.items.every(expectedView === 'jobs' ? validJob : validOracle) || !count(data.count) || (data.nextBefore !== null && !stamp(data.nextBefore))) return fail();
  } else if (expectedView === 'job') {
    if (!validJob(data) || !nullableText(data.resultText) || !Array.isArray(data.nodes) || !data.nodes.every(node => record(node) && text(node.key) && text(node.role) && text(node.state) && count(node.attempt) && nullableText(node.tokenId) && nullableText(node.verdict))) return fail();
  } else if (expectedView === 'oracle') {
    if (!validOracle(data) || !['evidence', 'resultText', 'failure', 'signer', 'fromBlock', 'toBlock'].every(key => nullableText(data[key])) || !['panelSize', 'quorum', 'agreed'].every(key => data[key] === null || count(data[key]))
      || typeof data.signaturePresent !== 'boolean' || ![null, 'computed', 'agreement'].includes(data.resultSource as string | null) || (data.expiresAt !== null && !stamp(data.expiresAt))) return fail();
  } else return fail();
  return value as Reading;
}

function useNetworkReading(key: string | null, refresh: number): Resource {
  const [state, setState] = useState<Resource>({ key: null, reading: null, busy: false, error: '' });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 18_000);
    setState(previous => ({ key, reading: previous.key === key ? previous.reading : null, busy: true, error: '' }));
    async function read() {
      try {
        const response = await fetch(`/api/network?${key}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(record(data) && text(data.error) ? data.error.slice(0, 400) : 'The public network is unavailable. Please try again.');
        const params = new URLSearchParams(key!);
        const verified = parseReading(data, params.get('view') ?? '');
        if ((verified.view === 'job' || verified.view === 'oracle') && (verified.data as NetworkJobDetail | NetworkOracleDetail).id.toLowerCase() !== params.get('id')?.toLowerCase()) throw new Error('The returned record does not match the item you selected. Please refresh.');
        if (!controller.signal.aborted) setState({ key, reading: verified, busy: false, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted || timedOut) setState(previous => ({ key, reading: previous.key === key ? previous.reading : null, busy: false, error: timedOut ? 'The network took too long to respond. Please try refreshing.' : failure instanceof Error ? failure.message : 'The public network is unavailable. Please try again.' }));
      } finally { clearTimeout(timeout); }
    }
    void read();
    return () => { clearTimeout(timeout); timedOut = false; controller.abort(); };
  }, [key, refresh]);
  return state.key === key ? state : { key, reading: null, busy: !!key, error: '' };
}

function initialWatchlist(): { entries: SavedItem[]; warning: string; writable: boolean } {
  try { return { entries: readNetworkWatchlist(localStorage.getItem(NETWORK_WATCHLIST_KEY)), warning: '', writable: true }; }
  catch { return { entries: [], warning: 'Saved items could not be read. Existing browser data has been kept. New saves stay in this visit; export them before closing.', writable: false }; }
}
function Source({ url, children }: { url: string; children?: React.ReactNode }) {
  const { t } = useLanguage();
  const safe = safeSource(url);
  return safe ? <a className="source-link" href={safe} target="_blank" rel="noopener noreferrer">{children ?? t('Open source ↗', '查看来源 ↗')}</a> : null;
}
function ReadingStatus({ resource }: { resource: Resource }) {
  const { t, locale } = useLanguage();
  const retrievedAt = resource.reading?.retrievedAt;
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!retrievedAt) return;
    const delay = Math.max(0, Date.parse(retrievedAt) + STALE_AFTER - Date.now());
    const timer = setTimeout(() => setClock(Date.now()), delay + 50);
    return () => clearTimeout(timer);
  }, [retrievedAt]);
  const stale = !!retrievedAt && Math.max(clock, Date.now()) - Date.parse(retrievedAt) >= STALE_AFTER;
  return <div className="network-reading-status">
    {resource.busy && <p role="status">{resource.reading ? t('Refreshing this reading…', '正在刷新数据…') : t('Reading the IMD network…', '正在读取 IMD 网络…')}</p>}
    {resource.error && <p className="network-error" role="alert">{message(resource.error, t)} {resource.reading ? t('The last successful reading remains below.', '下方保留了上次成功读取的数据。') : ''}</p>}
    {resource.reading && <p>{stale || resource.error ? <strong>{t('Earlier snapshot · ', '此前的数据快照 · ')}</strong> : null}{t('Read', '读取时间')} {date(resource.reading.retrievedAt, locale)} UTC · <Source url={resource.reading.sourceUrl}>{t('Official source ↗', '官方来源 ↗')}</Source>{stale ? t(' · Refresh for a newer reading.', ' · 刷新以获取更新的数据。') : ''}</p>}
  </div>;
}
function StateBadge({ state }: { state: string }) {
  const { t } = useLanguage();
  const states: Record<string, string> = { working: '工作中', 'not working': '未在工作', queued: '排队中', pending: '待处理', running: '运行中', in_progress: '进行中', accepted: '已接受', rejected: '已拒绝', failed: '失败', completed: '已完成', complete: '已完成', done: '已完成', blocked: '受阻', cancelled: '已取消', canceled: '已取消', attested: '已签证', expired: '已过期', created: '已创建', processing: '处理中', waiting: '等待中', ready: '已就绪', submitted: '已提交' };
  return <span className="network-state" title={state}>{t(state.replaceAll('_', ' '), states[state.toLowerCase()] ?? state.replaceAll('_', ' '))}</span>;
}
function Field({ label, value }: { label: string; value: string | number | null }) { const { t } = useLanguage(); return <div><dt>{label}</dt><dd>{value === null ? t('Not reported', '未提供') : value}</dd></div>; }

export default function NetworkDesk() {
  const { t, locale } = useLanguage();
  const integer = new Intl.NumberFormat(locale);
  const [tab, setTab] = useState<Tab>('agents');
  const [refresh, setRefresh] = useState(0);
  const [agentQuery, setAgentQuery] = useState('');
  const [workingOnly, setWorkingOnly] = useState(false);
  const [agentPage, setAgentPage] = useState(0);
  const [jobInput, setJobInput] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [oracleInput, setOracleInput] = useState('');
  const [oracleQuery, setOracleQuery] = useState('');
  const [jobPages, setJobPages] = useState<(string | null)[]>([null]);
  const [oraclePages, setOraclePages] = useState<(string | null)[]>([null]);
  const [jobPage, setJobPage] = useState(0);
  const [oraclePage, setOraclePage] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saved, setSaved] = useState(initialWatchlist);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const selectedKey = selected ? watchlistKey(selected.kind, selected.id) : '';
  const overview = useNetworkReading('view=overview', refresh);
  const listView = tab === 'jobs' ? 'jobs' : tab === 'oracles' ? 'oracles' : null;
  const query = listView === 'jobs' ? jobQuery : oracleQuery;
  const before = listView === 'jobs' ? jobPages[jobPage] : oraclePages[oraclePage];
  const listParams = new URLSearchParams();
  if (listView) { listParams.set('view', listView); if (query) listParams.set('q', query); if (before) listParams.set('before', before); }
  const list = useNetworkReading(listView ? listParams.toString() : null, refresh);
  const detail = useNetworkReading(selected && selected.kind !== 'agent' ? new URLSearchParams({ view: selected.kind, id: selected.id }).toString() : null, refresh);
  const snapshot = overview.reading?.data as NetworkOverview | undefined;
  const page = list.reading?.data as NetworkPage<NetworkJob> | NetworkPage<NetworkOracle> | undefined;
  const selectedAgent = selected?.kind === 'agent' ? snapshot?.agents.find(agent => agent.tokenId === selected.id) : undefined;
  const selectedData = selectedAgent ?? (detail.reading?.data as NetworkJobDetail | NetworkOracleDetail | undefined);
  const selectedReading = selected?.kind === 'agent' ? overview : detail;
  const savedEntry = saved.entries.find(item => watchlistKey(item.kind, item.id) === selectedKey);
  const note = drafts[selectedKey] ?? savedEntry?.note ?? '';
  const filteredAgents = snapshot?.agents.filter(agent => (!workingOnly || agent.working) && `${agent.tokenId} ${agent.agentId ?? ''}`.toLowerCase().includes(agentQuery.trim().toLowerCase())) ?? [];
  const shownAgentPage = Math.min(agentPage, Math.max(0, Math.ceil(filteredAgents.length / 12) - 1));
  const visibleAgents = filteredAgents.slice(shownAgentPage * 12, (shownAgentPage + 1) * 12);

  useEffect(() => {
    if (!selectedKey) return;
    detailHeading.current?.focus({ preventScroll: true });
    detailHeading.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [selectedKey]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === NETWORK_WATCHLIST_KEY || event.key === null) setSaved(initialWatchlist()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function updateWatchlist(change: (items: SavedItem[]) => SavedItem[]) {
    try {
      let entries = saved.entries;
      let writable = saved.writable;
      if (writable) {
        try { entries = readNetworkWatchlist(localStorage.getItem(NETWORK_WATCHLIST_KEY)); }
        catch { writable = false; }
      }
      const next = change(entries);
      if (writable) {
        try { localStorage.setItem(NETWORK_WATCHLIST_KEY, serializeNetworkWatchlist(next)); }
        catch { writable = false; }
      }
      setSaved({ entries: next, writable, warning: writable ? '' : 'These saves are kept for this visit only. Export your watchlist before closing the page.' });
      return true;
    } catch (failure) { setSaveMessage(failure instanceof Error ? failure.message : 'This item could not be saved.'); return false; }
  }
  function choose(next: Selected) { setSelected(next); setSaveMessage(''); }
  function saveSelected() {
    if (!selected || !selectedData) return;
    const label = selected.kind === 'agent' ? `Agent seat ${selected.id}` : selected.kind === 'job' ? (selectedData as NetworkJob).objective : (selectedData as NetworkOracle).question;
    if (updateWatchlist(entries => saveNetworkItem(entries, { ...selected, label: (label || `${selected.kind} ${selected.id}`).slice(0, 180), note, savedAt: new Date().toISOString() }))) setSaveMessage(savedEntry ? 'Saved note updated.' : 'Added to your browser watchlist.');
  }
  function remove(item: Selected) {
    if (updateWatchlist(entries => entries.filter(entry => watchlistKey(entry.kind, entry.id) !== watchlistKey(item.kind, item.id)))) setSaveMessage('Removed from your watchlist.');
  }
  function exportReading() {
    if (!selected || !selectedData || !selectedReading.reading) return;
    download(JSON.stringify({ project: 'Kaori IMD', kind: selected.kind, id: selected.id, retrievedAt: selectedReading.reading.retrievedAt, exportedAt: new Date().toISOString(), sourceUrl: selectedData.sourceUrl, note, reading: selectedData }, null, 2), `kaori-${selected.kind}-${selected.id}.json`);
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (tab === 'jobs') { setJobQuery(jobInput.trim()); setJobPages([null]); setJobPage(0); }
    else { setOracleQuery(oracleInput.trim()); setOraclePages([null]); setOraclePage(0); }
    setRefresh(value => value + 1);
  }
  function olderPage() {
    if (!page?.nextBefore) return;
    if (tab === 'jobs') { setJobPages(previous => [...previous.slice(0, jobPage + 1), page.nextBefore]); setJobPage(value => value + 1); }
    else { setOraclePages(previous => [...previous.slice(0, oraclePage + 1), page.nextBefore]); setOraclePage(value => value + 1); }
  }

  return <section className="network-section" id="network" aria-labelledby="network-heading"><div className="container">
    <ToolHeading id="network-heading" title={t("Network desk", "网络工作台")} subtitle={t("Follow IMD agents, jobs and oracle answers. Keep your own watchlist.", "关注 IMD 智能体、任务和预言机答案，建立自己的关注列表。")} bubble={t("Pick up the signal!", "捕捉网络信号！")} />
    <div className="network-overview"><div className="network-overview-top"><p className="eyebrow"><span className="pixel-dot" /> {t("PUBLIC IMD NETWORK", "IMD 公共网络")}</p><button type="button" className="button secondary small" disabled={overview.busy || list.busy || detail.busy} onClick={() => setRefresh(value => value + 1)}>{t('Refresh readings ↻', '刷新数据 ↻')}</button></div>
      <ReadingStatus resource={overview} />
      {snapshot ? <><div className="network-metrics">{[[t('Agents online', '在线智能体'), snapshot.metrics.agentsOnline], [t('Working now', '正在工作'), snapshot.metrics.workingNow], [t('Jobs completed · 24h', '已完成任务 · 24 小时'), snapshot.metrics.jobsDoneLastDay], [t('Oracles completed · 24h', '已完成预言机请求 · 24 小时'), snapshot.metrics.oraclesDoneLastDay]].map(([label, value]) => <div className="network-metric" key={label}><span>{label}</span><strong>{integer.format(Number(value))}</strong></div>)}</div><p className="network-summary">{t(`${integer.format(snapshot.metrics.seatsEnrolled)} enrolled seats · ${integer.format(snapshot.metrics.jobs)} jobs reported · ${integer.format(snapshot.metrics.tasksInProgress)} tasks in progress`, `${integer.format(snapshot.metrics.seatsEnrolled)} 个已注册席位 · ${integer.format(snapshot.metrics.jobs)} 个已报告任务 · ${integer.format(snapshot.metrics.tasksInProgress)} 个进行中的任务`)}</p><p className="input-help">{t('Network observed', '网络观测时间')} {date(snapshot.observedAt, locale)} UTC. {snapshot.reachable ? t('Source reachable at this reading.', '本次读取时可访问数据来源。') : t('Source reports the network as unreachable.', '数据来源报告网络暂不可达。')} {t('Public activity across IMD, including work from other applications.', '展示整个 IMD 网络的公开活动，包括其他应用的工作。')}</p></> : !overview.busy && !overview.error ? <p className="input-help">{t('Refresh to read the network.', '刷新以读取网络数据。')}</p> : null}
    </div>
    <div className="network-workspace"><div className="network-browser">
      <div className="network-tabs" aria-label={t("Choose network view", "选择网络视图")}>{([['agents', t('Agents', '智能体')], ['jobs', t('Jobs', '任务')], ['oracles', t('Oracles', '预言机')], ['saved', t(`My watchlist (${saved.entries.length})`, `我的关注列表（${saved.entries.length}）`)]] as [Tab, string][]).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      {tab === 'agents' && <div className="network-tab-content"><div className="network-filter"><label htmlFor="network-agent-query">{t('Find an agent or seat', '查找智能体或席位')}</label><input id="network-agent-query" value={agentQuery} onChange={event => { setAgentQuery(event.target.value); setAgentPage(0); }} maxLength={200} placeholder={t("Agent ID or seat number", "智能体 ID 或席位编号")} autoComplete="off" /><label className="network-checkbox"><input type="checkbox" checked={workingOnly} onChange={event => { setWorkingOnly(event.target.checked); setAgentPage(0); }} /> {t("Working only", "仅显示工作中的智能体")}</label></div><p className="input-help">{t(`Searches the ${snapshot ? integer.format(snapshot.agents.length) : 'available'} agents in this snapshot. “Working” means reported task activity; it does not describe connectivity.`, `搜索当前快照中的${snapshot ? ` ${integer.format(snapshot.agents.length)} 个` : '可用'}智能体。“工作中”表示报告了任务活动，不代表网络连接状态。`)}</p>
        <div className="network-list">{visibleAgents.map(agent => <article className="network-row" key={agent.tokenId}><div><div className="network-row-top"><h3>{t("Seat", "席位")} #{agent.tokenId}</h3><StateBadge state={agent.working ? 'Working' : 'Not working'} /></div><p className="network-row-title">{agent.agentId ?? t('Agent ID not reported', '未提供智能体 ID')}</p><p className="input-help">{t(`${integer.format(agent.accepted)} accepted · ${integer.format(agent.queued)} queued`, `已接受 ${integer.format(agent.accepted)} · 排队中 ${integer.format(agent.queued)}`)}</p></div><button className="button secondary small" type="button" onClick={() => choose({ kind: 'agent', id: agent.tokenId })} aria-label={t(`Inspect agent seat ${agent.tokenId}`, `查看智能体席位 ${agent.tokenId}`)}>{t('Inspect ↗', '查看 ↗')}</button></article>)}</div>
        {snapshot && !filteredAgents.length && <p className="network-empty">{t('No agents match these filters in this snapshot.', '当前数据快照中没有符合筛选条件的智能体。')}</p>}{!snapshot && !overview.busy && <p className="network-empty">{t('Agent activity will appear when the network reading is available.', '获取网络数据后，将显示智能体活动。')}</p>}
        {filteredAgents.length > 0 && <div className="network-pagination"><button className="button secondary small" type="button" disabled={shownAgentPage === 0} onClick={() => setAgentPage(shownAgentPage - 1)}>{t('← Previous', '← 上一页')}</button><span>{t(`${shownAgentPage * 12 + 1}–${Math.min((shownAgentPage + 1) * 12, filteredAgents.length)} of ${integer.format(filteredAgents.length)}`, `第 ${shownAgentPage * 12 + 1}–${Math.min((shownAgentPage + 1) * 12, filteredAgents.length)} 项，共 ${integer.format(filteredAgents.length)} 项`)}</span><button className="button secondary small" type="button" disabled={(shownAgentPage + 1) * 12 >= filteredAgents.length} onClick={() => setAgentPage(shownAgentPage + 1)}>{t('Next →', '下一页 →')}</button></div>}
      </div>}
      {(tab === 'jobs' || tab === 'oracles') && <div className="network-tab-content"><form className="network-search" onSubmit={search}><label htmlFor="network-search-query">{tab === 'jobs' ? t('Search public jobs', '搜索公开任务') : t('Search public oracle questions', '搜索公开预言机问题')}</label><div><input id="network-search-query" value={tab === 'jobs' ? jobInput : oracleInput} onChange={event => tab === 'jobs' ? setJobInput(event.target.value) : setOracleInput(event.target.value)} maxLength={200} autoComplete="off" placeholder={tab === 'jobs' ? t('Objective or job ID prefix', '任务目标或任务 ID 前缀') : t('Words from the question', '问题中的关键词')} /><button className="button dark small" type="submit" disabled={list.busy}>{t('Search', '搜索')}</button></div></form><p className="input-help">{t('Newest first, up to 20 public records per page.', '按时间倒序排列，每页最多显示 20 条公开记录。')} {query ? t(`Current search: “${query}”.`, `当前搜索：“${query}”。`) : t('No search filter applied.', '未设置搜索条件。')} {tab === 'jobs' ? t('Search matches job objectives or ID prefixes.', '搜索匹配任务目标或 ID 前缀。') : t('Search matches question text.', '搜索匹配问题文本。')}</p><ReadingStatus resource={list} />
        <div className="network-list">{page?.items.map(item => <article className="network-row" key={item.id}><div><div className="network-row-top"><span className="network-id">{short(item.id)}</span><StateBadge state={'state' in item ? item.state : item.status} /></div><h3 className="network-row-title">{'objective' in item ? item.objective || t('Untitled job', '未命名的任务') : item.question || t('Untitled oracle question', '未命名的预言机问题')}</h3><p className="input-help">{t("Updated", "更新时间")} {date(item.updatedAt, locale)} UTC</p></div><button className="button secondary small" type="button" onClick={() => choose({ kind: tab === 'jobs' ? 'job' : 'oracle', id: item.id })} aria-label={t(`Inspect ${tab === 'jobs' ? 'job' : 'oracle'} ${item.id}`, `查看${tab === 'jobs' ? '任务' : '预言机'} ${item.id}`)}>{t('Inspect ↗', '查看 ↗')}</button></article>)}</div>
        {page && !page.items.length && <p className="network-empty">{t('No public records found for this search and page.', '当前搜索条件及页面下未找到公开记录。')}</p>}
        {page && <div className="network-pagination"><button className="button secondary small" type="button" disabled={list.busy || (tab === 'jobs' ? jobPage : oraclePage) === 0} onClick={() => tab === 'jobs' ? setJobPage(value => value - 1) : setOraclePage(value => value - 1)}>{t('← Newer', '← 更新记录')}</button><span>{t(`Page ${(tab === 'jobs' ? jobPage : oraclePage) + 1} · ${page.items.length} shown`, `第 ${(tab === 'jobs' ? jobPage : oraclePage) + 1} 页 · 显示 ${page.items.length} 条`)}</span><button className="button secondary small" type="button" disabled={list.busy || !page.nextBefore} onClick={olderPage}>{t('Older →', '更早记录 →')}</button></div>}
      </div>}
      {tab === 'saved' && <div className="network-tab-content"><div className="network-saved-head"><div><h3>{t('Your next chapter.', '你的下一篇章。')}</h3><p className="input-help">{t(`Up to ${NETWORK_WATCHLIST_LIMIT} items, saved in this browser. Opening an item reads it again from IMD.`, `最多可在本浏览器中保存 ${NETWORK_WATCHLIST_LIMIT} 个项目。打开项目时，会重新从 IMD 获取数据。`)}</p></div><button type="button" className="button secondary small" disabled={!saved.entries.length} onClick={() => download(JSON.stringify({ project: 'Kaori IMD', exportedAt: new Date().toISOString(), ...JSON.parse(serializeNetworkWatchlist(saved.entries)) }, null, 2), 'kaori-network-watchlist.json')}>{t('Export watchlist ↓', '导出关注列表 ↓')}</button></div>{saved.warning && <p className="network-error" role="status">{message(saved.warning, t)}</p>}
        {!saved.entries.length && <div className="network-empty"><span aria-hidden="true">▤</span><h3>{t('A place for what catches your eye.', '把值得关注的内容留在这里。')}</h3><p>{t('Inspect an agent, job or oracle and save it here with your own note.', '查看智能体、任务或预言机，然后添加笔记并保存在这里。')}</p></div>}
        <div className="network-list">{saved.entries.map(item => <article className="network-row" key={watchlistKey(item.kind, item.id)}><div><p className="eyebrow">{kindLabel(item.kind, t)} · {short(item.id)}</p><h3 className="network-row-title">{item.kind === 'agent' && item.label === `Agent seat ${item.id}` ? t(item.label, `智能体席位 ${item.id}`) : item.label}</h3>{item.note && <p className="network-note">{item.note}</p>}<p className="input-help">{t("Saved", "保存时间")} {date(item.savedAt, locale)} UTC</p></div><div className="network-row-actions"><button type="button" className="button secondary small" onClick={() => { choose(item); setRefresh(value => value + 1); }}>{t('Open ↗', '打开 ↗')}</button><button type="button" className="network-remove" aria-label={t(`Remove ${item.label}`, `移除 ${item.label}`)} onClick={() => remove(item)}>{t('Remove', '移除')}</button></div></article>)}</div>
      </div>}
    </div>
    <aside className="network-detail" aria-labelledby="network-detail-heading"><div className="network-detail-top"><p className="eyebrow">{t('KAORI’S FIELD NOTES', 'KAORI 的观察笔记')}</p>{selected && <button type="button" className="network-close" aria-label={t("Close network detail", "关闭网络详情")} onClick={() => setSelected(null)}>×</button>}</div><h3 id="network-detail-heading" ref={detailHeading} tabIndex={-1}>{selected ? selected.kind === 'agent' ? t(`Agent seat #${selected.id}`, `智能体席位 #${selected.id}`) : selected.kind === 'job' ? t('Inside the job.', '任务详情。') : t('Inside the oracle.', '预言机详情。') : t('Pick a thread.', '选择一条线索。')}</h3>
      {!selected ? <div className="network-detail-empty"><span aria-hidden="true">↖</span><p>{t('Inspect a public record to read its details, follow the source and save a note.', '查看公开记录的详情、访问来源，并保存笔记。')}</p><p className="input-help">{t('These are readings of the IMD network. Job execution and oracle submissions take place through the network’s own services.', '此处展示 IMD 网络数据。任务执行和预言机提交通过网络自身的服务进行。')}</p></div> : <><ReadingStatus resource={selectedReading} />
        {selected.kind === 'agent' && selectedAgent && <><StateBadge state={selectedAgent.working ? 'Working' : 'Not working'} /><dl className="network-fields"><Field label={t("Agent ID", "智能体 ID")} value={selectedAgent.agentId} /><Field label={t("Owner", "所有者")} value={selectedAgent.owner} /><Field label={t("Accepted tasks", "已接受的任务")} value={integer.format(selectedAgent.accepted)} /><Field label={t("Attempts", "尝试次数")} value={integer.format(selectedAgent.attempts)} /><Field label={t("Queued / pending", "排队中 / 待处理")} value={`${selectedAgent.queued} / ${selectedAgent.pending}`} /><Field label={t("Rejected / failed", "已拒绝 / 失败")} value={`${selectedAgent.rejected} / ${selectedAgent.failed}`} /><Field label={t("Last worked (UTC)", "最近工作时间（UTC）")} value={selectedAgent.lastWorkedAt ? date(selectedAgent.lastWorkedAt, locale) : null} /></dl></>}
        {selected.kind === 'agent' && snapshot && !selectedAgent && <p className="network-empty">{t('This seat is not in the current agent snapshot. Your saved note remains available in the watchlist.', '当前智能体快照中没有此席位。你保存的笔记仍保留在关注列表中。')}</p>}
        {selected.kind === 'job' && detail.reading && <JobDetail job={detail.reading.data as NetworkJobDetail} />}
        {selected.kind === 'oracle' && detail.reading && <OracleDetail oracle={detail.reading.data as NetworkOracleDetail} />}
        {selectedData && <div className="network-save"><Source url={selectedData.sourceUrl}>{t('Read the official record ↗', '查看官方记录 ↗')}</Source><label htmlFor="network-personal-note">{t('Your personal note', '你的个人笔记')}</label><textarea id="network-personal-note" rows={3} maxLength={500} value={note} onChange={event => setDrafts(previous => ({ ...previous, [selectedKey]: event.target.value }))} placeholder={t("What would you like to remember?", "你想记住什么？")} /><p className="input-help">{note.length}/500 · {t("Notes stay in this browser.", "笔记保存在本浏览器中。")}</p><div className="receipt-actions"><button type="button" className="button primary small" onClick={saveSelected}>{savedEntry ? t('Update saved note', '更新已保存的笔记') : t('Save to watchlist ＋', '保存到关注列表 ＋')}</button><button type="button" className="button secondary small" onClick={exportReading}>{t('Export reading ↓', '导出数据 ↓')}</button></div>{savedEntry && <button type="button" className="network-remove" onClick={() => remove(selected)}>{t('Remove saved item', '移除已保存的项目')}</button>}</div>}
      </>}
      {saveMessage && <p className="network-save-message" role="status">{message(saveMessage, t)}</p>}{saved.warning && tab !== 'saved' && <p className="network-error" role="status">{message(saved.warning, t)}</p>}
    </aside></div>
    <div className="network-footnote"><p>{t('Public text is provided by network participants. Read its sources before relying on an answer. Kaori preserves the reported state and does not independently verify oracle signatures.', '公开文本由网络参与者提供。使用答案前，请查看其来源。Kaori 保留网络报告的状态，不会独立验证预言机签名。')}</p><p>{t("Create paid work on the official IMD site:", "在 IMD 官方网站创建付费任务：")} <Source url="https://explorer.imd.fun/launch">{t('Open IMD task launcher ↗', '打开 IMD 任务启动器 ↗')}</Source></p></div>
  </div></section>;
}

function JobDetail({ job }: { job: NetworkJobDetail }) {
  const { t, locale } = useLanguage();
  return <><StateBadge state={job.state} /><p className="network-objective">{job.objective || t('No objective reported.', '未提供任务目标。')}</p><dl className="network-fields"><Field label={t("Job ID", "任务 ID")} value={job.id} /><Field label={t("Template", "模板")} value={job.template} /><Field label={t("Created (UTC)", "创建时间（UTC）")} value={date(job.createdAt, locale)} /><Field label={t("Updated (UTC)", "更新时间（UTC）")} value={date(job.updatedAt, locale)} /></dl>{job.blockedReason && <p className="network-error">{t("Reported block:", "报告的阻碍原因：")} {job.blockedReason}</p>}<h4 className="network-subtitle">{t('Reported task steps', '已报告的任务步骤')}</h4>{job.nodes.length ? <ol className="network-nodes">{job.nodes.map((node, index) => <li key={`${node.key}:${index}`}><div><strong>{node.role || node.key}</strong><StateBadge state={node.state} /></div><p>{node.key} · {t(`attempt ${node.attempt}`, `第 ${node.attempt} 次尝试`)}{node.tokenId ? t(` · seat #${node.tokenId}`, ` · 席位 #${node.tokenId}`) : ''}</p>{node.verdict && <p>{node.verdict}</p>}</li>)}</ol> : <p className="input-help">{t('No task steps reported.', '未提供任务步骤。')}</p>}<h4 className="network-subtitle">{t('Public result', '公开结果')}</h4>{job.resultText === null ? <p className="input-help">{t('No public result reported at this reading.', '本次读取时未提供公开结果。')}</p> : <pre className="network-result" tabIndex={0} aria-label={t("Public job result", "公开任务结果")}>{job.resultText}</pre>}</>;
}
function OracleDetail({ oracle }: { oracle: NetworkOracleDetail }) {
  const { t, locale } = useLanguage();
  return <><StateBadge state={oracle.status} /><p className="network-objective">{oracle.question || t('No question reported.', '未提供问题。')}</p><dl className="network-fields"><Field label={t("Request ID", "请求 ID")} value={oracle.id} /><Field label={t("Chain ID / answer type", "链 ID / 答案类型")} value={`${oracle.chainId} / ${oracle.answerType}`} /><Field label={t("Panel / quorum / agreed", "成员数 / 法定人数 / 同意数")} value={`${oracle.panelSize ?? '—'} / ${oracle.quorum ?? '—'} / ${oracle.agreed ?? '—'}`} /><Field label={t("Attested (UTC)", "签证时间（UTC）")} value={oracle.attestedAt ? date(oracle.attestedAt, locale) : null} /><Field label={t("Expires (UTC)", "到期时间（UTC）")} value={oracle.expiresAt ? date(oracle.expiresAt, locale) : null} /><Field label={t("Signature", "签名")} value={oracle.signaturePresent ? t('Present in source · not verified by Kaori', '来源中存在签名 · Kaori 未验证') : t('Not reported', '未提供')} /><Field label={t("Signer", "签名者")} value={oracle.signer} /><Field label={t("Block range", "区块范围")} value={oracle.fromBlock === null && oracle.toBlock === null ? null : `${oracle.fromBlock ?? '—'} → ${oracle.toBlock ?? '—'}`} /></dl>{oracle.failure && <p className="network-error">{t("Reported failure:", "报告的失败原因：")} {oracle.failure}</p>}<h4 className="network-subtitle">{t('Reported answer', '已报告的答案')}{oracle.resultSource ? ` · ${oracle.resultSource === 'computed' ? t('computed', '计算结果') : t('agreement', '共识结果')}` : ''}</h4>{oracle.resultText === null ? <p className="input-help">{t('No answer reported at this reading.', '本次读取时未提供答案。')}</p> : <pre className="network-result" tabIndex={0} aria-label={t("Reported oracle answer", "已报告的预言机答案")}>{oracle.resultText}</pre>}{oracle.evidence && <><h4 className="network-subtitle">{t('Reported evidence', '已报告的依据')}</h4><pre className="network-result" tabIndex={0} aria-label={t("Reported oracle evidence", "已报告的预言机依据")}>{oracle.evidence}</pre></>}</>;
}
