import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { download } from './download';
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
const integer = new Intl.NumberFormat('en-US');
const short = (value: string, length = 18) => value.length > length ? `${value.slice(0, length)}…` : value;
const date = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' });
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
function Source({ url, children = 'Open source ↗' }: { url: string; children?: React.ReactNode }) {
  const safe = safeSource(url);
  return safe ? <a className="source-link" href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : null;
}
function ReadingStatus({ resource }: { resource: Resource }) {
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
    {resource.busy && <p role="status">{resource.reading ? 'Refreshing this reading…' : 'Reading the IMD network…'}</p>}
    {resource.error && <p className="network-error" role="alert">{resource.error} {resource.reading ? 'The last successful reading remains below.' : ''}</p>}
    {resource.reading && <p>{stale || resource.error ? <strong>Earlier snapshot · </strong> : null}Read {date(resource.reading.retrievedAt)} UTC · <Source url={resource.reading.sourceUrl}>Official source ↗</Source>{stale ? ' · Refresh for a newer reading.' : ''}</p>}
  </div>;
}
function StateBadge({ state }: { state: string }) { return <span className="network-state">{state.replaceAll('_', ' ')}</span>; }
function Field({ label, value }: { label: string; value: string | number | null }) { return <div><dt>{label}</dt><dd>{value === null ? 'Not reported' : value}</dd></div>; }

export default function NetworkDesk() {
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
    <div className="section-head"><div><p className="eyebrow"><span className="section-index">04</span> THE NETWORK DESK</p><h2 className="section-title" id="network-heading">Follow the work.<br /><span>Keep the useful parts.</span></h2></div><p className="section-copy">Read public IMD agent activity, inspect jobs and oracle answers, and keep a personal watchlist for your next visit.</p></div>
    <div className="network-overview"><div className="network-overview-top"><p className="eyebrow"><span className="pixel-dot" /> PUBLIC IMD NETWORK</p><button type="button" className="button secondary small" disabled={overview.busy || list.busy || detail.busy} onClick={() => setRefresh(value => value + 1)}>Refresh readings ↻</button></div>
      <ReadingStatus resource={overview} />
      {snapshot ? <><div className="network-metrics">{[['Agents online', snapshot.metrics.agentsOnline], ['Working now', snapshot.metrics.workingNow], ['Jobs completed · 24h', snapshot.metrics.jobsDoneLastDay], ['Oracles completed · 24h', snapshot.metrics.oraclesDoneLastDay]].map(([label, value]) => <div className="network-metric" key={label}><span>{label}</span><strong>{integer.format(Number(value))}</strong></div>)}</div><p className="network-summary">{integer.format(snapshot.metrics.seatsEnrolled)} enrolled seats · {integer.format(snapshot.metrics.jobs)} jobs reported · {integer.format(snapshot.metrics.tasksInProgress)} tasks in progress</p><p className="input-help">Network observed {date(snapshot.observedAt)} UTC. {snapshot.reachable ? 'Source reachable at this reading.' : 'Source reports the network as unreachable.'} Public activity across IMD, including work from other applications.</p></> : !overview.busy && !overview.error ? <p className="input-help">Refresh to read the network.</p> : null}
    </div>
    <div className="network-workspace"><div className="network-browser">
      <div className="network-tabs" aria-label="Choose network view">{([['agents', 'Agents'], ['jobs', 'Jobs'], ['oracles', 'Oracles'], ['saved', `My watchlist (${saved.entries.length})`]] as [Tab, string][]).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      {tab === 'agents' && <div className="network-tab-content"><div className="network-filter"><label htmlFor="network-agent-query">Find an agent or seat</label><input id="network-agent-query" value={agentQuery} onChange={event => { setAgentQuery(event.target.value); setAgentPage(0); }} maxLength={200} placeholder="Agent ID or seat number" autoComplete="off" /><label className="network-checkbox"><input type="checkbox" checked={workingOnly} onChange={event => { setWorkingOnly(event.target.checked); setAgentPage(0); }} /> Working only</label></div><p className="input-help">Searches the {snapshot ? integer.format(snapshot.agents.length) : 'available'} agents in this snapshot. “Working” means reported task activity; it does not describe connectivity.</p>
        <div className="network-list">{visibleAgents.map(agent => <article className="network-row" key={agent.tokenId}><div><div className="network-row-top"><h3>Seat #{agent.tokenId}</h3><StateBadge state={agent.working ? 'Working' : 'Not working'} /></div><p className="network-row-title">{agent.agentId ?? 'Agent ID not reported'}</p><p className="input-help">{integer.format(agent.accepted)} accepted · {integer.format(agent.queued)} queued</p></div><button className="button secondary small" type="button" onClick={() => choose({ kind: 'agent', id: agent.tokenId })} aria-label={`Inspect agent seat ${agent.tokenId}`}>Inspect ↗</button></article>)}</div>
        {snapshot && !filteredAgents.length && <p className="network-empty">No agents match these filters in this snapshot.</p>}{!snapshot && !overview.busy && <p className="network-empty">Agent activity will appear when the network reading is available.</p>}
        {filteredAgents.length > 0 && <div className="network-pagination"><button className="button secondary small" type="button" disabled={shownAgentPage === 0} onClick={() => setAgentPage(shownAgentPage - 1)}>← Previous</button><span>{shownAgentPage * 12 + 1}–{Math.min((shownAgentPage + 1) * 12, filteredAgents.length)} of {integer.format(filteredAgents.length)}</span><button className="button secondary small" type="button" disabled={(shownAgentPage + 1) * 12 >= filteredAgents.length} onClick={() => setAgentPage(shownAgentPage + 1)}>Next →</button></div>}
      </div>}
      {(tab === 'jobs' || tab === 'oracles') && <div className="network-tab-content"><form className="network-search" onSubmit={search}><label htmlFor="network-search-query">{tab === 'jobs' ? 'Search public jobs' : 'Search public oracle questions'}</label><div><input id="network-search-query" value={tab === 'jobs' ? jobInput : oracleInput} onChange={event => tab === 'jobs' ? setJobInput(event.target.value) : setOracleInput(event.target.value)} maxLength={200} autoComplete="off" placeholder={tab === 'jobs' ? 'Objective or job ID prefix' : 'Words from the question'} /><button className="button dark small" type="submit" disabled={list.busy}>Search</button></div></form><p className="input-help">Newest first, up to 20 public records per page. {query ? `Current search: “${query}”.` : 'No search filter applied.'} {tab === 'jobs' ? 'Search matches job objectives or ID prefixes.' : 'Search matches question text.'}</p><ReadingStatus resource={list} />
        <div className="network-list">{page?.items.map(item => <article className="network-row" key={item.id}><div><div className="network-row-top"><span className="network-id">{short(item.id)}</span><StateBadge state={'state' in item ? item.state : item.status} /></div><h3 className="network-row-title">{'objective' in item ? item.objective || 'Untitled job' : item.question || 'Untitled oracle question'}</h3><p className="input-help">Updated {date(item.updatedAt)} UTC</p></div><button className="button secondary small" type="button" onClick={() => choose({ kind: tab === 'jobs' ? 'job' : 'oracle', id: item.id })} aria-label={`Inspect ${tab === 'jobs' ? 'job' : 'oracle'} ${item.id}`}>Inspect ↗</button></article>)}</div>
        {page && !page.items.length && <p className="network-empty">No public records found for this search and page.</p>}
        {page && <div className="network-pagination"><button className="button secondary small" type="button" disabled={list.busy || (tab === 'jobs' ? jobPage : oraclePage) === 0} onClick={() => tab === 'jobs' ? setJobPage(value => value - 1) : setOraclePage(value => value - 1)}>← Newer</button><span>Page {(tab === 'jobs' ? jobPage : oraclePage) + 1} · {page.items.length} shown</span><button className="button secondary small" type="button" disabled={list.busy || !page.nextBefore} onClick={olderPage}>Older →</button></div>}
      </div>}
      {tab === 'saved' && <div className="network-tab-content"><div className="network-saved-head"><div><h3>Your next chapter.</h3><p className="input-help">Up to {NETWORK_WATCHLIST_LIMIT} items, saved in this browser. Opening an item reads it again from IMD.</p></div><button type="button" className="button secondary small" disabled={!saved.entries.length} onClick={() => download(JSON.stringify({ project: 'Kaori IMD', exportedAt: new Date().toISOString(), ...JSON.parse(serializeNetworkWatchlist(saved.entries)) }, null, 2), 'kaori-network-watchlist.json')}>Export watchlist ↓</button></div>{saved.warning && <p className="network-error" role="status">{saved.warning}</p>}
        {!saved.entries.length && <div className="network-empty"><span aria-hidden="true">▤</span><h3>A place for what catches your eye.</h3><p>Inspect an agent, job or oracle and save it here with your own note.</p></div>}
        <div className="network-list">{saved.entries.map(item => <article className="network-row" key={watchlistKey(item.kind, item.id)}><div><p className="eyebrow">{item.kind} · {short(item.id)}</p><h3 className="network-row-title">{item.label}</h3>{item.note && <p className="network-note">{item.note}</p>}<p className="input-help">Saved {date(item.savedAt)} UTC</p></div><div className="network-row-actions"><button type="button" className="button secondary small" onClick={() => { choose(item); setRefresh(value => value + 1); }}>Open ↗</button><button type="button" className="network-remove" aria-label={`Remove ${item.label}`} onClick={() => remove(item)}>Remove</button></div></article>)}</div>
      </div>}
    </div>
    <aside className="network-detail" aria-labelledby="network-detail-heading"><div className="network-detail-top"><p className="eyebrow">KAORI’S FIELD NOTES</p>{selected && <button type="button" className="network-close" aria-label="Close network detail" onClick={() => setSelected(null)}>×</button>}</div><h3 id="network-detail-heading" ref={detailHeading} tabIndex={-1}>{selected ? selected.kind === 'agent' ? `Agent seat #${selected.id}` : selected.kind === 'job' ? 'Inside the job.' : 'Inside the oracle.' : 'Pick a thread.'}</h3>
      {!selected ? <div className="network-detail-empty"><span aria-hidden="true">↖</span><p>Inspect a public record to read its details, follow the source and save a note.</p><p className="input-help">These are readings of the IMD network. Job execution and oracle submissions take place through the network’s own services.</p></div> : <><ReadingStatus resource={selectedReading} />
        {selected.kind === 'agent' && selectedAgent && <><StateBadge state={selectedAgent.working ? 'Working' : 'Not working'} /><dl className="network-fields"><Field label="Agent ID" value={selectedAgent.agentId} /><Field label="Owner" value={selectedAgent.owner} /><Field label="Accepted tasks" value={integer.format(selectedAgent.accepted)} /><Field label="Attempts" value={integer.format(selectedAgent.attempts)} /><Field label="Queued / pending" value={`${selectedAgent.queued} / ${selectedAgent.pending}`} /><Field label="Rejected / failed" value={`${selectedAgent.rejected} / ${selectedAgent.failed}`} /><Field label="Last worked (UTC)" value={selectedAgent.lastWorkedAt ? date(selectedAgent.lastWorkedAt) : null} /></dl></>}
        {selected.kind === 'agent' && snapshot && !selectedAgent && <p className="network-empty">This seat is not in the current agent snapshot. Your saved note remains available in the watchlist.</p>}
        {selected.kind === 'job' && detail.reading && <JobDetail job={detail.reading.data as NetworkJobDetail} />}
        {selected.kind === 'oracle' && detail.reading && <OracleDetail oracle={detail.reading.data as NetworkOracleDetail} />}
        {selectedData && <div className="network-save"><Source url={selectedData.sourceUrl}>Read the official record ↗</Source><label htmlFor="network-personal-note">Your personal note</label><textarea id="network-personal-note" rows={3} maxLength={500} value={note} onChange={event => setDrafts(previous => ({ ...previous, [selectedKey]: event.target.value }))} placeholder="What would you like to remember?" /><p className="input-help">{note.length}/500 · Notes stay in this browser.</p><div className="receipt-actions"><button type="button" className="button primary small" onClick={saveSelected}>{savedEntry ? 'Update saved note' : 'Save to watchlist ＋'}</button><button type="button" className="button secondary small" onClick={exportReading}>Export reading ↓</button></div>{savedEntry && <button type="button" className="network-remove" onClick={() => remove(selected)}>Remove saved item</button>}</div>}
      </>}
      {saveMessage && <p className="network-save-message" role="status">{saveMessage}</p>}{saved.warning && tab !== 'saved' && <p className="network-error" role="status">{saved.warning}</p>}
    </aside></div>
    <div className="network-footnote"><p>Public text is provided by network participants. Read its sources before relying on an answer. Kaori preserves the reported state and does not independently verify oracle signatures.</p><p>Create paid work on the official IMD site: <Source url="https://explorer.imd.fun/launch">Open IMD task launcher ↗</Source></p></div>
  </div></section>;
}

function JobDetail({ job }: { job: NetworkJobDetail }) {
  return <><StateBadge state={job.state} /><p className="network-objective">{job.objective || 'No objective reported.'}</p><dl className="network-fields"><Field label="Job ID" value={job.id} /><Field label="Template" value={job.template} /><Field label="Created (UTC)" value={date(job.createdAt)} /><Field label="Updated (UTC)" value={date(job.updatedAt)} /></dl>{job.blockedReason && <p className="network-error">Reported block: {job.blockedReason}</p>}<h4 className="network-subtitle">Reported task steps</h4>{job.nodes.length ? <ol className="network-nodes">{job.nodes.map((node, index) => <li key={`${node.key}:${index}`}><div><strong>{node.role || node.key}</strong><StateBadge state={node.state} /></div><p>{node.key} · attempt {node.attempt}{node.tokenId ? ` · seat #${node.tokenId}` : ''}</p>{node.verdict && <p>{node.verdict}</p>}</li>)}</ol> : <p className="input-help">No task steps reported.</p>}<h4 className="network-subtitle">Public result</h4>{job.resultText === null ? <p className="input-help">No public result reported at this reading.</p> : <pre className="network-result" tabIndex={0} aria-label="Public job result">{job.resultText}</pre>}</>;
}
function OracleDetail({ oracle }: { oracle: NetworkOracleDetail }) {
  return <><StateBadge state={oracle.status} /><p className="network-objective">{oracle.question || 'No question reported.'}</p><dl className="network-fields"><Field label="Request ID" value={oracle.id} /><Field label="Chain ID / answer type" value={`${oracle.chainId} / ${oracle.answerType}`} /><Field label="Panel / quorum / agreed" value={`${oracle.panelSize ?? '—'} / ${oracle.quorum ?? '—'} / ${oracle.agreed ?? '—'}`} /><Field label="Attested (UTC)" value={oracle.attestedAt ? date(oracle.attestedAt) : null} /><Field label="Expires (UTC)" value={oracle.expiresAt ? date(oracle.expiresAt) : null} /><Field label="Signature" value={oracle.signaturePresent ? 'Present in source · not verified by Kaori' : 'Not reported'} /><Field label="Signer" value={oracle.signer} /><Field label="Block range" value={oracle.fromBlock === null && oracle.toBlock === null ? null : `${oracle.fromBlock ?? '—'} → ${oracle.toBlock ?? '—'}`} /></dl>{oracle.failure && <p className="network-error">Reported failure: {oracle.failure}</p>}<h4 className="network-subtitle">Reported answer{oracle.resultSource ? ` · ${oracle.resultSource}` : ''}</h4>{oracle.resultText === null ? <p className="input-help">No answer reported at this reading.</p> : <pre className="network-result" tabIndex={0} aria-label="Reported oracle answer">{oracle.resultText}</pre>}{oracle.evidence && <><h4 className="network-subtitle">Reported evidence</h4><pre className="network-result" tabIndex={0} aria-label="Reported oracle evidence">{oracle.evidence}</pre></>}</>;
}
