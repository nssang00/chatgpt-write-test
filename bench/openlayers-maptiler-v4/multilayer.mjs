import {copyFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
await copyFile(join(root, 'app4.js'), join(root, 'app2.js'));
await import('./benchmark.mjs');
