# Kaori IMD sources and data boundaries

Kaori IMD is an independent personal project. Its receipt desk and Approval Check read public Ethereum data. Its staking desk uses a connected browser wallet for explicitly selected transactions in the official POOL4 vault; the server never signs or sends transactions.

## Primary sources

- [Official IMD token page](https://imd.fun/token/) identifies the Ethereum IMD contract as `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`.
- [Ethereum JSON-RPC documentation](https://ethereum.org/developers/docs/apis/json-rpc/) describes transaction, receipt, block and log reads. A receipt is unavailable while a transaction is pending.
- [Ethereum execution API specification](https://ethereum.github.io/execution-apis/) defines the `finalized` block tag and the RPC field formats.
- [ERC-20 specification](https://eips.ethereum.org/EIPS/eip-20) defines the `Transfer(address,address,uint256)` event and `allowance(address,address)` remaining spending permission.
- [PublicNode Ethereum endpoint](https://ethereum.publicnode.com/) publishes `https://ethereum-rpc.publicnode.com`. The fallback endpoint is `https://ethereum.reth.rs/rpc`.
- [Official POOL4 documentation](https://pool4.imd.fun/docs#staking) identifies the sIMD vault and explains staking, its one-block hold and protocol risks.
- [Verified StakedIMD contract](https://etherscan.io/address/0x9efa934d9fad4ae28c998a40195646b965a97247#code) publishes the deployed source and ABI. It uses Solady ERC-4626 with an 18-decimal asset and a six-decimal share offset: sIMD has 24 decimals.
- [ERC-4626 specification](https://eips.ethereum.org/EIPS/eip-4626) defines vault shares, preview functions, deposits and redemptions.
- [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) and [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) define browser wallet discovery and provider requests.

## What the application verifies

Each complete read uses one RPC provider. The application checks chain ID `1`, nonempty code at the official contract and `18` token decimals at its observed snapshot block. A failed read restarts with the second provider; observations from different providers are never combined. Each provider has a 12-second deadline, so an attempt has at most 24 seconds of RPC work.

A mined transaction must agree with its receipt on the transaction hash, sender, recipient, block number, block hash and transaction index. The block at that number must have the same hash and contain the transaction at that index. The snapshot block is checked again to reject a changing chain observation. IMD transfers must also agree with the transaction and block. Other token logs are not presented as IMD transfers.

All amounts, block numbers, confirmations and gas quantities use exact integer arithmetic and are returned as decimal strings. IMD amounts preserve all 18 decimals. `feeEth` is the execution gas fee: `gasUsed × effectiveGasPrice`, expressed in ETH. It excludes separate blob fees. It is not an estimate or a token price.

`confirmations` counts blocks from the transaction block through `snapshotBlockNumber`, inclusive. `finality` is `finalized` or `unfinalized` when the provider supplies a usable finalized block; it is `unknown` when that optional observation is unavailable. A reverted transaction has no committed transfer events. A successful transaction with no official IMD transfer remains a valid Ethereum receipt and displays that limitation. The application does not classify transfers as buys, sells, profits or user activity.

## Recent transactions

The recent list reads only official IMD `Transfer` logs, scanning backwards from its fixed snapshot in separate chunks of at most 500 blocks. A response exceeding the two-megabyte limit is discarded and retried with a smaller range on the same provider; even a one-block response must fit that limit. It stops after finding eight distinct transaction hashes or scanning the latest 3,000 blocks. `fromBlock` reports the start of the complete chunks actually scanned. Every chunk must fit its requested range, and the entire attempt keeps its 12-second provider deadline. Any remaining chunk failure invalidates the whole attempt; fallback restarts with one provider. It verifies the canonical blocks of the returned transactions and returns at most eight distinct transaction hashes. Multiple transfer events in one transaction are counted together. An empty result means no matching transfers were returned in that full bounded window; it is not a claim about the entire token history. The list does not preload invented hashes or records.

## IMD spending approvals

`GET /api/allowance?owner=…&spender=…` accepts exactly one non-zero Ethereum owner address and one non-zero spender address. It reads the official IMD contract's `allowance(owner, spender)` with the `0xdd62ed3e` function selector. Chain ID, contract code, decimals and allowance are checked at one numbered Ethereum snapshot, and the canonical block hash is read again before returning the result. A changed block invalidates the reading. Provider fallback restarts the complete observation.

The API returns the exact uint256 base-unit amount and an exact 18-decimal IMD amount, alongside the wallet, spender, contract, block number/hash/time, retrieval time and provider. Only `(2^256) - 1` is labeled maximum approval. A finite large amount is not converted to maximum or rounded. The frontend verifies the expected wallet/spender, official token, exact amount and maximum flag before showing a result.

Zero is shown only after a successful verified Ethereum reading. Invalid, inconsistent or unavailable data produces an error. The check is specific to the entered pair; it does not discover all approvals, read wallet ownership, equate allowance with balance, assess application safety, or revoke permission. No wallet signature is requested.

## Official IMD staking boundaries

`GET /api/staking` reads the verified official Ethereum vault at `0x9efa934d9fad4ae28c998a40195646b965a97247`. An optional non-zero `owner` adds real IMD/sIMD balances, allowance, redemption value, ETH balance and deposit/redemption limits. A quote requires the same owner plus `mode=deposit` or `mode=redeem` and a positive decimal uint256 `amount` in base units. Unknown or duplicate parameters are rejected. Wallet readings and quotes are always fresh; global observations may be reused for ten seconds. Unique concurrent requests are bounded to 32.

All calls in a reading use one numbered block. The service checks Ethereum mainnet, official IMD code and 18 decimals, vault runtime keccak hash `0xe8333ecf3ae9263b14d6a1ab59d6f384c16d8609c1725edf31b0dcd1780280e5`, `asset()`, 24 share decimals, pause/ownership state, exact amounts and consistency with the verified virtual-share conversion. It rechecks the canonical block hash. Provider fallback repeats the whole observation. Failures remain unavailable, never zero balances or usable quotes.

Wallet submissions are limited to `approve(vault, exactAmount)` on IMD, `deposit(assets, connectedAccount)` on sIMD, and `redeem(shares, connectedAccount, connectedAccount)` on sIMD. The browser repeats current contract, balance, allowance and limit checks and performs an `eth_call` simulation and gas estimate before asking the wallet to send. Accounts or networks changing before submission stop that action. Once the wallet returns a transaction hash, the original intent is retained and can be checked on Ethereum even if the wallet context changes.

Confirmation is not inferred from a returned hash. It requires two confirmations, matching sender/recipient/calldata and zero ETH transfer value, a canonical receipt and the exact official `Approval`, `Deposit` or `Withdraw` event. A repriced transaction must preserve its intent and match the original nonce. The UI shows actual confirmed event amounts instead of repeating the preview. Timeouts preserve the pending hash; reverts or cancellations do not become successful stakes.

The standard vault methods do not enforce a minimum output. The interface therefore labels previews as quotes that may change. There is no claimed fixed APR, future gain, token price, proprietary Kaori staking pool or Kaori custody. POOL4's official documentation describes the protocol as unaudited. Owner powers are presented according to the current verified `owner()` reading; a zero owner means ownership has been renounced. Development verification uses read-only calls, public historical transactions and isolated fixtures, without submitting funds.

## Public IMD network readings

The network desk reads the official [Identity.md API](https://imd.fun/docs/) at `https://api.imd.fun`. Its dedicated `GET /api/network` endpoint accepts an allowlisted view and validated search, cursor or record ID parameters. It never forwards an arbitrary destination, user credential or wallet signature. Public strings are rendered as text; no returned HTML is executed.

- `overview` reads `/swarm`: the network's timestamp, service reachability, published counts, seat records and recent events. These records come from one upstream snapshot. Historical seat records are not equivalent to currently enrolled or online agents. A seat's working flag is not an online-presence claim.
- `jobs` reads a bounded page of `/jobs`, with optional objective/ID search and creation-time pagination. `job` reads a specific public record. A job state is the protocol's reported state, not Kaori's independent proof that its work is correct.
- `oracles` reads a bounded page of `/oracle/requests`; `oracle` reads a specific request with its public result fields. The UI distinguishes the reported answer, signature availability and any failure. It does not label a signature as independently verified or an answer as guaranteed correct.

`retrievedAt` identifies when Kaori obtained a response; the overview also preserves the network's own `observedAt`. A list's count is the number of returned records, not a network-wide total. An empty search result applies only to that query/page. The watchlist stores references, notes and the save time; opening a reference obtains a new observation. A separately exported reading preserves the data and retrieval time.

Unavailable, malformed or oversized upstream data produces an unavailable state. The server limits response size and duration, caches bounded successful readings briefly and coalesces duplicate requests. No scheduled work, paid request, token purchase, reward distribution or treasury payment is triggered by this integration.

SI-MD supplied functional inspiration for viewing public IMD work. Its contract address, payment treasury, private state and generated content are not Kaori services or Kaori assets.

## Storage and availability

The server keeps a bounded, 15-second memory cache and shares duplicate in-flight requests. It stores no requested hashes or transaction data on disk. Public RPC services and hosting platforms may keep their own operational logs according to their policies. Recent activity may change between refreshes. RPC failure produces an unavailable response, never a fabricated zero, receipt or confirmation.

The receipt API accepts a single `hash` query parameter. Invalid input returns HTTP 400. HTTP 404 requires every configured provider to complete its read and report the hash absent. A provider outage or inconsistent response returns HTTP 503. The recent API accepts no query parameters. The allowance API accepts only its owner/spender pair, caches at most 65 pairs for 15 seconds, and bounds unique in-flight reads to 32. All endpoints are GET-only.
