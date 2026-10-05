import { useEffect, useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
import { useLanguage } from './i18n';
import { formatStakingUnits, IMD_DECIMALS, isStakingAddress, parsePendingStaking, parseStakingAmount, parseStakingReading, SIMD_DECIMALS, STAKING_VAULT, ZERO_ADDRESS } from './staking.mjs';
import type { StakingIntent, StakingReading } from './types';

type Provider = {
  request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type WalletChoice = { id: string; name: string; provider: Provider };
type TransactionState = { stage: string; hash?: string; action?: string; account?: string; amountRaw?: string; assetsRaw?: string; sharesRaw?: string };
const PENDING_KEY = 'kaori-imd-staking-pending-v1';
const REVIEW_KEY = 'kaori-imd-staking-wallet-review-v1';
const fmt = formatStakingUnits;
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

// Keep stored wallet errors language-independent so switching language preserves the operation.
const stakingMessages: Record<string, string> = {
  'You declined the wallet request. No new transaction was submitted.': '您已拒绝钱包请求，未提交新的交易。',
  'A wallet request is already open. Check your wallet first.': '已有钱包请求等待处理，请先查看钱包。',
  'The wallet could not complete this request. Please try again.': '钱包无法完成此请求，请重试。',
  'Ethereum staking data is unavailable. Please try again.': '暂时无法读取以太坊质押数据，请重试。',
  'Your wallet did not provide an Ethereum address.': '您的钱包未提供以太坊地址。',
  'Refresh the quote before opening your wallet.': '请先刷新报价，再打开钱包确认。',
  'Enter a valid amount.': '请输入有效数量。',
  'Use a positive number with a decimal point, without commas or exponent notation.': '请输入正数，小数使用小数点，不要使用逗号或科学计数法。',
  'Enter an amount greater than zero within the token limit.': '请输入大于零且在代币限额内的数量。',
  'Invalid token amount.': '代币数量无效。',
  'Staking data could not be verified. Refresh the reading before continuing.': '无法验证质押数据，请刷新后再继续。',
  'Choose a valid Ethereum wallet address.': '请选择有效的以太坊钱包地址。',
  'Enter a valid positive token amount.': '请输入有效的正数代币数量。',
  'This staking action is invalid.': '此质押操作无效。',
  'This Ethereum transaction hash is invalid.': '此以太坊交易哈希无效。',
  'This transaction record is invalid.': '此交易记录无效。',
  'Your wallet or staking details changed. Review them and try again.': '您的钱包或质押详情已变更，请核对后重试。',
  'Open Kaori in a browser with your Ethereum wallet installed.': '请在已安装以太坊钱包的浏览器中打开 Kaori。',
  'Switch your wallet to Ethereum mainnet before continuing.': '请先将钱包切换至以太坊主网。',
  'Your selected wallet changed. Review it before continuing.': '您选择的钱包已变更，请核对后再继续。',
  'Ethereum mainnet data could not be verified. Try again shortly.': '无法验证以太坊主网数据，请稍后重试。',
  'The official IMD staking contract could not be verified. No transaction was sent.': '无法验证官方 IMD 质押合约，未发送交易。',
  'The official IMD staking data could not be verified. No transaction was sent.': '无法验证官方 IMD 质押数据，未发送交易。',
  'The staking vault is paused. No transaction was sent.': '质押金库已暂停，未发送交易。',
  'This amount exceeds your sIMD balance.': '此数量超过您的 sIMD 余额。',
  'This sIMD cannot be withdrawn yet. Refresh after the next Ethereum block.': '此 sIMD 暂时无法赎回，请在下一个以太坊区块产生后刷新。',
  'This amount is too small to return any IMD. Choose a larger amount.': '此数量过小，无法兑换任何 IMD，请增加数量。',
  'This amount exceeds your IMD balance.': '此数量超过您的 IMD 余额。',
  'The staking vault cannot accept this IMD amount right now.': '质押金库暂时无法接受此 IMD 数量。',
  'This amount is too small to receive any sIMD. Choose a larger amount.': '此数量过小，无法获得任何 sIMD，请增加数量。',
  'Approve this IMD amount first, then choose Stake IMD.': '请先授权此 IMD 数量，再选择存入 IMD。',
  'Ethereum could not confirm that this action can succeed. Refresh and review your balance before trying again.': '以太坊无法确认此操作能否成功，请刷新并核对余额后重试。',
  'The network fee could not be checked. No transaction was sent.': '无法核实网络手续费，未发送交易。',
  'This action would not return the expected tokens. No transaction was sent.': '此操作无法返回预期代币，未发送交易。',
  'Your wallet needs more ETH to cover the estimated Ethereum network fee.': '您的钱包需要更多 ETH 来支付预计的以太坊网络手续费。',
  'Your transaction was changed or cancelled in your wallet. The staking action was not confirmed.': '此交易已在钱包中更改或取消，质押操作未获确认。',
  'Ethereum confirmed that this transaction did not complete. Your tokens were not staked or withdrawn by this transaction.': '以太坊已确认此交易未完成，本次交易没有质押或提取您的代币。',
  'This transaction receipt could not be verified. Keep its hash and check again.': '无法验证此交易回执，请保留交易哈希并再次查询。',
  'This transaction receipt predates your staking request. Keep its hash and check it on Etherscan.': '此交易回执早于您的质押请求，请保留交易哈希并在 Etherscan 上核查。',
  'The confirmed token movement could not be verified. Keep its hash and check again.': '无法验证已确认的代币转移，请保留交易哈希并再次查询。',
  'Ethereum is updating this receipt. Keep its hash and check again.': '以太坊正在更新此回执，请保留交易哈希并再次查询。',
  'The expected token movement could not be verified. Keep the transaction hash and check again.': '无法验证预期的代币转移，请保留交易哈希并再次查询。',
  'Ethereum is still confirming this transaction. Keep its hash and check again.': '以太坊仍在确认此交易，请保留交易哈希并再次查询。',
  'The replacement transaction could not be matched to your original request. Keep its hash and check again.': '无法确认替换交易是否对应您的原始请求，请保留交易哈希并再次查询。',
  'This transaction has been sent, but its outcome could not be verified yet. Keep the hash and check again before sending another transaction.': '此交易已发送，但暂时无法验证结果。请保留交易哈希并再次查询，再决定是否发送另一笔交易。',
  'Ethereum data is unavailable. No transaction was sent. Try again shortly.': '暂时无法读取以太坊数据，未发送交易，请稍后重试。',
  'Your wallet did not return a valid transaction hash. Check your wallet activity before trying again.': '钱包未返回有效的交易哈希，请先查看钱包活动记录，再尝试操作。',
  'Your transaction has been sent. Keep its hash and check its outcome before sending another transaction.': '您的交易已发送，请保留交易哈希并核实结果后，再发送另一笔交易。',
  'You declined the request in your wallet. No transaction was sent by Kaori.': '您已在钱包中拒绝请求，Kaori 未发送交易。',
  'The wallet could not complete this request. Check your wallet activity before trying again.': '钱包无法完成此请求，请先查看钱包活动记录，再尝试操作。',
};

function walletMessage(failure: unknown) {
  const error = failure as { message?: string; code?: number };
  if (error?.code === 4001) return 'You declined the wallet request. No new transaction was submitted.';
  if (error?.code === -32002) return 'A wallet request is already open. Check your wallet first.';
  return typeof error?.message === 'string' ? error.message : 'The wallet could not complete this request. Please try again.';
}

function restoredPending(): StakingIntent | null {
  try { return parsePendingStaking(JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null')); } catch { return null; }
}

export default function StakingDesk() {
  const { t, locale } = useLanguage();
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<WalletChoice | null>(null);
  const [account, setAccount] = useState('');
  const [chain, setChain] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'deposit' | 'redeem'>('deposit');
  const [amount, setAmount] = useState('');
  const [reading, setReading] = useState<StakingReading | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState<TransactionState | null>(null);
  const [pending, setPending] = useState<StakingIntent | null>(restoredPending);
  const [needsWalletReview, setNeedsWalletReview] = useState(() => { try { return sessionStorage.getItem(REVIEW_KEY) === 'true'; } catch { return false; } });
  const contextRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  function translatedError(message: string) {
    if (stakingMessages[message]) return t(message, stakingMessages[message]);
    const decimals = /^This token supports up to (18|24) decimal places\. Extra digits cannot be rounded away\.$/.exec(message);
    if (decimals) return t(message, `此代币最多支持 ${decimals[1]} 位小数，不能舍去多余的小数位。`);
    return `${t('Source message:', '数据来源提示：')} ${message}`;
  }
  function walletName(wallet: WalletChoice) { return wallet.id === 'injected' ? t('Browser wallet', '浏览器钱包') : wallet.name; }

  let rawAmount: string | null = null;
  let amountError = '';
  if (amount.trim()) {
    try { rawAmount = parseStakingAmount(amount, mode === 'deposit' ? IMD_DECIMALS : SIMD_DECIMALS); }
    catch (failure) { amountError = walletMessage(failure); }
  }
  const connectedMainnet = !!account && chain === '0x1';
  const owner = connectedMainnet ? account : null;
  const quoteMode = owner && rawAmount ? mode : null;
  const quoteAmount = quoteMode ? rawAmount : null;

  useEffect(() => {
    mountedRef.current = true;
    function announce(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (!detail || !detail.provider || typeof detail.provider.request !== 'function' || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string') return;
      const choice = { id: detail.info.uuid.slice(0, 100), name: detail.info.name.slice(0, 60), provider: detail.provider as Provider };
      setWallets(previous => previous.some(wallet => wallet.provider === choice.provider || wallet.id === choice.id) ? previous : [...previous.filter(wallet => wallet.id !== 'injected'), choice].slice(0, 12));
    }
    function legacyProvider() {
      const provider = (window as Window & { ethereum?: Provider }).ethereum;
      if (provider && typeof provider.request === 'function') setWallets(previous => previous.length ? previous : [{ id: 'injected', name: 'Browser wallet', provider }]);
    }
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    legacyProvider();
    window.addEventListener('ethereum#initialized', legacyProvider);
    return () => { mountedRef.current = false; contextRef.current += 1; requestRef.current?.abort(); window.removeEventListener('eip6963:announceProvider', announce); window.removeEventListener('ethereum#initialized', legacyProvider); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const provider = selected.provider;
    function accountsChanged(accounts: unknown) {
      contextRef.current += 1;
      const next = Array.isArray(accounts) && isStakingAddress(accounts[0]) ? String(accounts[0]).toLowerCase() : '';
      requestRef.current?.abort(); setAccount(next); setReading(null); setAmount(''); setWalletError('');
    }
    function chainChanged(next: unknown) { contextRef.current += 1; requestRef.current?.abort(); setChain(typeof next === 'string' ? next.toLowerCase() : ''); setReading(null); setWalletError(''); }
    function disconnected() { contextRef.current += 1; requestRef.current?.abort(); setAccount(''); setChain(''); setReading(null); setAmount(''); }
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected); };
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController(); requestRef.current = controller;
    const timer = setTimeout(async () => {
      setReadingBusy(true); setReadError('');
      const params = new URLSearchParams();
      if (owner) params.set('owner', owner);
      if (quoteMode && quoteAmount) { params.set('mode', quoteMode); params.set('amount', quoteAmount); }
      try {
        const response = await fetch(`/api/staking${params.size ? `?${params}` : ''}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Ethereum staking data is unavailable. Please try again.');
        const verified = parseStakingReading(data, owner, quoteMode, quoteAmount);
        if (!controller.signal.aborted) setReading(verified);
      } catch (failure) { if (!controller.signal.aborted) { setReading(null); setReadError(walletMessage(failure)); } }
      finally { if (!controller.signal.aborted) setReadingBusy(false); }
    }, quoteMode ? 550 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [owner, quoteMode, quoteAmount, refresh]);

  function clearReading() { requestRef.current?.abort(); setReading(null); setReadError(''); setWalletError(''); contextRef.current += 1; }
  function changeAmount(value: string) { clearReading(); setAmount(value); }
  function changeMode(next: 'deposit' | 'redeem') { clearReading(); setMode(next); setAmount(''); }
  function refreshReading() { clearReading(); setRefresh(value => value + 1); }

  async function connect(wallet: WalletChoice) {
    if (busyRef.current || connecting) return;
    setConnecting(true); setWalletError('');
    const generation = ++contextRef.current;
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
      const network = await wallet.provider.request({ method: 'eth_chainId' });
      if (generation !== contextRef.current || !mountedRef.current) return;
      if (!Array.isArray(accounts) || !isStakingAddress(accounts[0])) throw new Error('Your wallet did not provide an Ethereum address.');
      setSelected(wallet); setAccount(String(accounts[0]).toLowerCase()); setChain(typeof network === 'string' ? network.toLowerCase() : '');
      setReading(null); setChoosing(false); setAmount('');
    } catch (failure) { if (mountedRef.current) setWalletError(walletMessage(failure)); }
    finally { if (mountedRef.current) setConnecting(false); }
  }

  function disconnect() { contextRef.current += 1; requestRef.current?.abort(); setSelected(null); setAccount(''); setChain(''); setReading(null); setAmount(''); setWalletError(''); }
  async function switchNetwork() {
    if (!selected || busyRef.current) return;
    setWalletError(''); setConnecting(true);
    try {
      await selected.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
      const network = await selected.provider.request({ method: 'eth_chainId' });
      contextRef.current += 1; setChain(typeof network === 'string' ? network.toLowerCase() : ''); setReading(null); setRefresh(value => value + 1);
    } catch (failure) { setWalletError(walletMessage(failure)); }
    finally { setConnecting(false); }
  }

  function rememberPending(intent: StakingIntent | null) {
    if (mountedRef.current) setPending(intent);
    try { if (intent) sessionStorage.setItem(PENDING_KEY, JSON.stringify(intent)); else sessionStorage.removeItem(PENDING_KEY); } catch { /* The transaction link stays visible if browser storage is unavailable. */ }
  }
  function rememberWalletReview(required: boolean) {
    if (mountedRef.current) setNeedsWalletReview(required);
    try { if (required) sessionStorage.setItem(REVIEW_KEY, 'true'); else sessionStorage.removeItem(REVIEW_KEY); } catch { /* Preserve the review barrier for the current visit. */ }
  }
  function progress(update: TransactionState) {
    // Persist before opening the wallet: a reload must not invite a duplicate submission.
    if (update.stage === 'wallet') rememberWalletReview(true);
    const intent = parsePendingStaking(update);
    if (intent && update.stage === 'pending') { rememberPending(intent); rememberWalletReview(false); }
    if (mountedRef.current) setTransaction(update);
  }

  async function transact(action: 'approve' | 'deposit' | 'redeem') {
    if (busyRef.current || pending || needsWalletReview || !selected || !connectedMainnet || !rawAmount || !reading?.wallet || !reading.quote || reading.quote.amountRaw !== rawAmount || reading.quote.mode !== mode) return;
    if (Date.now() - Date.parse(reading.retrievedAt) > 45_000) { setWalletError('Refresh the quote before opening your wallet.'); return; }
    const generation = contextRef.current;
    const capturedAccount = account;
    busyRef.current = true; setBusy(true); setWalletError(''); setTransaction({ stage: 'checking', action });
    try {
      const { executeStakingTransaction } = await import('./staking-wallet.mjs');
      const result = await executeStakingTransaction({ provider: selected.provider, account: capturedAccount, action, amountRaw: rawAmount,
        isCurrent: () => mountedRef.current && contextRef.current === generation,
        onProgress: progress });
      rememberPending(null); rememberWalletReview(false);
      if (!mountedRef.current) return;
      setTransaction({ stage: 'confirmed', ...result });
      if (generation === contextRef.current && action !== 'approve') setAmount('');
      setReading(null); setRefresh(value => value + 1);
    } catch (failure) {
      const error = failure as { intent?: unknown; terminal?: boolean; code?: string };
      const intent = parsePendingStaking(error.intent);
      const unknown = error.code === 'unknown_broadcast' || error.code === 'wallet_error';
      rememberPending(intent && !error.terminal ? intent : null); rememberWalletReview(unknown);
      if (!mountedRef.current) return;
      setTransaction({ stage: intent && !error.terminal ? 'pending' : unknown ? 'review' : 'failed', ...(intent ?? {}), action });
      setWalletError(walletMessage(failure)); setReading(null); setRefresh(value => value + 1);
    } finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  }

  async function checkPending() {
    if (!pending || busyRef.current) return;
    busyRef.current = true; setBusy(true); setWalletError('');
    try {
      const { trackStakingTransaction } = await import('./staking-wallet.mjs');
      const result = await trackStakingTransaction(pending, progress);
      rememberPending(null); rememberWalletReview(false);
      if (mountedRef.current) { setTransaction({ stage: 'confirmed', ...result }); setReading(null); setRefresh(value => value + 1); }
    } catch (failure) {
      const error = failure as { terminal?: boolean; intent?: unknown };
      const intent = parsePendingStaking(error.intent) ?? pending;
      if (error.terminal) { rememberPending(null); rememberWalletReview(false); }
      else rememberPending(intent);
      if (!mountedRef.current) return;
      if (error.terminal) setTransaction({ stage: 'failed', ...intent });
      setWalletError(walletMessage(failure));
    } finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  }

  const position = connectedMainnet && reading?.wallet?.address === account ? reading.wallet : null;
  const validQuote = !!position && !!reading?.quote && reading.quote.mode === mode && reading.quote.amountRaw === rawAmount;
  const exceedsBalance = position && rawAmount ? BigInt(rawAmount) > BigInt(mode === 'deposit' ? position.imdBalanceRaw : position.shareBalanceRaw) : false;
  const exceedsLimit = position && rawAmount ? BigInt(rawAmount) > BigInt(mode === 'deposit' ? position.maxDepositRaw : position.maxRedeemRaw) : false;
  const needsApproval = !!position && !!rawAmount && BigInt(position.allowanceRaw) < BigInt(rawAmount);
  const action = mode === 'redeem' ? 'redeem' : needsApproval ? 'approve' : 'deposit';
  const canSend = connectedMainnet && validQuote && !readingBusy && !busy && !pending && !needsWalletReview && !exceedsBalance && !exceedsLimit && !reading?.paused && reading?.quote?.outputRaw !== '0' && position?.ethBalanceRaw !== '0';
  const lastTransaction = pending ? { stage: 'pending', ...pending } : transaction;
  const transactionLabel = lastTransaction?.action === 'approve' ? t('Approval', '授权') : lastTransaction?.action === 'redeem' ? t('Withdrawal', '赎回') : t('Deposit', '存入');

  return <section className="staking-section" id="staking" aria-labelledby="staking-heading"><div className="container">
    <ToolHeading id="staking-heading" title={t('IMD staking', 'IMD 质押')} subtitle={t('Deposit IMD and redeem sIMD through the official POOL4 vault.', '通过官方 POOL4 金库存入 IMD 并赎回 sIMD。')} bubble={t('Your shares. Your wallet!', '您的份额，由您的钱包持有！')} />
    <div className="staking-layout"><div className="staking-workspace">
      <div className="staking-card">
        <div className="staking-card-head"><span className="eyebrow">IMD / sIMD</span><span className="staking-network"><span className="pixel-dot" /> {t('ETHEREUM MAINNET', '以太坊主网')}</span></div>
        <div className="staking-wallet-bar">{account ? <><div><span className="data-label">{selected ? walletName(selected) : t('Connected wallet', '已连接的钱包')}</span><a href={`https://etherscan.io/address/${account}`} target="_blank" rel="noreferrer" title={account}>{shortAddress(account)} ↗</a></div><button className="source-link" onClick={disconnect} disabled={connecting}>{t('Disconnect', '断开连接')}</button></> : <><p>{t('Your shares go to your connected wallet.', '您的份额将发送至当前连接的钱包。')}</p><button className="button dark small" disabled={connecting || busy} onClick={() => { setChoosing(value => !value); window.dispatchEvent(new Event('eip6963:requestProvider')); }}>{t('Connect wallet ↗', '连接钱包 ↗')}</button></>}</div>
        {choosing && <div className="staking-wallet-choices" aria-label={t('Choose your wallet', '选择您的钱包')}>{wallets.length ? wallets.map(wallet => <button key={wallet.id} className="button secondary small" disabled={connecting} onClick={() => void connect(wallet)}>{connecting ? t('Check your wallet…', '请查看您的钱包…') : t(`Use ${walletName(wallet)}`, `使用 ${walletName(wallet)}`)}</button>) : <p className="input-help">{t("No Ethereum wallet was found in this browser. Use your browser wallet extension, or open Kaori in your wallet's mobile browser.", '此浏览器未检测到以太坊钱包。请使用浏览器钱包扩展，或在手机钱包的内置浏览器中打开 Kaori。')}</p>}</div>}
        {account && !connectedMainnet && <div className="staking-network-prompt"><p>{t('Switch your wallet to Ethereum mainnet to use IMD staking.', '请将钱包切换至以太坊主网，以使用 IMD 质押。')}</p><button className="button secondary small" disabled={connecting || busy} onClick={() => void switchNetwork()}>{connecting ? t('Check your wallet…', '请查看您的钱包…') : t('Switch to Ethereum', '切换至以太坊')}</button></div>}
        <div className="staking-tabs" aria-label={t('Staking action', '质押操作')}><button aria-pressed={mode === 'deposit'} disabled={busy} onClick={() => changeMode('deposit')}>{t('Deposit IMD', '存入 IMD')}</button><button aria-pressed={mode === 'redeem'} disabled={busy} onClick={() => changeMode('redeem')}>{t('Withdraw IMD', '赎回 IMD')}</button></div>
        <div className="staking-form"><label className="field-label" htmlFor="staking-amount">{mode === 'deposit' ? t('IMD to deposit', '存入的 IMD 数量') : t('sIMD shares to redeem', '赎回的 sIMD 份额')}</label><div className="staking-amount-row"><input id="staking-amount" className="approval-input" inputMode="decimal" autoComplete="off" value={amount} maxLength={104} placeholder={t('Enter amount', '输入数量')} onChange={event => changeAmount(event.target.value)} disabled={busy} aria-describedby="staking-amount-help" /><span>{mode === 'deposit' ? 'IMD' : 'sIMD'}</span></div>
          <div className="staking-balance-line"><span>{position ? `${t('Available:', '可用：')} ${fmt(mode === 'deposit' ? position.imdBalanceRaw : position.shareBalanceRaw, mode === 'deposit' ? 18 : 24)} ${mode === 'deposit' ? 'IMD' : 'sIMD'}` : t('Connect on Ethereum to read your balance.', '请在以太坊主网上连接钱包，以读取余额。')}</span>{position && <button className="source-link" disabled={busy || pending !== null} onClick={() => { const balance = BigInt(mode === 'deposit' ? position.imdBalanceRaw : position.shareBalanceRaw); const limit = BigInt(mode === 'deposit' ? position.maxDepositRaw : position.maxRedeemRaw); changeAmount(fmt(balance < limit ? balance : limit, mode === 'deposit' ? 18 : 24)); }}>{t('Max', '最大')}</button>}</div>
          <p className="input-help" id="staking-amount-help">{mode === 'deposit' ? t('Your first deposit may need a separate IMD approval. Kaori requests only the amount you enter.', '首次存入可能需要单独授权 IMD。Kaori 仅申请您输入的数量。') : t('Choose how many sIMD shares to exchange back into IMD. Receiving new shares can require waiting until the next Ethereum block.', '请选择要兑换回 IMD 的 sIMD 份额数量。收到新份额后，可能需要等待下一个以太坊区块才能赎回。')}</p>
          <div className="staking-quote" aria-live="polite"><span className="data-label">{mode === 'deposit' ? t('Quoted shares received', '预计收到的份额') : t('Quoted IMD received', '预计收到的 IMD')}</span><p>{validQuote && reading?.quote ? <><strong>{fmt(reading.quote.outputRaw, mode === 'deposit' ? 24 : 18)}</strong> {mode === 'deposit' ? 'sIMD' : 'IMD'}</> : readingBusy && owner ? t('Reading the vault…', '正在读取金库…') : t('Enter an amount to get a current quote.', '输入数量以获取当前报价。')}</p><span className="input-help">{t('The final amount can change before your transaction is included. This vault has no minimum-output guarantee.', '交易被打包前，最终数量可能发生变化。此金库不保证最低到账数量。')}</span></div>
          {amountError && <p className="status-message error" role="alert">{translatedError(amountError)}</p>}
          {reading?.paused && <p className="status-message error" role="alert">{t('The vault is paused. Deposits and withdrawals are unavailable.', '金库已暂停，暂时无法存入或赎回。')}</p>}
          {exceedsBalance && <p className="status-message error" role="alert">{t(`The amount exceeds your available ${mode === 'deposit' ? 'IMD' : 'sIMD'} balance.`, `此数量超过您可用的 ${mode === 'deposit' ? 'IMD' : 'sIMD'} 余额。`)}</p>}
          {exceedsLimit && !exceedsBalance && !reading?.paused && <p className="status-message error" role="alert">{mode === 'redeem' && position?.lastDepositBlock === reading?.snapshotBlockNumber ? t('Your shares are in their one-block hold. Refresh after the next Ethereum block.', '您的份额处于一个区块的等待期，请在下一个以太坊区块产生后刷新。') : t('The vault cannot accept this amount right now.', '金库暂时无法接受此数量。')}</p>}
          {validQuote && reading?.quote?.outputRaw === '0' && <p className="status-message error" role="alert">{t('This amount is too small to receive any output. Enter a larger amount.', '此数量过小，无法获得任何代币，请增加数量。')}</p>}
          {position?.ethBalanceRaw === '0' && <p className="input-help">{t('Your wallet needs ETH to pay the Ethereum network fee.', '您的钱包需要 ETH 来支付以太坊网络手续费。')}</p>}
          <button className="button primary staking-submit" disabled={!canSend} onClick={() => void transact(action)}>{busy ? t('Check transaction status below…', '请查看下方的交易状态…') : mode === 'redeem' ? t('Withdraw IMD ↗', '赎回 IMD ↗') : needsApproval ? t('Approve this IMD amount ↗', '授权此 IMD 数量 ↗') : t('Deposit IMD ↗', '存入 IMD ↗')}</button>
          <p className="input-help">{t('Ethereum gas is paid in ETH. Your wallet shows the fee and asks you to confirm each transaction.', '以太坊网络手续费以 ETH 支付。钱包会显示费用，并要求您逐笔确认交易。')}</p>
          {walletError && <p className="status-message error" role="alert">{translatedError(walletError)}</p>}
          {needsWalletReview && <div className="staking-wallet-review"><p className="input-help">{t("Check your wallet's activity for a submitted or pending transaction before trying again.", '再次尝试前，请查看钱包活动记录中是否已有已提交或待确认的交易。')}</p><button className="button secondary small" disabled={busy} onClick={() => { rememberWalletReview(false); refreshReading(); }}>{t('I have checked my wallet activity', '我已查看钱包活动记录')}</button></div>}
        </div>
      </div>
      {lastTransaction && <div className={`staking-transaction ${lastTransaction.stage === 'confirmed' ? 'staking-confirmed' : ''}`} aria-live="polite"><span className="data-label">{t('TRANSACTION STATUS', '交易状态')}</span><h3>{lastTransaction.stage === 'confirmed' ? t(`${transactionLabel} confirmed`, `${transactionLabel}已确认`) : lastTransaction.stage === 'wallet' ? t('Confirm in your wallet', '请在钱包中确认') : lastTransaction.stage === 'checking' ? t('Checking your transaction', '正在核查您的交易') : lastTransaction.stage === 'review' ? t('Check your wallet activity', '请查看钱包活动记录') : lastTransaction.stage === 'failed' ? t(`${transactionLabel} not completed`, `${transactionLabel}未完成`) : t('Waiting for confirmation', '等待确认')}</h3>{lastTransaction.hash && <a className="source-link staking-hash" href={`https://etherscan.io/tx/${lastTransaction.hash}`} target="_blank" rel="noreferrer">{lastTransaction.hash} ↗</a>}{lastTransaction.account && <p className="input-help">{t('Wallet:', '钱包：')} {shortAddress(lastTransaction.account)}</p>}{lastTransaction.stage === 'confirmed' && lastTransaction.action === 'approve' ? <p>{t('Approval is confirmed. Review your current quote, then select ', '授权已确认。请核对当前报价，然后选择')}<strong>{t('Deposit IMD', '存入 IMD')}</strong>{t(' to stake.', '进行质押。')}</p> : lastTransaction.stage === 'confirmed' && lastTransaction.assetsRaw && lastTransaction.sharesRaw ? <p>{fmt(lastTransaction.assetsRaw, 18)} IMD {lastTransaction.action === 'deposit' ? t('deposited for', '已存入，获得') : t('received for', '已收到，赎回了')} {fmt(lastTransaction.sharesRaw, 24)} sIMD{t('.', '。')}</p> : null}{pending && <><p className="input-help">{t('The transaction was submitted. Check its status before starting another operation.', '交易已提交，请先核实状态，再开始另一项操作。')}</p><button className="button secondary small" onClick={() => void checkPending()} disabled={busy}>{busy ? t('Checking Ethereum…', '正在查询以太坊…') : t('Check confirmation', '查询确认状态')}</button></>}</div>}
      <div className="staking-position"><div className="staking-position-head"><h3>{t('Your staking position', '您的质押持仓')}</h3><button className="source-link" disabled={busy || readingBusy} onClick={refreshReading}>{t('Refresh ↻', '刷新 ↻')}</button></div>{position ? <dl className="staking-stats"><div><dt>{t('sIMD in your wallet', '钱包中的 sIMD')}</dt><dd>{fmt(position.shareBalanceRaw, 24)} <span>sIMD</span></dd></div><div><dt>{t('Current redemption value', '当前可赎回价值')}</dt><dd>{fmt(position.redeemableAssetsRaw, 18)} <span>IMD</span></dd></div></dl> : <p className="input-help">{t('Connect your wallet on Ethereum to see your actual sIMD balance and its current IMD value.', '在以太坊主网上连接钱包，即可查看您的实际 sIMD 余额及其当前 IMD 价值。')}</p>}{readError && <p className="status-message error" role="alert">{translatedError(readError)}</p>}</div>
    </div><aside className="staking-guide"><div className="staking-share-art" aria-hidden="true"><span>sIMD</span><span>↳ IMD</span></div><p className="eyebrow">{t('YOUR SHARES. YOUR WALLET.', '您的份额，由您的钱包持有。')}</p><h3>{t('One vault.', '一个金库。')}<br />{t('A clear way back.', '清晰的赎回路径。')}</h3><ol><li><strong>{t('Deposit IMD.', '存入 IMD。')}</strong> {t('The official vault sends sIMD shares to your wallet.', '官方金库将 sIMD 份额发送至您的钱包。')}</li><li><strong>{t('Hold your shares.', '持有您的份额。')}</strong> {t('Their IMD value follows the assets in the vault. No separate reward claim is needed.', '份额的 IMD 价值随金库资产变化，无需单独领取奖励。')}</li><li><strong>{t('Withdraw here.', '在这里赎回。')}</strong> {t('Redeem your sIMD and receive IMD in the same wallet.', '赎回 sIMD，IMD 将返回同一个钱包。')}</li></ol>{reading && <div className="staking-vault-reading"><span className="data-label">{t('CURRENT VAULT READING', '当前金库数据')}</span><p>1 sIMD = <strong>{fmt(reading.assetsPerShareRaw, 18)} IMD</strong></p><p className="input-help">{reading.owner === ZERO_ADDRESS ? t('Vault ownership renounced.', '金库所有权已放弃。') : t('The vault owner can pause it and move its assets.', '金库所有者可暂停金库并转移其中的资产。')} {t('Read at block', '读取时的区块')} <a href={`https://etherscan.io/block/${reading.snapshotBlockNumber}`} target="_blank" rel="noreferrer">{reading.snapshotBlockNumber} ↗</a>, {new Date(reading.retrievedAt).toLocaleTimeString(locale, { timeZone: 'UTC', hour12: false })} UTC · {reading.provider}.</p></div>}<p className="staking-protocol-note">{t('POOL4 describes this protocol as unaudited. Smart-contract failures can put funds at risk. Rewards and future returns are not guaranteed.', 'POOL4 说明此协议未经审计。智能合约故障可能危及资金安全，奖励和未来收益均不保证。')}</p><div className="staking-source-links"><a href="https://pool4.imd.fun/docs#staking" target="_blank" rel="noreferrer">{t('Official staking details ↗', '官方质押详情 ↗')}</a><a href={`https://etherscan.io/address/${STAKING_VAULT}#code`} target="_blank" rel="noreferrer">{t('Verified sIMD vault ↗', '已验证的 sIMD 金库 ↗')}</a></div><p className="input-help staking-vault-address">{t('Official POOL4 vault', '官方 POOL4 金库')}<br />{STAKING_VAULT}</p></aside></div>
  </div></section>;
}
