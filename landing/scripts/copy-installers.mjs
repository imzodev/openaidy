import { copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const publicDir = resolve(here, '..', 'public');

copyFileSync(join(root, 'install.sh'), join(publicDir, 'install.sh'));
copyFileSync(join(root, 'install.ps1'), join(publicDir, 'install.ps1'));

console.log('Synced install.sh and install.ps1 to landing/public/');
