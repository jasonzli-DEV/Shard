import client from './client';

// ── Storage types ─────────────────────────────────────────────────────────────

export interface ClusterInfo {
  id: string;
  clusterId: string;
  status: 'provisioning' | 'active' | 'full' | 'error' | 'decommissioned';
  storageUsedBytes: number;
  storageCapacityBytes: number;
  usedPercent: number;
  lastCheckedAt: string | null;
}

export interface OrgStorage {
  orgId: string;
  label: string;
  region: string | null;
  clusterCount: number;
  activeProvisioning: boolean;
  clusters: ClusterInfo[];
  activeCluster: {
    id: string;
    clusterId: string;
    storageUsedBytes: number;
    storageCapacityBytes: number;
    usedPercent: number;
  } | null;
  totalUsedBytes: number;
  totalCapacityBytes: number;
}

export interface StorageResponse {
  orgs: OrgStorage[];
  totalUsedBytes: number;
  totalCapacityBytes: number;
  usedPercent: number;
}

// ── Org key types ─────────────────────────────────────────────────────────────

export interface OrgKey {
  id: string;
  label: string;
  publicKey: string;
  orgId: string;
  clusterCount: number;
  region: string | null;
  createdAt: string;
}

// ── API key types ─────────────────────────────────────────────────────────────

export interface ApiKeyItem {
  id: string;
  label: string;
  keyHint: string; // "shard_...XXXX"
  lastUsed: string | null;
  createdAt: string;
}

// ── Storage API ───────────────────────────────────────────────────────────────

export async function getStorage(): Promise<StorageResponse> {
  const { data } = await client.get<StorageResponse>('/storage');
  return data;
}

// ── Org key API ───────────────────────────────────────────────────────────────

export async function listOrgs(): Promise<OrgKey[]> {
  const { data } = await client.get<OrgKey[]>('/orgs');
  return data;
}

export async function addOrg(payload: {
  label: string;
  publicKey: string;
  privateKey: string;
  region?: string;
}): Promise<OrgKey> {
  const { data } = await client.post<OrgKey>('/orgs', payload);
  return data;
}

export async function deleteOrg(id: string): Promise<void> {
  await client.delete(`/orgs/${id}`);
}

// ── API key API ───────────────────────────────────────────────────────────────

export async function listApiKeys(): Promise<ApiKeyItem[]> {
  const { data } = await client.get<ApiKeyItem[]>('/keys');
  return data;
}

export async function createApiKey(label: string): Promise<{ id: string; label: string; key: string; createdAt: string }> {
  const { data } = await client.post('/keys', { label });
  return data;
}

export async function deleteApiKey(id: string): Promise<void> {
  await client.delete(`/keys/${id}`);
}
