import { useCallback, useEffect, useRef, useState } from 'react';
import { HASH, displayAmount, receiptText, short } from './domain.mjs';
import { download } from './download';
import type { Receipt, Recent } from './types';
import ToolHeading from './ToolHeading';
import { currentWorkspaceView } from './workspace-navigation';
import { useLanguage } from './i18n';
import { translateArchiveMessage } from './useArchive';

const receiptMessages: Record<string, string> = {
  'Enter a complete Ethereum transaction hash: 0x followed by 64 hexadecimal characters.': '请输入完整的以太坊交易哈希：0x 后跟 64 个十六进制字符。',
  'This transaction could not be read. Please try again.': '无法读取此交易，请重试。',
  'This transaction was not found by the Ethereum providers. Check the hash and network.': '以太坊数据提供方未找到此交易，请核对交易哈希和网络。',
  'Ethereum data is unavailable right now. Please try again shortly.': '暂时无法获取以太坊数据，请稍后重试。',
  'Too many Ethereum requests are in progress. Please try again shortly.': '当前以太坊查询请求过多，请稍后重试。',
  'This transaction is pending. Its receipt and IMD transfers are not available yet.': '此交易尚待确认，暂时无法获取交易回执和 IMD 转账记录。',
  'This transaction reverted. It produced no committed IMD transfers.': '此交易已回滚，未产生已提交的 IMD 转账。',
  'This is an Ethereum transaction, but its receipt contains no Transfer events from the official IMD contract.': '这是一笔以太坊交易，但其回执中没有来自官方 IMD 合约的 Transfer 转账事件。',
  'Ethereum is unavailable. Please try again.': '暂时无法连接以太坊，请重试。',
  'Recent transactions are unavailable.': '暂时无法获取最近的交易。',
  'Receipt saved to your personal archive.': '回执已保存到你的个人档案。',
  'This record could not be saved.': '无法保存此记录。',
};

function Field({ label, value, link }: { label: string; value: string; link?: string }) {
  return <div className="data-field"><span className="data-label">{label}</span>{link ? <a className="data-value address-value" href={link} target="_blank" rel="noreferrer" title={value}>{value}</a> : <span className="data-value">{value}</span>}</div>;
}

export default function ReceiptInspector({ onSave, noteFor, requestedHash }: { onSave: (receipt: Receipt, note: string) => void; noteFor: (hash: string) => string; requestedHash: { hash: string; sequence: number } | null }) {
  const { t, locale } = useLanguage();
  const translateMessage = (value: string) => receiptMessages[value] ? t(value, receiptMessages[value]) : translateArchiveMessage(value, t);
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get('tx') ?? '');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [recentError, setRecentError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const lookupHashRef = useRef('');
  const noteForRef = useRef(noteFor);
  useEffect(() => { noteForRef.current = noteFor; }, [noteFor]);

  const lookup = useCallback(async (value: string) => {
    const normalized = value.trim().toLowerCase();
    requestRef.current?.abort();
    setReceipt(null); setMessage(''); setError('');
    if (!HASH.test(normalized)) { lookupHashRef.current = ''; setBusy(false); setError('Enter a complete Ethereum transaction hash: 0x followed by 64 hexadecimal characters.'); return; }
    lookupHashRef.current = normalized;
    const controller = new AbortController(); requestRef.current = controller;
    setHash(normalized); setBusy(true); setNote('');
    try {
      const response = await fetch(`/api/receipt?hash=${encodeURIComponent(normalized)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'This transaction could not be read. Please try again.');
      if (controller.signal.aborted) return;
      setReceipt(data); setNote(noteForRef.current(normalized));
      if (currentWorkspaceView() === 'receipt') {
        const url = new URL(location.href); url.searchParams.set('tx', normalized); history.replaceState(null, '', url);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Ethereum is unavailable. Please try again.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);

  useEffect(() => {
    const initialHash = new URLSearchParams(location.search).get('tx');
    if (initialHash) void lookup(initialHash);
    return () => requestRef.current?.abort();
  }, [lookup]);
  useEffect(() => {
    const syncHistory = () => {
      const transaction = new URLSearchParams(location.search).get('tx')?.trim().toLowerCase();
      if (currentWorkspaceView() === 'receipt' && transaction && HASH.test(transaction) && transaction !== lookupHashRef.current) void lookup(transaction);
    };
    window.addEventListener('popstate', syncHistory);
    window.addEventListener('hashchange', syncHistory);
    return () => { window.removeEventListener('popstate', syncHistory); window.removeEventListener('hashchange', syncHistory); };
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
      <ToolHeading id="receipt-heading" title={t('Receipt desk', '回执工作台')} subtitle={t('Read the record behind an IMD transfer.', '读取 IMD 转账背后的链上记录。')} bubble={t('Follow the hash!', '顺着哈希找！')} />
      <div className="inspector-layout"><div className="inspector-main">
        <form className="query-form" onSubmit={event => { event.preventDefault(); void lookup(hash); }}>
          <label className="field-label" htmlFor="transaction-hash">{t('Ethereum transaction hash', '以太坊交易哈希')}</label>
          <div className="input-row"><input id="transaction-hash" className="hash-input" value={hash} onChange={event => setHash(event.target.value)} maxLength={66} placeholder={t('Paste your transaction hash', '粘贴你的交易哈希')} autoComplete="off" spellCheck={false} /><button className="button primary" type="submit" disabled={busy}>{busy ? t('Reading…', '读取中…') : t('Read receipt', '读取回执')}<span aria-hidden="true">↗</span></button></div>
          <p className="input-help">{t('Ethereum mainnet · Official IMD transfer events · No wallet connection required', '以太坊主网 · 官方 IMD 转账事件 · 无需连接钱包')}</p>
        </form>
        {error && <p className="status-message error" role="alert">{translateMessage(error)}</p>}
        {busy && <div className="receipt-empty loading" role="status"><span className="story-drawing" aria-hidden="true">▤</span><h3>{t('Following the paper trail…', '追踪链上记录…')}</h3><p>{t('Reading the transaction and its Ethereum receipt.', '正在读取交易及其以太坊回执。')}</p></div>}
        {!receipt && !busy && !error && <div className="receipt-empty"><span className="story-drawing" aria-hidden="true">▤</span><h3>{t('Your next record starts here.', '你的下一条记录，从这里开始。')}</h3><p>{t('Paste a transaction hash, or select a recent IMD transaction from the desk.', '粘贴交易哈希，或从工作台选择一笔最近的 IMD 交易。')}</p><span className="chapter-tag">{t('READY WHEN YOU ARE', '随时开始')}</span></div>}
        {receipt && <div className="receipt-result" aria-live="polite">
          <div className="receipt-topline"><div><p className="eyebrow">{t('ETHEREUM RECORD', '以太坊记录')}</p><h3 className="receipt-title">{receipt.transfers.length ? t('IMD transfer receipt', 'IMD 转账回执') : t('Ethereum transaction', '以太坊交易')}</h3></div><span className={`status-badge ${receipt.status}`}>{receipt.status === 'success' ? t('Executed', '已执行') : receipt.status === 'reverted' ? t('Reverted', '已回滚') : t('Pending', '待确认')}</span></div>
          {receipt.warning && <p className="status-message">{translateMessage(receipt.warning)}</p>}
          <div className="receipt-grid">
            <Field label={t('Transaction', '交易')} value={receipt.hash} link={`https://etherscan.io/tx/${receipt.hash}`} />
            <Field label={t('Block', '区块')} value={receipt.blockNumber ?? t('Not mined yet', '尚未打包')} />
            <Field label={t('Block time', '区块时间')} value={receipt.timestamp ? new Date(receipt.timestamp).toLocaleString(locale, { timeZone: 'UTC' }) + ' UTC' : t('Not mined yet', '尚未打包')} />
            <Field label={t('Confirmations at reading', '查询时的确认数')} value={receipt.confirmations ?? t('Not mined yet', '尚未打包')} />
            <Field label={t('Finality', '最终确认状态')} value={receipt.finality === 'finalized' ? t('Finalized on Ethereum', '已在以太坊最终确认') : receipt.finality === 'unfinalized' ? t('Awaiting finality', '等待最终确认') : t('Not available from provider', '数据提供方未提供')} />
            <Field label={t('Execution gas fee', '执行手续费')} value={receipt.feeEth ? `${receipt.feeEth} ETH` : t('Not available yet', '暂未提供')} />
            <Field label={t('Transaction sender', '交易发送方')} value={receipt.from} link={`https://etherscan.io/address/${receipt.from}`} />
            <Field label={t('Transaction recipient', '交易接收方')} value={receipt.to ?? t('Contract creation', '合约创建')} link={receipt.to ? `https://etherscan.io/address/${receipt.to}` : undefined} />
          </div>
          {receipt.transfers.length > 0 && <div className="transfer-list"><p className="field-label">{t('IMD transfer events', 'IMD 转账事件')} · {receipt.transfers.length}</p>{receipt.transfers.map((transfer, index) => <div className="transfer-row" key={transfer.logIndex}><span className="section-index">{String(index + 1).padStart(2, '0')}</span><div><div className="transfer-amount">{displayAmount(transfer.amount)} <span>IMD</span></div><p className="transfer-path"><a href={`https://etherscan.io/address/${transfer.from}`} target="_blank" rel="noreferrer" title={transfer.from}>{short(transfer.from)}</a><span aria-hidden="true">→</span><a href={`https://etherscan.io/address/${transfer.to}`} target="_blank" rel="noreferrer" title={transfer.to}>{short(transfer.to)}</a></p></div></div>)}</div>}
          <p className="input-help">{t('Read', '查询于')} {new Date(receipt.retrievedAt).toLocaleString(locale, { timeZone: 'UTC' })} UTC · {t('Snapshot block', '快照区块')} {receipt.snapshotBlockNumber} · {receipt.provider}</p>
          {canSave && <div className="note-field"><label className="field-label" htmlFor="receipt-note">{t('Your personal note', '你的个人笔记')} <span>{t('(optional)', '（可选）')}</span></label><textarea className="note-input" id="receipt-note" value={note} onChange={event => setNote(event.target.value)} maxLength={600} rows={3} placeholder={t('What would you like to remember about this transfer?', '关于这笔转账，你想记下什么？')} /><p className="input-help">{t('Your note stays in this browser. It is not sent to Ethereum.', '笔记只保存在此浏览器中，不会发送到以太坊。')}</p></div>}
          <div className="receipt-actions">{canSave && <button className="button primary" onClick={save}>{t('Save to archive', '保存到档案')} <span aria-hidden="true">＋</span></button>}<button className="button secondary small" onClick={() => download(receiptText(receipt, note), `kaori-${receipt.hash.slice(2, 10)}.txt`, 'text/plain;charset=utf-8')}>{t('Download record', '下载记录')}</button><button className="button secondary small" onClick={() => download(JSON.stringify({ project: 'Kaori IMD', receipt, personalNote: note }, null, 2), `kaori-${receipt.hash.slice(2, 10)}.json`)}>{t('Export JSON', '导出 JSON')}</button><button className="button secondary small" onClick={() => void lookup(receipt.hash)}>{t('Refresh', '刷新')}</button></div>
          {message && <p className="status-message success" role="status">{translateMessage(message)}</p>}
        </div>}
      </div><aside className="recent-panel" aria-labelledby="recent-heading"><div className="recent-head"><span className="pixel-dot" aria-hidden="true" /><h3 id="recent-heading">{t('Fresh from Ethereum', '以太坊最新动态')}</h3></div><p className="input-help">{t('Recent transactions containing IMD transfers. Select one to read its record.', '包含 IMD 转账的最近交易。选择一笔即可读取记录。')}</p>{recentError ? <p className="status-message error">{translateMessage(recentError)}</p> : !recent ? <p role="status" className="input-help">{t('Reading recent transactions…', '正在读取最近的交易…')}</p> : <><div className="recent-list">{recent.transactions.map(transaction => <button className="recent-item" key={transaction.hash} disabled={busy} onClick={() => void lookup(transaction.hash)}><span className="recent-hash">{short(transaction.hash, 8)} <span aria-hidden="true">↗</span></span><span className="recent-meta">{t('Block', '区块')} {transaction.blockNumber} · {t(`${transaction.transferCount} IMD event${transaction.transferCount === 1 ? '' : 's'}`, `${transaction.transferCount} 个 IMD 事件`)}</span></button>)}</div>{recent.transactions.length === 0 && <p className="input-help">{t('No IMD transfers were found in this block window.', '此区块范围内未发现 IMD 转账。')}</p>}<p className="input-help">{t('Blocks', '区块')} {recent.fromBlock}–{recent.blockNumber}<br />{t('Read', '查询于')} {new Date(recent.retrievedAt).toLocaleTimeString(locale, { timeZone: 'UTC' })} UTC</p></>}</aside></div>
    </div>
  </section>;
}
