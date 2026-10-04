export type NetworkEnvelope<V extends string, T> = { view: V; retrievedAt: string; sourceUrl: string; data: T };
export type NetworkAgent = {
  tokenId: string; agentId: string | null; owner: string | null; working: boolean;
  queued: number; attempts: number; accepted: number; rejected: number; failed: number;
  pending: number; lastWorkedAt: string | null; sourceUrl: string;
};
export type NetworkEvent = { kind: string; at: string; title: string; state: string | null; sourceUrl: string | null };
export type NetworkOverview = {
  observedAt: string; reachable: boolean;
  metrics: { agentsOnline: number; workingNow: number; seatsEnrolled: number; acceptedLastDay: number;
    jobsDoneLastDay: number; oraclesDoneLastDay: number; jobs: number; tasksInProgress: number;
    launchesLive: number; sites: number; inferenceTokens: number };
  agents: NetworkAgent[]; events: NetworkEvent[];
};
export type NetworkJob = {
  id: string; state: string; template: string; objective: string; blockedReason: string | null;
  createdAt: string; updatedAt: string; sourceUrl: string;
};
export type NetworkJobDetail = NetworkJob & {
  nodes: { key: string; role: string; state: string; attempt: number; tokenId: string | null; verdict: string | null }[];
  resultText: string | null;
};
export type NetworkOracle = {
  id: string; status: string; question: string; chainId: number; answerType: string;
  jobId: string | null; createdAt: string; updatedAt: string; attestedAt: string | null; sourceUrl: string;
};
export type NetworkOracleDetail = NetworkOracle & {
  evidence: string | null; panelSize: number | null; quorum: number | null; agreed: number | null;
  resultText: string | null; resultSource: 'computed' | 'agreement' | null; failure: string | null;
  signer: string | null; signaturePresent: boolean; expiresAt: string | null;
  fromBlock: string | null; toBlock: string | null;
};
export type NetworkPage<T> = { items: T[]; count: number; nextBefore: string | null };
export type NetworkOverviewResponse = NetworkEnvelope<'overview', NetworkOverview>;
export type NetworkJobsResponse = NetworkEnvelope<'jobs', NetworkPage<NetworkJob>>;
export type NetworkOraclesResponse = NetworkEnvelope<'oracles', NetworkPage<NetworkOracle>>;
export type NetworkJobResponse = NetworkEnvelope<'job', NetworkJobDetail>;
export type NetworkOracleResponse = NetworkEnvelope<'oracle', NetworkOracleDetail>;
