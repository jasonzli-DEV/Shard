import 'dotenv/config';
import { createApp } from './app';
import { connectStarter } from './lib/db';
import { logger } from './utils/logger';
import { startStorageLoops } from './storage/scheduler';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const STARTER_URI = process.env.STARTER_MONGODB_URI;

async function main(): Promise<void> {
  if (!STARTER_URI) {
    logger.error('STARTER_MONGODB_URI is not set — exiting');
    process.exit(1);
  }

  await connectStarter(STARTER_URI);

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`Shard backend listening on port ${PORT}`);
  });

  // Start background storage loops only when not in test mode
  if (process.env.NODE_ENV !== 'test') {
    startStorageLoops();
    logger.info('Storage background loops started');
  }
}

main().catch((err: Error) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
