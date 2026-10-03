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
