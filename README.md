# Kaori IMD

A pixel manga archive for real IMD transaction receipts on Ethereum. Built for David, with a new ink-blue, cherry-red and warm-ivory identity.

The receipt desk accepts an Ethereum transaction hash. It reads the original transaction, receipt and block, then decodes transfer events emitted by the official IMD contract. Recent transactions come from an actual bounded Ethereum block window. The website starts with an empty personal archive.

## Use Kaori

1. Paste a transaction hash or choose a recent IMD transaction.
2. Read its exact IMD transfer amounts, addresses, block time, confirmations, finality and execution gas fee.
3. Add a note and save a successful IMD receipt to your personal browser archive.
4. Download a readable TXT record, export the receipt as JSON, or back up your notes.

The archive holds up to 30 records. Browser storage is personal to that browser and device. Restoring a notes backup preserves hashes and notes; open each restored record to retrieve current Ethereum data. Imported files do not supply trusted blockchain readings. If browser storage is unavailable, the website keeps records for the current visit and displays an export reminder. Damaged existing browser data is preserved rather than overwritten.

This is an independent IMD project. Kaori does not connect wallets or submit blockchain transactions. A exported record is a timestamped public RPC reading, not a signed certificate of ownership. Confirmations change after the recorded reading. Gas fee is the execution gas cost; possible blob gas fees are outside that field.

## Kaori contract

Kaori's own contract address is not configured. The website displays **Coming Soon**, and copying the contract is disabled while the address is empty. David will supply the address; set the single `KAORI_CONTRACT` value in `src/domain.mjs` when it is available. A valid Ethereum address will then appear with its matching copy button and Etherscan link.

The official IMD contract used by the receipt desk is an external data source, separate from Kaori's future contract. Keeping Kaori's contract empty does not replace or invent the source of existing IMD transaction records.

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

The character, website illustration and X header were created with the built-in image generation tool. The final square profile image and X header are included in the delivery's `artifacts/brand` folder. Prompts are included in `PROMPTS.txt`. The project film shows actual website screens and an actual public IMD transaction. Publication text is in `artifacts/social/article.txt` and `post.txt`.
