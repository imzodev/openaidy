import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from workspace root (3 levels up: src -> server -> apps -> root)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '../../../.env');

dotenvConfig({ path: envPath });

import { buildApp } from './app';
import { env } from './lib/env';
import { logger } from './lib/logger';

const app = await buildApp();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  logger.error('Server failed to start', error);
  process.exit(1);
}

// Graceful shutdown. The CLI (`openaidy stop` / `openaidy restart`) sends
// SIGTERM to this process; the self-update flow hands off to a detached
// `openaidy restart` which does the same. Close Fastify (runs onClose hooks:
// scheduler stop, DB close, WAL checkpoint) so we don't drop in-flight work or
// leave a half-flushed database behind. Escalation to SIGKILL after 10s is
// handled by the CLI stop path, so a hung close can't wedge a restart.
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);
  app
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Error during graceful shutdown', error);
      process.exit(1);
    });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
