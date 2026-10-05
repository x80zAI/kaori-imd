import { useEffect, useState } from 'react';
import { STORAGE_KEY, readArchive, mergeEntry, importNotes, writeArchive } from './domain.mjs';
import type { ArchiveEntry, Receipt } from './types';
import { useLanguage } from './i18n';

const archiveMessages: Record<string, string> = {
  'Saved records could not be read. Your stored data has been kept so you can recover it.': '无法读取已保存的记录。原始数据已保留，方便你恢复。',
  'Browser storage is unavailable. Export your notes before closing this page.': '浏览器存储不可用。请在关闭此页面前导出笔记。',
  'These records are kept for this visit only. Export your notes before closing the page.': '这些记录仅在本次访问期间保留。请在关闭页面前导出笔记。',
  'Unreadable stored data has been preserved. New records are kept for this visit only; export your notes before closing the page.': '无法读取的原始数据已保留。新记录仅在本次访问期间保留，请在关闭页面前导出笔记。',
  'Your archive holds 30 records. Remove one before adding another.': '档案最多保存 30 条记录。请先删除一条，再添加新记录。',
  'Choose a notes backup smaller than 100 KB.': '请选择小于 100 KB 的笔记备份。',
  'Notes restored. Open a record to read its current Ethereum data.': '笔记已恢复。打开记录即可读取最新的以太坊数据。',
  'The notes could not be restored.': '无法恢复笔记。',
  'This file is too large. Choose a Kaori IMD notes backup.': '文件过大。请选择 Kaori IMD 笔记备份。',
  'This is not a readable JSON backup.': '无法读取此 JSON 备份。',
  'Choose a Kaori IMD notes backup.': '请选择 Kaori IMD 笔记备份。',
  'This backup contains invalid records. Nothing was imported.': '此备份包含无效记录，未导入任何内容。',
  'Import would exceed 30 records. Remove some records first.': '导入后将超过 30 条记录。请先删除部分记录。',
};

export function translateArchiveMessage(message: string, t: (english: string, chinese: string) => string) {
  return t(message, archiveMessages[message] ?? message);
}
function initial() {
  try {
    const result = readArchive(localStorage.getItem(STORAGE_KEY));
    return { entries: result.entries as ArchiveEntry[], warning: result.corrupted ? 'Saved records could not be read. Your stored data has been kept so you can recover it.' : '' };
  } catch { return { entries: [] as ArchiveEntry[], warning: 'Browser storage is unavailable. Export your notes before closing this page.' }; }
}
export function useArchive() {
  const { t } = useLanguage();
  const [state, setState] = useState(initial);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setState(initial()); };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, []);
  function latest() {
    if (state.warning) return state.entries;
    try { const current = readArchive(localStorage.getItem(STORAGE_KEY)); return current.corrupted ? state.entries : current.entries as ArchiveEntry[]; } catch { return state.entries; }
  }
  function persist(entries: ArchiveEntry[]) {
    let warning = '';
    try { warning = writeArchive(localStorage, entries); }
    catch { warning = 'These records are kept for this visit only. Export your notes before closing the page.'; }
    setState({ entries, warning });
  }
  function save(receipt: Receipt, note: string) {
    persist(mergeEntry(latest(), { hash: receipt.hash, receipt, note: note.trim(), savedAt: new Date().toISOString() }));
  }
  return { ...state, warning: translateArchiveMessage(state.warning, t), save, remove: (hash: string) => persist(latest().filter(entry => entry.hash !== hash)), restore: (raw: string) => persist(importNotes(raw, latest())) };
}
