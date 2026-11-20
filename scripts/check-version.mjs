import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const nativeVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (pkg.version !== conf.version || pkg.version !== nativeVersion) {
  throw new Error(`Version mismatch: package=${pkg.version}, Tauri=${conf.version}, Cargo=${nativeVersion}`);
}
console.log(`All application versions: ${pkg.version}`);
