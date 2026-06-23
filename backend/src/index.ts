import 'dotenv/config';
import { createApp } from './app';
import { connectRuntime } from './lib/runtime';
import { loadConfig } from './config/configService';
import { logger } from './utils/logger';

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
    // Load DB-stored config into memory so getConfig() returns DB values
    // for OAuth creds, publicUrl, allowedOrigins, etc.
    await loadConfig();
  } else {
    // Setup mode: no starter cluster yet. The setup wizard is served and, on
    // successful /configure, calls connectRuntime() and loadConfig() to
    // activate the app live — no restart required.
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
