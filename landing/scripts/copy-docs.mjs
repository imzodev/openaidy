import { cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const source = join(root, 'docs');
const dest = join(here, '..', 'public', 'docs');

try {
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true });
} catch (error) {
  console.error('Failed to sync docs/ to landing/public/docs/:', error);
  process.exit(1);
}

console.log('Synced docs/ to landing/public/docs/');
