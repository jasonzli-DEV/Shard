/**
 * Playwright global setup.
 *
 * Starts:
 *   1. An in-memory MongoDB via mongodb-memory-server
 *   2. The backend Express server (with SHARD_E2E=1)
 *   3. The frontend Vite preview server
 *
 * Writes .e2e-state.json with process PIDs and mongo URI for teardown.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

const STATE_FILE = path.join(__dirname, '.e2e-state.json');
const BACKEND_PORT = 4001;
const FRONTEND_PORT = 5174;
const BACKEND_ROOT = path.join(__dirname, '..', 'backend');
const FRONTEND_ROOT = path.join(__dirname, '..', 'frontend');

// ── Wait for a port to be accepting connections ────────────────────────────────
function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function probe() {
      const req = http.get(`http://localhost:${port}/`, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for port ${port}`));
        } else {
          setTimeout(probe, 500);
        }
      });
      req.end();
    }
    probe();
  });
}

function waitForHealthEndpoint(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function probe() {
      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(probe, 500);
        }
        res.resume();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for backend on port ${port}`));
        } else {
          setTimeout(probe, 500);
        }
      });
      req.end();
    }
    probe();
  });
}

export default async function globalSetup() {
  console.log('[E2E] Starting MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  console.log(`[E2E] MongoDB started at ${mongoUri}`);

  // Start backend
  console.log('[E2E] Starting backend...');
  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SHARD_E2E: '1',
    NODE_ENV: 'test',
    PORT: String(BACKEND_PORT),
    STARTER_MONGODB_URI: mongoUri,
    JWT_SECRET: 'e2e-test-jwt-secret-at-least-32!!',
    FRONTEND_URL: `http://localhost:${FRONTEND_PORT}`,
    ALLOWED_ORIGINS: `http://localhost:${FRONTEND_PORT}`,
    PUBLIC_URL: `http://localhost:${BACKEND_PORT}`,
    GOOGLE_CLIENT_ID: 'e2e-google-client-id',
    GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
    GITHUB_CLIENT_ID: 'e2e-github-client-id',
    GITHUB_CLIENT_SECRET: 'e2e-github-client-secret',
  };

  const backendProc = spawn(
    'node',
    ['-r', 'ts-node/register/transpile-only', 'src/index.ts'],
    {
      cwd: BACKEND_ROOT,
      stdio: 'pipe',
      env: backendEnv,
    }
  );

  backendProc.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  await waitForHealthEndpoint(BACKEND_PORT);
  console.log('[E2E] Backend ready.');

  // Start frontend dev server (uses Vite proxy to forward /api to backend)
  console.log('[E2E] Starting frontend dev server...');
  const frontendProc = spawn(
    'npx',
    ['vite', '--port', String(FRONTEND_PORT), '--strictPort'],
    {
      cwd: FRONTEND_ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        VITE_API_PORT: String(BACKEND_PORT),
      },
    }
  );

  frontendProc.stderr.on('data', (d) => process.stderr.write(`[frontend] ${d}`));

  await waitForPort(FRONTEND_PORT);
  console.log('[E2E] Frontend dev server ready.');

  // Write state for teardown
  const state = {
    mongoUri,
    backendPid: backendProc.pid,
    frontendPid: frontendProc.pid,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');

  // Keep the mongod running — we pass it via global
  (global as any).__E2E_MONGOD__ = mongod;
  (global as any).__E2E_BACKEND__ = backendProc;
  (global as any).__E2E_FRONTEND__ = frontendProc;

  console.log('[E2E] All servers ready. Starting tests...');
}
