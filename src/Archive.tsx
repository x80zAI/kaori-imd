import { useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
import { exportNotes, short } from './domain.mjs';
import { download } from './download';
import type { ArchiveEntry } from './types';
import { useLanguage } from './i18n';
import { translateArchiveMessage } from './useArchive';
export default function Archive({ entries, warning, onRemove, onOpen, onRestore }: { entries: ArchiveEntry[]; warning: string; onRemove: (hash: string) => void; onOpen: (hash: string) => void; onRestore: (raw: string) => void }) {
  const { t, locale } = useLanguage();
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
    <ToolHeading id="archive-heading" title={t('My archive', '我的档案')} subtitle={t('Your IMD receipts and personal notes, kept in this browser.', '你的 IMD 回执和个人笔记，保存在此浏览器中。')} bubble={t('Keep your chapter!', '留住你的故事！')}><div className="archive-tools"><span className="chapter-tag">{entries.length} / 30 {t('RECORDS', '条记录')}</span><button className="button dark small" disabled={!entries.length} onClick={() => download(exportNotes(entries), 'kaori-imd-notes.json')}>{t('Export notes', '导出笔记')} ↗</button><button className="button secondary small" onClick={() => fileRef.current?.click()}>{t('Restore notes', '恢复笔记')}</button><input ref={fileRef} hidden type="file" accept="application/json,.json" aria-label={t('Restore Kaori IMD notes backup', '恢复 Kaori IMD 笔记备份')} onChange={event => void restore(event.target.files?.[0])} /></div></ToolHeading>
    <p className="section-copy">{t('Your archive lives in this browser. Keep a notes backup if you want to move it to another device. Saved readings retain their original timestamp; open a record to refresh it.', '档案保存在此浏览器中。如需转移到其他设备，请保留笔记备份。已保存的查询保留原始时间戳，打开记录即可刷新数据。')}</p>
    {warning && <p className="archive-warning" role="alert">{warning}</p>}{message && <p className="status-message" role="status">{translateArchiveMessage(message, t)}</p>}
    {entries.length > 0 && <label className="field-label">{t('Find a record', '查找记录')}<input className="archive-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search notes or transaction hashes', '搜索笔记或交易哈希')} /></label>}
    {entries.length === 0 ? <div className="archive-empty"><span className="story-drawing" aria-hidden="true">▤</span><div><h3>{t('A blank page. Yours to fill.', '空白的一页，等你来写。')}</h3><p>{t('Read an IMD receipt, add a note, and save your first record.', '读取一份 IMD 回执，添加笔记，保存你的第一条记录。')}</p></div><a className="button dark" href="#receipt">{t('Go to the receipt desk', '前往回执工作台')} ↗</a></div> : <div className="archive-list">{shown.map(entry => <article className="archive-card" key={entry.hash}><div className="archive-card-top"><span className="chapter-tag">{entry.receipt ? t('SAVED READING', '已保存的查询') : t('RESTORED NOTE', '已恢复的笔记')}</span><h3 title={entry.hash}>{short(entry.hash, 10)}</h3></div><p className="archive-note">{entry.note || t('No personal note added.', '尚未添加个人笔记。')}</p><p className="archive-meta">{t('Saved', '保存于')} {new Date(entry.savedAt).toLocaleDateString(locale)}{entry.receipt ? t(` · Read at block ${entry.receipt.snapshotBlockNumber}`, ` · 查询区块 ${entry.receipt.snapshotBlockNumber}`) : t(' · Open to retrieve Ethereum data', ' · 打开即可获取以太坊数据')}</p><div className="archive-card-actions"><button className="button dark small" onClick={() => onOpen(entry.hash)}>{t('Open & refresh', '打开并刷新')} ↗</button><a className="source-link" href={`https://etherscan.io/tx/${entry.hash}`} target="_blank" rel="noreferrer">Etherscan ↗</a><button className="source-link" onClick={() => onRemove(entry.hash)} aria-label={t(`Remove saved record ${short(entry.hash)}`, `删除已保存的记录 ${short(entry.hash)}`)}>{t('Remove', '删除')}</button></div></article>)}{shown.length === 0 && <p className="input-help">{t('No saved records match your search.', '没有符合搜索条件的已保存记录。')}</p>}</div>}
  </div></section>;
}
