import { useEffect, useRef, useState } from 'react';
import ToolHeading from './ToolHeading';
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
  const transactionLabel = lastTransaction?.action === 'approve' ? 'Approval' : lastTransaction?.action === 'redeem' ? 'Withdrawal' : 'Deposit';

  return <section className="staking-section" id="staking" aria-labelledby="staking-heading"><div className="container">
    <ToolHeading id="staking-heading" title="IMD staking" subtitle="Deposit IMD and redeem sIMD through the official POOL4 vault." bubble="Your shares. Your wallet!" />
    <div className="staking-layout"><div className="staking-workspace">
      <div className="staking-card">
        <div className="staking-card-head"><span className="eyebrow">IMD / sIMD</span><span className="staking-network"><span className="pixel-dot" /> ETHEREUM MAINNET</span></div>
        <div className="staking-wallet-bar">{account ? <><div><span className="data-label">{selected?.name ?? 'Connected wallet'}</span><a href={`https://etherscan.io/address/${account}`} target="_blank" rel="noreferrer" title={account}>{shortAddress(account)} ↗</a></div><button className="source-link" onClick={disconnect} disabled={connecting}>Disconnect</button></> : <><p>Your shares go to your connected wallet.</p><button className="button dark small" disabled={connecting || busy} onClick={() => { setChoosing(value => !value); window.dispatchEvent(new Event('eip6963:requestProvider')); }}>Connect wallet ↗</button></>}</div>
        {choosing && <div className="staking-wallet-choices" aria-label="Choose your wallet">{wallets.length ? wallets.map(wallet => <button key={wallet.id} className="button secondary small" disabled={connecting} onClick={() => void connect(wallet)}>{connecting ? 'Check your wallet…' : `Use ${wallet.name}`}</button>) : <p className="input-help">No Ethereum wallet was found in this browser. Use your browser wallet extension, or open Kaori in your wallet's mobile browser.</p>}</div>}
        {account && !connectedMainnet && <div className="staking-network-prompt"><p>Switch your wallet to Ethereum mainnet to use IMD staking.</p><button className="button secondary small" disabled={connecting || busy} onClick={() => void switchNetwork()}>{connecting ? 'Check your wallet…' : 'Switch to Ethereum'}</button></div>}
        <div className="staking-tabs" aria-label="Staking action"><button aria-pressed={mode === 'deposit'} disabled={busy} onClick={() => changeMode('deposit')}>Deposit IMD</button><button aria-pressed={mode === 'redeem'} disabled={busy} onClick={() => changeMode('redeem')}>Withdraw IMD</button></div>
        <div className="staking-form"><label className="field-label" htmlFor="staking-amount">{mode === 'deposit' ? 'IMD to deposit' : 'sIMD shares to redeem'}</label><div className="staking-amount-row"><input id="staking-amount" className="approval-input" inputMode="decimal" autoComplete="off" value={amount} maxLength={104} placeholder="Enter amount" onChange={event => changeAmount(event.target.value)} disabled={busy} aria-describedby="staking-amount-help" /><span>{mode === 'deposit' ? 'IMD' : 'sIMD'}</span></div>
          <div className="staking-balance-line"><span>{position ? `Available: ${fmt(mode === 'deposit' ? position.imdBalanceRaw : position.shareBalanceRaw, mode === 'deposit' ? 18 : 24)} ${mode === 'deposit' ? 'IMD' : 'sIMD'}` : 'Connect on Ethereum to read your balance.'}</span>{position && <button className="source-link" disabled={busy || pending !== null} onClick={() => { const balance = BigInt(mode === 'deposit' ? position.imdBalanceRaw : position.shareBalanceRaw); const limit = BigInt(mode === 'deposit' ? position.maxDepositRaw : position.maxRedeemRaw); changeAmount(fmt(balance < limit ? balance : limit, mode === 'deposit' ? 18 : 24)); }}>Max</button>}</div>
          <p className="input-help" id="staking-amount-help">{mode === 'deposit' ? 'Your first deposit may need a separate IMD approval. Kaori requests only the amount you enter.' : 'Choose how many sIMD shares to exchange back into IMD. Receiving new shares can require waiting until the next Ethereum block.'}</p>
          <div className="staking-quote" aria-live="polite"><span className="data-label">{mode === 'deposit' ? 'Quoted shares received' : 'Quoted IMD received'}</span><p>{validQuote && reading?.quote ? <><strong>{fmt(reading.quote.outputRaw, mode === 'deposit' ? 24 : 18)}</strong> {mode === 'deposit' ? 'sIMD' : 'IMD'}</> : readingBusy && owner ? 'Reading the vault…' : 'Enter an amount to get a current quote.'}</p><span className="input-help">The final amount can change before your transaction is included. This vault has no minimum-output guarantee.</span></div>
          {amountError && <p className="status-message error" role="alert">{amountError}</p>}
          {reading?.paused && <p className="status-message error" role="alert">The vault is paused. Deposits and withdrawals are unavailable.</p>}
          {exceedsBalance && <p className="status-message error" role="alert">The amount exceeds your available {mode === 'deposit' ? 'IMD' : 'sIMD'} balance.</p>}
          {exceedsLimit && !exceedsBalance && !reading?.paused && <p className="status-message error" role="alert">{mode === 'redeem' && position?.lastDepositBlock === reading?.snapshotBlockNumber ? 'Your shares are in their one-block hold. Refresh after the next Ethereum block.' : 'The vault cannot accept this amount right now.'}</p>}
          {validQuote && reading?.quote?.outputRaw === '0' && <p className="status-message error" role="alert">This amount is too small to receive any output. Enter a larger amount.</p>}
          {position?.ethBalanceRaw === '0' && <p className="input-help">Your wallet needs ETH to pay the Ethereum network fee.</p>}
          <button className="button primary staking-submit" disabled={!canSend} onClick={() => void transact(action)}>{busy ? 'Check transaction status below…' : mode === 'redeem' ? 'Withdraw IMD ↗' : needsApproval ? 'Approve this IMD amount ↗' : 'Deposit IMD ↗'}</button>
          <p className="input-help">Ethereum gas is paid in ETH. Your wallet shows the fee and asks you to confirm each transaction.</p>
          {walletError && <p className="status-message error" role="alert">{walletError}</p>}
          {needsWalletReview && <div className="staking-wallet-review"><p className="input-help">Check your wallet's activity for a submitted or pending transaction before trying again.</p><button className="button secondary small" disabled={busy} onClick={() => { rememberWalletReview(false); refreshReading(); }}>I have checked my wallet activity</button></div>}
        </div>
      </div>
      {lastTransaction && <div className={`staking-transaction ${lastTransaction.stage === 'confirmed' ? 'staking-confirmed' : ''}`} aria-live="polite"><span className="data-label">TRANSACTION STATUS</span><h3>{lastTransaction.stage === 'confirmed' ? `${transactionLabel} confirmed` : lastTransaction.stage === 'wallet' ? 'Confirm in your wallet' : lastTransaction.stage === 'checking' ? 'Checking your transaction' : lastTransaction.stage === 'review' ? 'Check your wallet activity' : lastTransaction.stage === 'failed' ? `${transactionLabel} not completed` : 'Waiting for confirmation'}</h3>{lastTransaction.hash && <a className="source-link staking-hash" href={`https://etherscan.io/tx/${lastTransaction.hash}`} target="_blank" rel="noreferrer">{lastTransaction.hash} ↗</a>}{lastTransaction.account && <p className="input-help">Wallet: {shortAddress(lastTransaction.account)}</p>}{lastTransaction.stage === 'confirmed' && lastTransaction.action === 'approve' ? <p>Approval is confirmed. Review your current quote, then select <strong>Deposit IMD</strong> to stake.</p> : lastTransaction.stage === 'confirmed' && lastTransaction.assetsRaw && lastTransaction.sharesRaw ? <p>{fmt(lastTransaction.assetsRaw, 18)} IMD {lastTransaction.action === 'deposit' ? 'deposited for' : 'received for'} {fmt(lastTransaction.sharesRaw, 24)} sIMD.</p> : null}{pending && <><p className="input-help">The transaction was submitted. Check its status before starting another operation.</p><button className="button secondary small" onClick={() => void checkPending()} disabled={busy}>{busy ? 'Checking Ethereum…' : 'Check confirmation'}</button></>}</div>}
      <div className="staking-position"><div className="staking-position-head"><h3>Your staking position</h3><button className="source-link" disabled={busy || readingBusy} onClick={refreshReading}>Refresh ↻</button></div>{position ? <dl className="staking-stats"><div><dt>sIMD in your wallet</dt><dd>{fmt(position.shareBalanceRaw, 24)} <span>sIMD</span></dd></div><div><dt>Current redemption value</dt><dd>{fmt(position.redeemableAssetsRaw, 18)} <span>IMD</span></dd></div></dl> : <p className="input-help">Connect your wallet on Ethereum to see your actual sIMD balance and its current IMD value.</p>}{readError && <p className="status-message error" role="alert">{readError}</p>}</div>
    </div><aside className="staking-guide"><div className="staking-share-art" aria-hidden="true"><span>sIMD</span><span>↳ IMD</span></div><p className="eyebrow">YOUR SHARES. YOUR WALLET.</p><h3>One vault.<br />A clear way back.</h3><ol><li><strong>Deposit IMD.</strong> The official vault sends sIMD shares to your wallet.</li><li><strong>Hold your shares.</strong> Their IMD value follows the assets in the vault. No separate reward claim is needed.</li><li><strong>Withdraw here.</strong> Redeem your sIMD and receive IMD in the same wallet.</li></ol>{reading && <div className="staking-vault-reading"><span className="data-label">CURRENT VAULT READING</span><p>1 sIMD = <strong>{fmt(reading.assetsPerShareRaw, 18)} IMD</strong></p><p className="input-help">{reading.owner === ZERO_ADDRESS ? 'Vault ownership renounced.' : 'The vault owner can pause it and move its assets.'} Read at block <a href={`https://etherscan.io/block/${reading.snapshotBlockNumber}`} target="_blank" rel="noreferrer">{reading.snapshotBlockNumber} ↗</a>, {new Date(reading.retrievedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC · {reading.provider}.</p></div>}<p className="staking-protocol-note">POOL4 describes this protocol as unaudited. Smart-contract failures can put funds at risk. Rewards and future returns are not guaranteed.</p><div className="staking-source-links"><a href="https://pool4.imd.fun/docs#staking" target="_blank" rel="noreferrer">Official staking details ↗</a><a href={`https://etherscan.io/address/${STAKING_VAULT}#code`} target="_blank" rel="noreferrer">Verified sIMD vault ↗</a></div><p className="input-help staking-vault-address">Official POOL4 vault<br />{STAKING_VAULT}</p></aside></div>
  </div></section>;
}
