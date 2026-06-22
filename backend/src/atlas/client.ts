import crypto from 'crypto';

const ATLAS_BASE = 'https://cloud.mongodb.com/api/atlas/v2';
const ACCEPT = 'application/vnd.atlas.2023-02-01+json';

export interface AtlasClientConfig {
  publicKey: string;
  privateKey: string;
}

export interface AtlasError {
  status: number;
  body: string;
}

export interface AtlasClient {
  apiGet<T = unknown>(path: string): Promise<T>;
  apiPost<T = unknown>(path: string, body: unknown): Promise<T>;
  apiPatch<T = unknown>(path: string, body: unknown): Promise<T>;
  discoverOrgId(): Promise<string>;
  createProject(orgId: string, name: string): Promise<{ id: string; name: string }>;
  createCluster(projectId: string, clusterName: string): Promise<unknown>;
  waitForCluster(projectId: string, clusterName: string, pollMs?: number): Promise<{ connectionStrings?: { standardSrv?: string }; [key: string]: unknown }>;
  createDatabaseUser(projectId: string, username: string, password: string): Promise<unknown>;
  addIpAllowlist(projectId: string): Promise<unknown>;
  buildConnectionUri(srvHost: string, username: string, password: string, dbName?: string): string;
  parseCredentialsFromUri(uri: string): { username: string; password: string; dbName: string };
  addOrgApiKeyAccessList(orgId: string, ipAddress: string): Promise<unknown>;
  withOrgApiAccessListRetry<T>(orgId: string, operation: () => Promise<T>): Promise<T>;
  extractRequiredAccessListIp(err: unknown): string;
}

function parseDigestChallenge(header: string): {
  realm: string;
  nonce: string;
  qop: string;
  opaque: string;
} {
  const get = (key: string): string =>
    header.match(new RegExp(`${key}="([^"]+)"`))?.[1] ?? '';
  return {
    realm: get('realm'),
    nonce: get('nonce'),
    qop: get('qop') || 'auth',
    opaque: get('opaque'),
  };
}

export function makeAtlasClient({ publicKey, privateKey }: AtlasClientConfig): AtlasClient {
  async function digestFetch(
    url: string,
    method = 'GET',
    body: unknown = null,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: ACCEPT,
      'Content-Type': 'application/json',
    };

    const first = await fetch(url, { method, headers });
    if (first.status !== 401) return first as Response;

    const wwwAuth = first.headers.get('www-authenticate') ?? '';
    const { realm, nonce, qop, opaque } = parseDigestChallenge(wwwAuth);
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const parsedUrl = new URL(url);
    const uri = parsedUrl.pathname + parsedUrl.search;

    const ha1 = crypto
      .createHash('md5')
      .update(`${publicKey}:${realm}:${privateKey}`)
      .digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
    const response = crypto
      .createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      .digest('hex');

    let auth = `Digest username="${publicKey}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
    if (opaque) auth += `, opaque="${opaque}"`;

    return fetch(url, {
      method,
      headers: { ...headers, Authorization: auth },
      body: body != null ? JSON.stringify(body) : undefined,
    }) as Promise<Response>;
  }

  async function throwAtlasError(method: string, path: string, res: Response): Promise<never> {
    const body = await res.text();
    const err = new Error(`Atlas ${method} ${path} → ${res.status}: ${body}`) as Error & {
      status: number;
      body: string;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }

  async function apiGet<T = unknown>(path: string): Promise<T> {
    const res = await digestFetch(`${ATLAS_BASE}${path}`);
    if (!res.ok) await throwAtlasError('GET', path, res);
    return res.json() as Promise<T>;
  }

  async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await digestFetch(`${ATLAS_BASE}${path}`, 'POST', body);
    if (!res.ok) await throwAtlasError('POST', path, res);
    return res.json() as Promise<T>;
  }

  async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await digestFetch(`${ATLAS_BASE}${path}`, 'PATCH', body);
    if (!res.ok) await throwAtlasError('PATCH', path, res);
    return res.json() as Promise<T>;
  }

  async function discoverOrgId(): Promise<string> {
    const data = await apiGet<{ results?: Array<{ id: string }> }>('/orgs');
    const orgId = data.results?.[0]?.id;
    if (!orgId) throw new Error('No Atlas org found for this API key');
    return orgId;
  }

  async function createProject(
    orgId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return apiPost<{ id: string; name: string }>('/groups', { name, orgId });
  }

  async function createCluster(projectId: string, clusterName: string): Promise<unknown> {
    return apiPost(`/groups/${projectId}/clusters`, {
      name: clusterName,
      clusterType: 'REPLICASET',
      replicationSpecs: [
        {
          regionConfigs: [
            {
              providerName: 'TENANT',
              backingProviderName: 'AWS',
              regionName: 'US_EAST_1',
              priority: 7,
              electableSpecs: { instanceSize: 'M0', nodeCount: 3 },
            },
          ],
        },
      ],
    });
  }

  async function waitForCluster(
    projectId: string,
    clusterName: string,
    pollMs = 15_000,
  ): Promise<{ connectionStrings?: { standardSrv?: string }; [key: string]: unknown }> {
    for (;;) {
      const cluster = await apiGet<{ stateName: string; connectionStrings?: { standardSrv?: string } }>(
        `/groups/${projectId}/clusters/${clusterName}`,
      );
      if (cluster.stateName === 'IDLE') return cluster;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  async function createDatabaseUser(
    projectId: string,
    username: string,
    password: string,
  ): Promise<unknown> {
    return apiPost(`/groups/${projectId}/databaseUsers`, {
      databaseName: 'admin',
      username,
      password,
      roles: [{ roleName: 'atlasAdmin', databaseName: 'admin' }],
    });
  }

  async function addIpAllowlist(projectId: string): Promise<unknown> {
    return apiPost(`/groups/${projectId}/accessList`, [
      { cidrBlock: '0.0.0.0/0', comment: 'shard-autoscale' },
    ]);
  }

  function buildConnectionUri(
    srvHost: string,
    username: string,
    password: string,
    dbName = 'shard',
  ): string {
    const host = srvHost.replace(/^mongodb\+srv:\/\//, '');
    return `mongodb+srv://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}/${dbName}?retryWrites=true&w=majority`;
  }

  function parseCredentialsFromUri(uri: string): {
    username: string;
    password: string;
    dbName: string;
  } {
    const url = new URL(uri);
    return {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      dbName: url.pathname.replace(/^\//, '') || 'shard',
    };
  }

  async function addOrgApiKeyAccessList(orgId: string, ipAddress: string): Promise<unknown> {
    return apiPost(`/orgs/${orgId}/apiKeys/${publicKey}/accessList`, [
      { ipAddress, comment: 'shard-autoscale' },
    ]);
  }

  function extractRequiredAccessListIp(err: unknown): string {
    if (!err || typeof err !== 'object') return '';
    const e = err as Record<string, unknown>;
    if (e['status'] !== 403 || !e['body']) return '';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(e['body'] as string) as Record<string, unknown>;
    } catch {
      return '';
    }
    if (body['errorCode'] !== 'ORG_REQUIRES_ACCESS_LIST') return '';
    const params = body['parameters'];
    const [ip] = Array.isArray(params) ? params : [];
    return typeof ip === 'string' ? ip : '';
  }

  async function withOrgApiAccessListRetry<T>(
    orgId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      const ip = extractRequiredAccessListIp(err);
      if (!ip) throw err;
      await addOrgApiKeyAccessList(orgId, ip);
      return operation();
    }
  }

  return {
    apiGet,
    apiPost,
    apiPatch,
    discoverOrgId,
    createProject,
    createCluster,
    waitForCluster,
    createDatabaseUser,
    addIpAllowlist,
    buildConnectionUri,
    parseCredentialsFromUri,
    addOrgApiKeyAccessList,
    withOrgApiAccessListRetry,
    extractRequiredAccessListIp,
  };
}
