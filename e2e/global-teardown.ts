/**
 * Playwright global teardown.
 *
 * Reads .e2e-state.json and kills the backend/frontend processes,
 * then stops the MongoDB instance.
 */
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(__dirname, '.e2e-state.json');

export default async function globalTeardown() {
  console.log('[E2E] Tearing down...');

  // Kill processes by PID (cross-process state via file)
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

    if (state.backendPid) {
      try {
        process.kill(state.backendPid, 'SIGTERM');
        console.log(`[E2E] Killed backend (PID ${state.backendPid})`);
      } catch {
        // Already dead
      }
    }

    if (state.frontendPid) {
      try {
        process.kill(state.frontendPid, 'SIGTERM');
        console.log(`[E2E] Killed frontend (PID ${state.frontendPid})`);
      } catch {
        // Already dead
      }
    }

    fs.unlinkSync(STATE_FILE);
  } catch {
    // State file may not exist if setup failed
  }

  // Stop MongoDB if we have a reference
  const mongod = (global as any).__E2E_MONGOD__;
  if (mongod) {
    await mongod.stop();
    console.log('[E2E] MongoDB stopped');
  }
}
