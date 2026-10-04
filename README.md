# Kaori IMD

A pixel manga desk for real IMD transaction receipts, spending approvals, official IMD staking and public network activity. Built for David, with an ink-blue, cherry-red and warm-ivory identity.

The receipt desk accepts an Ethereum transaction hash. It reads the original transaction, receipt and block, then decodes transfer events emitted by the official IMD contract. Recent transactions come from an actual bounded Ethereum block window. The website starts with an empty personal archive.

## Use Kaori

1. Paste a transaction hash or choose a recent IMD transaction.
2. Read its exact IMD transfer amounts, addresses, block time, confirmations, finality and execution gas fee.
3. Add a note and save a successful IMD receipt to your personal browser archive.
4. Download a readable TXT record, export the receipt as JSON, or back up your notes.

The archive holds up to 30 records. Browser storage is personal to that browser and device. Restoring a notes backup preserves hashes and notes; open each restored record to retrieve current Ethereum data. Imported files do not supply trusted blockchain readings. If browser storage is unavailable, the website keeps records for the current visit and displays an export reminder. Damaged existing browser data is preserved rather than overwritten.

This is an independent IMD project. The receipt desk and Approval Check remain public reads without wallet signing. The staking desk connects a browser wallet and requests only the explicitly chosen staking transaction. An exported record is a timestamped public RPC reading, not a signed certificate of ownership. Confirmations change after the recorded reading. Gas fee is the execution gas cost; possible blob gas fees are outside that field.

## IMD Approval Check

Open **Approval check**, enter your Ethereum wallet address and the application's spender address, then select **Check approval**. The tool reads the remaining official IMD spending allowance for that exact pair. Find the application's spender address in your wallet's approval details or the application's official documentation.

The result distinguishes zero allowance, a finite spending limit and the maximum uint256 approval. Every amount preserves all 18 IMD decimals; the reading includes its block, retrieval time and Ethereum provider. Editing either address clears the previous result. Refresh reading requests another observation; the server can reuse the same pair's observation for up to 15 seconds.

An allowance is permission, not a token balance or a verdict about an application's safety. The tool checks only the two addresses entered; it does not list all of a wallet's approvals. It does not connect a wallet, request a signature, change approvals or send transactions. Provider or verification failure stays unavailable rather than appearing as zero.

## Official IMD staking

The **Staking** desk deposits IMD into the official POOL4 vault at `0x9efa934d9fad4ae28c998a40195646b965a97247`. It receives sIMD shares in the connected wallet and redeems those shares back into IMD from the same wallet. This is the existing official Ethereum vault, separate from Kaori's future token contract.

Connect a compatible Ethereum browser wallet. EIP-6963 discovery lets users choose between installed wallets, with a legacy injected-provider fallback. On mobile, open Kaori in the wallet's browser. An ordinary browser without a wallet provider cannot sign transactions. No WalletConnect account or API key is required.

1. Choose **Deposit IMD**, enter an amount, and review the current sIMD quote.
2. If needed, confirm an approval for only that entered IMD amount. Wait for confirmation, then separately select **Deposit IMD** and confirm in the wallet.
3. Choose **Withdraw IMD**, enter sIMD shares or select **Max**, review the IMD quote, and confirm the redemption in the wallet.

IMD has 18 decimals and sIMD has 24. Inputs and amounts are never rounded through floating-point arithmetic. The vault imposes a one-block redemption hold after shares increase; a fresh `maxRedeem` reading controls availability. All transactions pay Ethereum gas in ETH. The vault has no minimum-output argument: the final amount can change from the displayed preview before inclusion. Kaori does not advertise the official page's launch APR or promise future earnings. POOL4 describes the protocol as unaudited; the UI links its documented risks.

The application verifies the vault's fixed runtime code hash, underlying asset, decimals, chain, pause state, balances and limits. Before prompting the wallet it checks the account/network again, simulates the chosen call and estimates its gas. The wallet signs and submits; the server only reads. An approval never automatically starts a deposit. A submitted hash stays available through account changes and confirmation timeouts, including a session recovery record. Ambiguous wallet outcomes require checking wallet activity before another submission. Confirmation requires two Ethereum confirmations, matching transaction intent, a canonical block and the expected actual token event. Cancellation, revert or a mismatched transaction cannot be reported as a completed stake.

## IMD network desk

The **Network desk** reads Identity.md's official public API. It brings network activity, agent records, jobs and oracle questions into Kaori with their source and retrieval time. These are records from the wider IMD network; displaying a job does not mean Kaori commissioned or produced it.

Use the agent search to find a seat or agent and filter working seats. Search public job objectives or oracle questions, inspect a record, and follow its official source. Lists load in bounded pages. Network counts and per-seat records describe different parts of the protocol and are not interchangeable.

Save agent, job and oracle references with personal notes to a separate watchlist in this browser. It starts empty and is independent of the transaction receipt archive. Reopen a saved reference to get its current status. Export the watchlist to preserve its references and notes; export an individual reading to keep its actual data and retrieval time. Storage failure is reported instead of silently discarding records.

Oracle answers are public protocol results. Signature availability is not a claim that Kaori independently verified the signature, the answer or the evidence. Network API readings are separate from the receipt desk's Ethereum block verification.

The network desk does not submit paid requests or spend from a project wallet. SI-MD was functional inspiration; Kaori uses its own interface and calls the official IMD service directly through its own bounded server endpoint. There is no connection to SI-MD's treasury, token, private memory or paid orders.

## Kaori contract

Kaori's own contract address is not configured. The website displays **Coming Soon**, and copying the contract is disabled while the address is empty. David will supply the address; set the single `KAORI_CONTRACT` value in `src/domain.mjs` when it is available. A valid Ethereum address will then appear with its matching copy button and Etherscan link.

The official IMD token and sIMD staking vault are external contracts, separate from Kaori's future contract. Keeping Kaori's contract empty does not replace or invent either official contract.

## Public links

- Website: https://kaorimd.site/
- Vercel address: https://kaori-imd.vercel.app/
- Source: https://github.com/x80zAI/kaori-imd
- IMD receipt data source (external token): https://imd.fun/token/
- Data details and limits: [docs/SOURCES.md](docs/SOURCES.md)

## Run locally

Use Node.js 24, then run:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5203. The local server includes the read-only Ethereum endpoints. No API key is required.

To prepare and serve the production version:

```sh
npm run build
npm run preview
```

Stop the development server before starting preview on the same port.

## Verify changes

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Complete these checks with real endpoint readings and desktop/mobile browser checks. Unit fixtures are confined to the test suite and are never shipped as website content.

## Publication

Vercel uses Node.js 24, `npm ci`, `npm run build` and the `dist` output. The API functions use native Node APIs. The GitHub main branch is the source for production publication under David's Vercel projects. The website depends on public Ethereum services; unsuccessful readings display an error and are never converted to balances or completed transfers.

## Brand and content

The character, website illustration and X header were created with the built-in image generation tool. The square profile image and X header are in `artifacts/brand`. Media source files and social deliverables stay in their own artifact folders, outside the production website. Public content must preserve the Kaori identity and make only verified utility claims.
