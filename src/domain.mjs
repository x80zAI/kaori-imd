export const CONTRACT = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7';
export const HASH = /^0x[0-9a-fA-F]{64}$/;
export const STORAGE_KEY = 'kaori-imd.archive.v1';
export const MAX_RECORDS = 30;
export function short(value, size = 6) { return value ? `${value.slice(0, size + 2)}…${value.slice(-size)}` : 'Contract creation'; }
export function displayAmount(amount) {
  const [whole, fraction = ''] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}
export function readArchive(raw) {
  if (!raw) return { entries: [], corrupted: false };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) throw new Error('Invalid archive');
    const entries = parsed.map(entry => {
      if (!entry || !HASH.test(entry.hash) || typeof entry.note !== 'string' || entry.note.length > 600 || !Number.isFinite(Date.parse(entry.savedAt))) throw new Error('Invalid record');
      const receipt = entry.receipt;
      if (receipt !== null && (!receipt || receipt.hash?.toLowerCase() !== entry.hash.toLowerCase() || receipt.chainId !== 1 || receipt.contract?.toLowerCase() !== CONTRACT.toLowerCase() || !['pending', 'success', 'reverted'].includes(receipt.status) || !Array.isArray(receipt.transfers) || typeof receipt.snapshotBlockNumber !== 'string' || !/^\d+$/.test(receipt.snapshotBlockNumber) || !Number.isFinite(Date.parse(receipt.retrievedAt)))) throw new Error('Invalid receipt');
      return { hash: entry.hash.toLowerCase(), note: entry.note, savedAt: entry.savedAt, receipt };
    });
    if (new Set(entries.map(entry => entry.hash)).size !== entries.length) throw new Error('Duplicate records');
    return { entries, corrupted: false };
  } catch { return { entries: [], corrupted: true }; }
}
export function mergeEntry(entries, entry) {
  const filtered = entries.filter(item => item.hash.toLowerCase() !== entry.hash.toLowerCase());
  if (filtered.length >= MAX_RECORDS) throw new Error('Your archive holds 30 records. Remove one before adding another.');
  return [{ ...entry, hash: entry.hash.toLowerCase() }, ...filtered];
}
export function writeArchive(storage, entries) {
  const current = storage.getItem(STORAGE_KEY);
  if (readArchive(current).corrupted) return 'Unreadable stored data has been preserved. New records are kept for this visit only; export your notes before closing the page.';
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return '';
}
export function exportNotes(entries) {
  return JSON.stringify({ project: 'Kaori IMD', version: 1, exportedAt: new Date().toISOString(), records: entries.map(({ hash, note, savedAt }) => ({ hash, note, savedAt })) }, null, 2);
}
export function importNotes(raw, existing) {
  if (raw.length > 100000) throw new Error('This file is too large. Choose a Kaori IMD notes backup.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('This is not a readable JSON backup.'); }
  if (parsed?.project !== 'Kaori IMD' || parsed.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > MAX_RECORDS) throw new Error('Choose a Kaori IMD notes backup.');
  const checked = readArchive(JSON.stringify(parsed.records.map(item => ({ ...item, receipt: null }))));
  if (checked.corrupted) throw new Error('This backup contains invalid records. Nothing was imported.');
  const merged = [...existing];
  for (const entry of checked.entries) {
    if (!merged.some(item => item.hash === entry.hash)) merged.push(entry);
  }
  if (merged.length > MAX_RECORDS) throw new Error('Import would exceed 30 records. Remove some records first.');
  return merged;
}
export function receiptText(receipt, note = '') {
  return [
    'KAORI IMD — Ethereum transaction record', '',
    `Transaction: ${receipt.hash}`, `Status: ${receipt.status}`, `Network: Ethereum mainnet (1)`,
    `IMD contract: ${receipt.contract}`, `Transaction sender: ${receipt.from}`, `Transaction recipient: ${receipt.to ?? 'Contract creation'}`,
    `Block: ${receipt.blockNumber ?? 'Pending'}`, `Block hash: ${receipt.blockHash ?? 'Pending'}`,
    `Time: ${receipt.timestamp ?? 'Pending'}`, `Confirmations at reading: ${receipt.confirmations ?? 'Pending'}`,
    `Finality: ${receipt.finality}`, `Snapshot block: ${receipt.snapshotBlockNumber}`,
    `Execution gas fee: ${receipt.feeEth ?? 'Unavailable'} ETH`, '',
    'IMD transfer events:', ...receipt.transfers.map((transfer, index) => `${index + 1}. ${transfer.amount} IMD\nFrom: ${transfer.from}\nTo: ${transfer.to}\nLog index: ${transfer.logIndex}`),
    receipt.transfers.length ? '' : 'No completed IMD transfer events in this record.',
    receipt.warning ? `Reading note: ${receipt.warning}` : '',
    `Read at: ${receipt.retrievedAt}`, `Provider: ${receipt.provider}`, `Source: https://etherscan.io/tx/${receipt.hash}`, '',
    `Personal note: ${note || '(none)'}`, '',
    'This file records a public Ethereum reading. It is not a signed certificate, proof of wallet ownership or a payment guarantee. Gas fee covers execution gas. Recheck the transaction for current confirmations.'
  ].filter(line => line !== null).join('\n');
}
