import { cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const source = join(root, 'docs');
const dest = join(here, '..', 'public', 'docs');

rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });

console.log('Synced docs/ to landing/public/docs/');
