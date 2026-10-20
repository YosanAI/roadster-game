import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Check syntax without starting a browser or evaluating DOM-dependent modules. */
async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

const files = [
  ...(await javascriptFiles('src')),
  ...(await javascriptFiles('tests')),
  ...(await javascriptFiles('scripts')),
  'vite.config.js',
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);
