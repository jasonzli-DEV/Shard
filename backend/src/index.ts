import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import { createApp } from './app';
import { connectRuntime } from './lib/runtime';
import { logger } from './utils/logger';

// Load values persisted by the setup wizard (written to SETUP_ENV_FILE_PATH,
// a mounted volume) so configuration survives container restarts. These
// override the base .env baked in via env_file, since the wizard is the
// source of truth once setup has run.
const SETUP_ENV_FILE_PATH =
  process.env.SETUP_ENV_FILE_PATH ?? `${process.cwd()}/config/.env`;
if (fs.existsSync(SETUP_ENV_FILE_PATH)) {
  dotenv.config({ path: SETUP_ENV_FILE_PATH, override: true });
  logger.info(`Loaded persisted setup config from ${SETUP_ENV_FILE_PATH}`);
}

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const STARTER_URI = process.env.STARTER_MONGODB_URI;

async function main(): Promise<void> {
  // Always start the HTTP server so the health check and the setup wizard
  // (/api/setup/*) are reachable.
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`Shard backend listening on port ${PORT}`);
  });

  if (STARTER_URI) {
    // Already configured — bring the runtime fully online.
    await connectRuntime(STARTER_URI);
  } else {
    // Setup mode: no starter cluster yet. The setup wizard is served and, on
    // successful /configure, calls connectRuntime() to activate the app live —
    // no restart required. (On a fresh boot with persisted config, STARTER_URI
    // is loaded from SETUP_ENV_FILE_PATH above and this branch is skipped.)
    logger.warn(
      'STARTER_MONGODB_URI not set — running in SETUP MODE. ' +
        'Complete the setup wizard in the browser to activate Shard.',
    );
  }
}

main().catch((err: Error) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
