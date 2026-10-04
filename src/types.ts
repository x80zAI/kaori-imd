export type Transfer = { from: string; to: string; amount: string; logIndex: string };
export type Receipt = {
  hash: string; chainId: 1; contract: string;
  status: 'pending' | 'success' | 'reverted';
  from: string; to: string | null; blockNumber: string | null; blockHash: string | null;
  timestamp: string | null; confirmations: string | null;
  finality: 'finalized' | 'unfinalized' | 'unknown';
  snapshotBlockNumber: string; gasUsed: string | null; gasPriceWei: string | null;
  feeEth: string | null; transfers: Transfer[]; warning: string | null;
  retrievedAt: string; provider: string;
};
export type Recent = {
  chainId: number; contract: string; blockNumber: string; fromBlock: string;
  retrievedAt: string; provider: string;
  transactions: { hash: string; blockNumber: string; transferCount: number }[];
};
export type ArchiveEntry = { hash: string; note: string; savedAt: string; receipt: Receipt | null };
export type ApprovalReading = {
  chainId: 1; contract: string; tokenSymbol: 'IMD'; decimals: 18;
  owner: string; spender: string; allowanceRaw: string; allowance: string; unlimited: boolean;
  snapshotBlockNumber: string; snapshotBlockHash: string; snapshotTimestamp: string;
  retrievedAt: string; provider: string; source: string;
};
export type StakingWallet = {
  address: string; imdBalanceRaw: string; shareBalanceRaw: string; redeemableAssetsRaw: string;
  allowanceRaw: string; maxDepositRaw: string; maxRedeemRaw: string; lastDepositBlock: string; ethBalanceRaw: string;
};
export type StakingReading = {
  chainId: 1; token: string; vault: string; codeHash: string; assetDecimals: 18; shareDecimals: 24;
  paused: boolean; owner: string; totalAssetsRaw: string; totalSupplyRaw: string; assetsPerShareRaw: string;
  wallet: StakingWallet | null; quote: { mode: 'deposit' | 'redeem'; amountRaw: string; outputRaw: string } | null;
  snapshotBlockNumber: string; snapshotBlockHash: string; snapshotTimestamp: string;
  retrievedAt: string; provider: string; source: string;
};
export type StakingIntent = { hash: string; account: string; action: 'approve' | 'deposit' | 'redeem'; amountRaw: string; submittedAfterBlock?: string };
