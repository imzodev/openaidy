import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Load .env from workspace root (3 levels up: src -> server -> apps -> root)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '../../../.env');

console.log('[DEBUG] Looking for .env at:', envPath);
console.log('[DEBUG] .env exists:', existsSync(envPath));

const result = dotenvConfig({ path: envPath });
console.log('[DEBUG] Dotenv loaded:', result.parsed ? 'yes' : 'no');
if (result.error) {
  console.log('[DEBUG] Dotenv error:', result.error.message);
}

import { buildApp } from './app';
import { env } from './lib/env';

console.log('[DEBUG] Environment check:');
console.log('[DEBUG] ZAI_API_KEY exists:', !!process.env.ZAI_API_KEY);
console.log('[DEBUG] OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);

const app = await buildApp();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
