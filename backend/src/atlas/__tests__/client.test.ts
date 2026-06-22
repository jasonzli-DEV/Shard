import { makeAtlasClient } from '../client';

const PUBLIC_KEY = 'testpub';
const PRIVATE_KEY = 'testpriv';

// Helper to build a mock fetch that returns a 401 with digest challenge then a 200
function makeFetchWithDigest(
  finalStatus: number,
  finalBody: unknown,
  extraHeaders?: Record<string, string>,
): jest.Mock {
  const realm = 'cloud.mongodb.com';
  const nonce = 'abc123nonce';
  const opaque = 'someopaque';
  const wwwAuth = `Digest realm="${realm}", nonce="${nonce}", qop="auth", opaque="${opaque}"`;

  let callCount = 0;
  return jest.fn(async (_url: string, init?: RequestInit) => {
    callCount++;
    // First call: return 401 to trigger digest
    if (callCount === 1 && (!init?.headers || !(init.headers as Record<string, string>)['Authorization'])) {
      return {
        status: 401,
        ok: false,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'www-authenticate' ? wwwAuth : null),
        },
        json: async () => ({}),
        text: async () => '',
      };
    }
    // Subsequent calls: return final response
    return {
      status: finalStatus,
      ok: finalStatus >= 200 && finalStatus < 300,
      headers: {
        get: (_name: string) => extraHeaders?.[_name] ?? null,
      },
      json: async () => finalBody,
      text: async () => JSON.stringify(finalBody),
    };
  }) as jest.Mock;
}

describe('makeAtlasClient', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('digest auth challenge parsing', () => {
    it('parses realm, nonce, qop, opaque from WWW-Authenticate header', async () => {
      const realm = 'cloud.mongodb.com';
      const nonce = 'abc123';
      const opaque = 'xyz789';
      const wwwAuth = `Digest realm="${realm}", nonce="${nonce}", qop="auth", opaque="${opaque}"`;

      let capturedAuth = '';
      mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        capturedAuth = headers['Authorization'] ?? '';
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ results: [] }),
          text: async () => '{"results":[]}',
        };
      });

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.apiGet('/orgs');

      expect(capturedAuth).toContain(`realm="${realm}"`);
      expect(capturedAuth).toContain(`nonce="${nonce}"`);
      expect(capturedAuth).toContain(`opaque="${opaque}"`);
      expect(capturedAuth).toContain(`username="${PUBLIC_KEY}"`);
      expect(capturedAuth).toContain('qop=auth');
      expect(capturedAuth).toContain('response=');
    });

    it('sends correct Accept header on second request', async () => {
      let capturedHeaders: Record<string, string> = {};
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth", opaque="o"`;

      mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        capturedHeaders = headers;
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ id: 'proj1' }),
          text: async () => '{"id":"proj1"}',
        };
      });

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.apiGet('/groups');

      expect(capturedHeaders['Accept']).toBe('application/vnd.atlas.2023-02-01+json');
    });

    it('uses correct base URL for requests', async () => {
      let capturedUrl = '';
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth"`;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        capturedUrl = url;
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => '{}',
        };
      });

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.apiGet('/orgs');

      expect(capturedUrl).toMatch(/^https:\/\/cloud\.mongodb\.com\/api\/atlas\/v2\/orgs/);
    });
  });

  describe('buildConnectionUri', () => {
    it('builds a valid mongodb+srv URI from srvHost, user, pass, db', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const uri = client.buildConnectionUri(
        'mongodb+srv://cluster0.abc.mongodb.net',
        'myuser',
        'mypass',
        'mydb',
      );

      expect(uri).toBe(
        'mongodb+srv://myuser:mypass@cluster0.abc.mongodb.net/mydb?retryWrites=true&w=majority',
      );
    });

    it('URL-encodes special characters in credentials', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const uri = client.buildConnectionUri(
        'cluster0.abc.mongodb.net',
        'user@name',
        'p@ss:word',
        'db',
      );

      expect(uri).toContain('user%40name');
      expect(uri).toContain('p%40ss%3Aword');
    });

    it('defaults db to "shard" when not provided', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const uri = client.buildConnectionUri('cluster0.abc.mongodb.net', 'u', 'p');

      expect(uri).toContain('/shard?');
    });
  });

  describe('extractRequiredAccessListIp', () => {
    it('returns the IP from ORG_REQUIRES_ACCESS_LIST 403 error', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const err = {
        status: 403,
        body: JSON.stringify({
          errorCode: 'ORG_REQUIRES_ACCESS_LIST',
          parameters: ['203.0.113.42'],
        }),
      };

      const ip = client.extractRequiredAccessListIp(err);
      expect(ip).toBe('203.0.113.42');
    });

    it('returns empty string when errorCode is different', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const err = {
        status: 403,
        body: JSON.stringify({ errorCode: 'OTHER_ERROR', parameters: ['1.2.3.4'] }),
      };

      expect(client.extractRequiredAccessListIp(err)).toBe('');
    });

    it('returns empty string when status is not 403', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const err = {
        status: 401,
        body: JSON.stringify({
          errorCode: 'ORG_REQUIRES_ACCESS_LIST',
          parameters: ['1.2.3.4'],
        }),
      };

      expect(client.extractRequiredAccessListIp(err)).toBe('');
    });

    it('returns empty string when body is malformed JSON', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const err = { status: 403, body: 'not-json' };

      expect(client.extractRequiredAccessListIp(err)).toBe('');
    });

    it('returns empty string for null/undefined error', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      expect(client.extractRequiredAccessListIp(null)).toBe('');
      expect(client.extractRequiredAccessListIp(undefined)).toBe('');
    });
  });

  describe('parseCredentialsFromUri', () => {
    it('extracts username, password, and dbName from a URI', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const { username, password, dbName } = client.parseCredentialsFromUri(
        'mongodb+srv://alice:secret@cluster0.example.com/mydb?retryWrites=true',
      );

      expect(username).toBe('alice');
      expect(password).toBe('secret');
      expect(dbName).toBe('mydb');
    });

    it('decodes URL-encoded characters in credentials', () => {
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      const { username, password } = client.parseCredentialsFromUri(
        'mongodb+srv://user%40name:p%40ss%3Aword@cluster.example.com/db',
      );

      expect(username).toBe('user@name');
      expect(password).toBe('p@ss:word');
    });
  });

  describe('createCluster', () => {
    function makeDigestMock(captureBody: { value: unknown }) {
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth"`;
      return jest.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        if (init?.body) captureBody.value = JSON.parse(init.body as string);
        return {
          status: 201,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ name: 'shard-user-1', stateName: 'CREATING' }),
          text: async () => '{"name":"shard-user-1","stateName":"CREATING"}',
        };
      });
    }

    it('posts M0/TENANT/AWS/US_EAST_1 config to Atlas when no region given', async () => {
      const captured = { value: null as unknown };
      mockFetch = makeDigestMock(captured);
      global.fetch = mockFetch;

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.createCluster('proj-123', 'shard-user-1');

      const body = captured.value as Record<string, unknown>;
      expect(body).toBeTruthy();
      expect(body['clusterType']).toBe('REPLICASET');

      const specs = (body['replicationSpecs'] as Array<unknown>)?.[0] as Record<string, unknown>;
      const regionCfg = (specs?.['regionConfigs'] as Array<unknown>)?.[0] as Record<string, unknown>;

      expect(regionCfg?.['providerName']).toBe('TENANT');
      expect(regionCfg?.['backingProviderName']).toBe('AWS');
      expect(regionCfg?.['regionName']).toBe('US_EAST_1');

      const electableSpecs = regionCfg?.['electableSpecs'] as Record<string, unknown>;
      expect(electableSpecs?.['instanceSize']).toBe('M0');
    });

    it('uses specified region when provided', async () => {
      const captured = { value: null as unknown };
      mockFetch = makeDigestMock(captured);
      global.fetch = mockFetch;

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.createCluster('proj-123', 'shard-user-1', 'EU_WEST_1');

      const body = captured.value as Record<string, unknown>;
      const specs = (body?.['replicationSpecs'] as Array<unknown>)?.[0] as Record<string, unknown>;
      const regionCfg = (specs?.['regionConfigs'] as Array<unknown>)?.[0] as Record<string, unknown>;

      expect(regionCfg?.['regionName']).toBe('EU_WEST_1');
    });

    it('uses AP_SOUTHEAST_1 when that region is specified', async () => {
      const captured = { value: null as unknown };
      mockFetch = makeDigestMock(captured);
      global.fetch = mockFetch;

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.createCluster('proj-123', 'shard-user-1', 'AP_SOUTHEAST_1');

      const body = captured.value as Record<string, unknown>;
      const specs = (body?.['replicationSpecs'] as Array<unknown>)?.[0] as Record<string, unknown>;
      const regionCfg = (specs?.['regionConfigs'] as Array<unknown>)?.[0] as Record<string, unknown>;

      expect(regionCfg?.['regionName']).toBe('AP_SOUTHEAST_1');
    });
  });

  describe('deleteCluster', () => {
    it('sends DELETE to /groups/{projectId}/clusters/{name}', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth"`;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        capturedUrl = url;
        capturedMethod = init?.method ?? 'GET';
        return {
          status: 202,
          ok: true,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => '{}',
        };
      });

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.deleteCluster('proj-xyz', 'shard-cluster-1');

      expect(capturedMethod).toBe('DELETE');
      expect(capturedUrl).toContain('/groups/proj-xyz/clusters/shard-cluster-1');
    });
  });

  describe('deleteProject', () => {
    it('sends DELETE to /groups/{projectId}', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth"`;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        capturedUrl = url;
        capturedMethod = init?.method ?? 'GET';
        return {
          status: 202,
          ok: true,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => '{}',
        };
      });

      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
      await client.deleteProject('proj-xyz');

      expect(capturedMethod).toBe('DELETE');
      expect(capturedUrl).toContain('/groups/proj-xyz');
      expect(capturedUrl).not.toContain('/clusters/');
    });
  });

  describe('withOrgApiAccessListRetry', () => {
    it('retries operation after adding IP to access list on ORG_REQUIRES_ACCESS_LIST error', async () => {
      const orgId = 'org-abc';
      const publicKeyId = PUBLIC_KEY;
      let operationCallCount = 0;
      const wwwAuth = `Digest realm="r", nonce="n", qop="auth"`;

      // fetchMock: returns digest challenge on first call, then 200 for the access list POST and the retried op
      let fetchCallCount = 0;
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCallCount++;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (!headers['Authorization']) {
          return {
            status: 401,
            ok: false,
            headers: { get: (h: string) => (h === 'www-authenticate' ? wwwAuth : null) },
            json: async () => ({}),
            text: async () => '',
          };
        }
        // Access list POST
        if (url.includes('/accessList')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => null },
            json: async () => ({}),
            text: async () => '{}',
          };
        }
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ id: 'proj1' }),
          text: async () => '{"id":"proj1"}',
        };
      });

      const client = makeAtlasClient({ publicKey: publicKeyId, privateKey: PRIVATE_KEY });

      const accessListError = {
        status: 403,
        body: JSON.stringify({
          errorCode: 'ORG_REQUIRES_ACCESS_LIST',
          parameters: ['203.0.113.1'],
        }),
      };

      const operation = jest.fn(async () => {
        operationCallCount++;
        if (operationCallCount === 1) throw accessListError;
        return { id: 'proj1' };
      });

      const result = await client.withOrgApiAccessListRetry(orgId, operation);
      expect(result).toEqual({ id: 'proj1' });
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-access-list errors', async () => {
      const orgId = 'org-abc';
      const client = makeAtlasClient({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });

      const operation = jest.fn(async () => {
        throw { status: 500, body: JSON.stringify({ errorCode: 'INTERNAL_ERROR' }) };
      });

      await expect(client.withOrgApiAccessListRetry(orgId, operation)).rejects.toMatchObject({
        status: 500,
      });
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
