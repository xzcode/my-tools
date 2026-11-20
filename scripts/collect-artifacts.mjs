import { readdirSync, readFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const target = process.env.BUILD_TARGET || '';
const root = join('src-tauri', 'target', target, 'release', 'bundle');
const matches = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith('.app')) walk(path);
    else if (entry.isFile() && /\.(dmg|exe|msi|deb|rpm|AppImage|sig)$|\.app\.tar\.gz$/.test(entry.name)) matches.push(path);
  }
}
walk(root);
if (!matches.length) throw new Error('Build produced no supported installer files.');
mkdirSync('artifacts', { recursive: true });
const checksums = [];
for (const path of matches) {
  const name = basename(path);
  copyFileSync(path, join('artifacts', name));
  checksums.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${name}`);
}
writeFileSync(join('artifacts', `SHA256SUMS-${target || process.platform}.txt`), `${checksums.join('\n')}\n`);
console.log(`Collected ${matches.length} installer/update files and SHA-256 checksums.`);
