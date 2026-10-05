import { useEffect, useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
import { useLanguage } from './i18n';
import { CONTRACT, displayAmount } from './domain.mjs';
import { ADDRESS, ZERO_ADDRESS, parseApprovalReading } from './approval.mjs';
import type { ApprovalReading } from './types';

const approvalMessages: Record<string, string> = {
  'Enter your complete Ethereum wallet address: 0x followed by 40 hexadecimal characters.': '请输入完整的以太坊钱包地址：以 0x 开头，后接 40 个十六进制字符。',
  'Enter the complete Ethereum address of the application you want to check.': '请输入您要查询的应用的完整以太坊地址。',
  'The IMD approval could not be read. Please try again.': '无法读取 IMD 授权，请重试。',
  'Ethereum is unavailable. Please try again.': '暂时无法连接以太坊，请重试。',
  'IMD approval data could not be verified. Please try again.': '无法验证 IMD 授权数据，请重试。',
};

function ReadingField({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="data-field"><span className="data-label">{label}</span>{href ? <a className="data-value" href={href} target="_blank" rel="noreferrer">{value} ↗</a> : <span className="data-value">{value}</span>}</div>;
}

export default function ApprovalCheck() {
  const { t, locale } = useLanguage();
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
    <ToolHeading id="approval-heading" title={t('Approval check', '授权查询')} subtitle={t('See how much IMD an application can spend from your wallet.', '查看应用可以从您的钱包中使用多少 IMD。')} bubble={t('Check the permission!', '查清授权！')} />
    <div className="approval-layout">
      <div className="approval-workspace">
        <form className="approval-form" onSubmit={event => { event.preventDefault(); void checkApproval(); }} noValidate aria-busy={busy}>
          <div><label className="field-label" htmlFor="approval-owner">{t('Your wallet address', '您的钱包地址')}</label><input className="approval-input" id="approval-owner" value={owner} onChange={event => changeAddress('owner', event.target.value)} placeholder={t('Paste your Ethereum wallet address', '粘贴您的以太坊钱包地址')} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby="approval-owner-help" /><p className="input-help" id="approval-owner-help">{t('The wallet that holds your IMD. No wallet connection is needed.', '持有您 IMD 的钱包，无需连接钱包。')}</p></div>
          <div><label className="field-label" htmlFor="approval-spender">{t('Application address', '应用地址')}</label><input className="approval-input" id="approval-spender" value={spender} onChange={event => changeAddress('spender', event.target.value)} placeholder={t("Paste the application's spending address", '粘贴应用的代币使用地址')} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby="approval-spender-help" /><p className="input-help" id="approval-spender-help">{t("Use the spender address shown in your wallet's approval details or the application's official documentation.", '请使用钱包授权详情或应用官方文档中显示的获授权地址。')}</p></div>
          <button className="button dark" type="submit" disabled={busy}>{busy ? t('Reading Ethereum…', '正在读取以太坊…') : t('Check approval ↗', '查询授权 ↗')}</button>
          {error && <p className="status-message error" role="alert">{approvalMessages[error] ? t(error, approvalMessages[error]) : <>{t('Source message:', '数据来源提示：')} {error}</>}</p>}
          {busy && <p className="input-help" role="status">{t('Reading this wallet and application pair from Ethereum.', '正在从以太坊读取此钱包与应用之间的授权。')}</p>}
        </form>
        {reading ? <div className={`approval-result approval-${state}`} role="status" aria-live="polite">
          <div className="approval-result-head"><span className="eyebrow">{t('IMD · ETHEREUM MAINNET', 'IMD · 以太坊主网')}</span><h3>{state === 'none' ? t('No spending allowance', '无代币使用授权') : state === 'maximum' ? t('Maximum approval', '最大额度授权') : t('Spending allowance', '代币使用授权')}</h3><p>{state === 'none' ? t('This application address has no IMD spending allowance from this wallet at the recorded block.', '在所记录的区块中，此应用地址未获授权使用该钱包的 IMD。') : state === 'maximum' ? t('This address has the maximum possible IMD approval from this wallet.', '该钱包已向此地址授予 IMD 的最大可用授权额度。') : t('This is the remaining IMD amount this application address is allowed to spend from this wallet.', '这是此应用地址仍获授权从该钱包使用的 IMD 数量。')}</p></div>
          <div className="approval-amount"><span className="data-label">{t('Exact allowance', '精确授权额度')}</span><p><strong>{displayAmount(reading.allowance)}</strong> <span>IMD</span></p></div>
          <div className="receipt-grid"><ReadingField label={t('Wallet checked', '已查询的钱包')} value={reading.owner} href={`https://etherscan.io/address/${reading.owner}`} /><ReadingField label={t('Application checked', '已查询的应用')} value={reading.spender} href={`https://etherscan.io/address/${reading.spender}`} /><ReadingField label={t('Snapshot block', '数据区块')} value={reading.snapshotBlockNumber} href={`https://etherscan.io/block/${reading.snapshotBlockNumber}`} /><ReadingField label={t('Read at (UTC)', '读取时间（UTC）')} value={new Date(reading.retrievedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' })} /></div>
          <div className="approval-result-footer"><p className="input-help">{t('This permission is separate from your IMD balance. This reading covers only the two addresses you entered and can change after this block.', '授权额度与您的 IMD 余额不同。本次读取仅涵盖您输入的两个地址，授权可能在此区块之后发生变化。')}</p><div className="receipt-actions"><button className="button secondary small" disabled={busy} onClick={() => void checkApproval()}>{t('Refresh reading ↻', '刷新数据 ↻')}</button><a className="source-link" href={`https://etherscan.io/address/${CONTRACT}#readContract`} target="_blank" rel="noreferrer">{t('IMD contract source ↗', 'IMD 合约源码 ↗')}</a></div><p className="input-help">{t('Ethereum source:', '以太坊数据来源：')} {reading.provider}</p></div>
        </div> : !busy && !error && <div className="approval-empty"><span className="approval-seal" aria-hidden="true">✓</span><div><h3>{t('Know the permission.', '了解您的授权。')}</h3><p>{t('Enter both addresses to read their current IMD spending allowance.', '输入两个地址，查询当前的 IMD 使用授权额度。')}</p></div></div>}
      </div>
      <aside className="approval-guide" aria-labelledby="approval-guide-heading"><p className="eyebrow">{t('BEFORE YOU CHECK', '查询前须知')}</p><h3 id="approval-guide-heading">{t('Your wallet.', '您的钱包。')}<br />{t('Their permission.', '对方的权限。')}</h3><p>{t('Using an application can involve giving its address permission to spend your tokens. Kaori reads the remaining IMD permission for the address you choose.', '使用应用时，您可能需要授权其地址使用您的代币。Kaori 会读取您所选地址剩余的 IMD 授权额度。')}</p><ul><li><strong>{t('Zero', '零')}</strong>{t(' means no allowance for this pair.', '表示这两个地址之间没有授权额度。')}</li><li><strong>{t('A set amount', '指定额度')}</strong>{t(' is the remaining spending limit.', '是剩余的代币使用限额。')}</li><li><strong>{t('Maximum approval', '最大额度授权')}</strong>{t(' is the highest possible token allowance.', '是该代币允许的最高授权额度。')}</li></ul><p className="approval-guide-note">{t('A spending allowance does not tell you whether an application is trustworthy. Kaori only reads the permission; it does not change it.', '授权额度并不能说明应用是否可信。Kaori 仅读取授权，不会更改授权。')}</p></aside>
    </div>
  </div></section>;
}
