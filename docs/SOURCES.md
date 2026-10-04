# Kaori IMD sources and data boundaries

Kaori IMD is an independent, read-only personal project. It reads Ethereum mainnet transactions and displays `Transfer` events emitted by the official Ethereum IMD contract. It does not send transactions or request a wallet connection.

## Primary sources

- [Official IMD token page](https://imd.fun/token/) identifies the Ethereum IMD contract as `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`.
- [Ethereum JSON-RPC documentation](https://ethereum.org/developers/docs/apis/json-rpc/) describes transaction, receipt, block and log reads. A receipt is unavailable while a transaction is pending.
- [Ethereum execution API specification](https://ethereum.github.io/execution-apis/) defines the `finalized` block tag and the RPC field formats.
- [ERC-20 specification](https://eips.ethereum.org/EIPS/eip-20) defines the `Transfer(address,address,uint256)` event and `allowance(address,address)` remaining spending permission.
- [PublicNode Ethereum endpoint](https://ethereum.publicnode.com/) publishes `https://ethereum-rpc.publicnode.com`. The fallback endpoint is `https://ethereum.reth.rs/rpc`.

## What the application verifies

Each complete read uses one RPC provider. The application checks chain ID `1`, nonempty code at the official contract and `18` token decimals at its observed snapshot block. A failed read restarts with the second provider; observations from different providers are never combined. Each provider has a 12-second deadline, so an attempt has at most 24 seconds of RPC work.

A mined transaction must agree with its receipt on the transaction hash, sender, recipient, block number, block hash and transaction index. The block at that number must have the same hash and contain the transaction at that index. The snapshot block is checked again to reject a changing chain observation. IMD transfers must also agree with the transaction and block. Other token logs are not presented as IMD transfers.

All amounts, block numbers, confirmations and gas quantities use exact integer arithmetic and are returned as decimal strings. IMD amounts preserve all 18 decimals. `feeEth` is the execution gas fee: `gasUsed × effectiveGasPrice`, expressed in ETH. It excludes separate blob fees. It is not an estimate or a token price.

`confirmations` counts blocks from the transaction block through `snapshotBlockNumber`, inclusive. `finality` is `finalized` or `unfinalized` when the provider supplies a usable finalized block; it is `unknown` when that optional observation is unavailable. A reverted transaction has no committed transfer events. A successful transaction with no official IMD transfer remains a valid Ethereum receipt and displays that limitation. The application does not classify transfers as buys, sells, profits or user activity.

## Recent transactions

The recent list reads only official IMD `Transfer` logs in the latest 3,000 blocks of its fixed snapshot. It verifies the canonical blocks of the returned transactions and returns at most eight distinct transaction hashes. Multiple transfer events in one transaction are counted together. An empty result means no matching transfers were returned in that bounded window; it is not a claim about the entire token history. The list does not preload invented hashes or records.

## IMD spending approvals

`GET /api/allowance?owner=…&spender=…` accepts exactly one non-zero Ethereum owner address and one non-zero spender address. It reads the official IMD contract's `allowance(owner, spender)` with the `0xdd62ed3e` function selector. Chain ID, contract code, decimals and allowance are checked at one numbered Ethereum snapshot, and the canonical block hash is read again before returning the result. A changed block invalidates the reading. Provider fallback restarts the complete observation.

The API returns the exact uint256 base-unit amount and an exact 18-decimal IMD amount, alongside the wallet, spender, contract, block number/hash/time, retrieval time and provider. Only `(2^256) - 1` is labeled maximum approval. A finite large amount is not converted to maximum or rounded. The frontend verifies the expected wallet/spender, official token, exact amount and maximum flag before showing a result.

Zero is shown only after a successful verified Ethereum reading. Invalid, inconsistent or unavailable data produces an error. The check is specific to the entered pair; it does not discover all approvals, read wallet ownership, equate allowance with balance, assess application safety, or revoke permission. No wallet signature is requested.

## Storage and availability

The server keeps a bounded, 15-second memory cache and shares duplicate in-flight requests. It stores no requested hashes or transaction data on disk. Public RPC services and hosting platforms may keep their own operational logs according to their policies. Recent activity may change between refreshes. RPC failure produces an unavailable response, never a fabricated zero, receipt or confirmation.

The receipt API accepts a single `hash` query parameter. Invalid input returns HTTP 400. HTTP 404 requires every configured provider to complete its read and report the hash absent. A provider outage or inconsistent response returns HTTP 503. The recent API accepts no query parameters. The allowance API accepts only its owner/spender pair, caches at most 65 pairs for 15 seconds, and bounds unique in-flight reads to 32. All endpoints are GET-only.
