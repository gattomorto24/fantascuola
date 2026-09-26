import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) { await check(url); continue; }
    if (!/\.(js|mjs)$/.test(entry.name)) continue;
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*(['"])(\.[^'"]+)\1/g)) {
      const imported = new URL(match[2].split('?')[0], url);
      try { await access(imported); }
      catch { throw new Error(`Import inesistente: ${fileURLToPath(url)} → ${match[2]}`); }
    }
  }
}

await check(new URL('../js/', import.meta.url));
console.log('Import relativi Free Roam verificati.');
