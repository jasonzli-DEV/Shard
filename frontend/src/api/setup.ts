/**
 * Setup API — matches backend /api/setup/* routes.
 */
import client from './client';

export interface SetupStatus {
  setupRequired: boolean;
  starterFromEnv: boolean;
  configured: {
    starterDb: boolean;
    jwt: boolean;
    google: boolean;
    github: boolean;
    publicUrl: boolean;
  };
}

export interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

export interface ConfigurePayload {
  starterUri?: string;
  google?: OAuthCreds;
  github?: OAuthCreds;
  publicUrl: string;
  allowedOrigins: string;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await client.get<SetupStatus>('/setup/status');
  return res.data;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return fetchSetupStatus();
}

export async function testConnection(
  starterUri: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await client.post<{ ok: boolean; error?: string }>(
    '/setup/test-connection',
    { starterUri },
  );
  return res.data;
}

export async function configure(payload: ConfigurePayload): Promise<void> {
  await client.post('/setup/configure', payload);
}
