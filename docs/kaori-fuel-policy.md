# Kaori Fuel funding policy

Decision date: 2026-10-05.

This document records the rules selected for the proposed Kaori Fuel contract. It does not represent a deployed or funded vault.

## Funding

David claims the IMD rewards belonging to the project's holdings on Stockereum and transfers the received IMD to the Kaori Fuel vault. Other holders retain their own rewards. Coverage starts only after funding has been received and confirmed on Ethereum.

## Initial reimbursement

- Reimburse **50%** of an eligible, verified official IMD service payment (`5,000` basis points).
- Reimburse in the official IMD asset on Ethereum, to the wallet that made the verified payment.
- Use the actual confirmed amount for that order, rather than a hard-coded IMD service price.
- Round down to the token's smallest unit. Never pay more than the reserved reimbursement.
- Cover each order once. A completed job, user statement or payment signature alone is not proof that a reimbursement is authorized.
- Network gas is outside the reimbursable service cost. Automatic payout gas requires a separate funded ETH balance.

## Reserve and admission

- Protect **20% of each confirmed IMD funding receipt** as a reserve. This is separate from the 50% reimbursement rate; the unpaid half of a service payment is not revenue for Kaori.
- Track the reserve as an amount derived from funding receipts, not as 20% of the continually shrinking current balance. An internal transfer or repeated processing of a receipt must not count as new funding.
- Free budget equals confirmed vault assets minus the protected reserve, outstanding reimbursement commitments and committed IMD verification costs.
- Reserve the promised reimbursement and its verification costs before admitting a covered order. Do not reserve the same free funds for multiple orders.
- If free budget or the payout gas budget is insufficient, stop admitting new covered orders. Honor existing commitments.
- If the reimbursement rate changes later, apply the new rate only to future reservations. Already accepted reservations retain their agreed amount.

## Verification costs

A separate paid IMD oracle request for every small reimbursement could cost more than the reimbursement itself. The implementation must account for any paid verification before admission. A server verifier or a batched oracle design needs its own review and explicit disclosure of whom the contract trusts.

## Sustainability and activation

The initial rates are conservative policy choices, not a guarantee of profitability or an unlimited lifetime. Review actual confirmed funding, reimbursements, outstanding commitments, verification costs and ETH gas costs before increasing coverage.

Contract deployment, the authorized verifier, automatic payout execution and website activation remain to be implemented and verified. This document supplies no deposit address.

Official sources:

- [Stockereum fee and holder reward rules](https://stockereum.com/docs)
- [IMD paid requests and oracle documentation](https://imd.fun/docs/)
- [Live IMD request capabilities](https://api.imd.fun/requests/capabilities)
