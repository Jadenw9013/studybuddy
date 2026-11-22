/** Private persisted illustration job. Browser responses must use an explicit allowlist. */
export interface IllustrationJob {
  id: string;
  actionId: string;
  fingerprint: string;
  turnEpoch: number;
  boardRevision: number;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'cancelled' | 'stale';
  prompt: string;
  purpose: string;
  title: string;
  model: string;
  fixture: boolean;
  createdAt: number;
  updatedAt: number;
  estimateUsd: number;
  priceVersion: string;
  costState: 'reserved' | 'estimated' | 'unknown' | 'released';
  passId: string;
  providerId?: string;
  storageKey?: string;
  mime?: string;
  message?: string;
  submitted?: boolean;
}
