import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = { ...process.env };
const args = ['build', '--ci'];
const overlay = { bundle: {} };
if (env.BUILD_TARGET) args.push('--target', env.BUILD_TARGET);
if (env.BUILD_BUNDLE) args.push('--bundles', env.BUILD_BUNDLE);
// Empty optional secrets must not override Tauri's ad-hoc macOS signing default.
for (const key of Object.keys(env)) {
  if ((key.startsWith('APPLE_') || key.startsWith('TAURI_SIGNING_')) && !env[key]) delete env[key];
}
if (env.APPLE_SIGNING_IDENTITY && process.platform === 'darwin') {
  overlay.bundle.macOS = { signingIdentity: env.APPLE_SIGNING_IDENTITY };
}
if (env.ENABLE_UPDATER === 'true') {
  for (const key of ['MY_TOOLS_UPDATE_ENDPOINT', 'MY_TOOLS_UPDATE_PUBKEY', 'TAURI_SIGNING_PRIVATE_KEY']) {
    if (!env[key]) throw new Error(`Updater build requires ${key}`);
  }
  const endpoint = new URL(env.MY_TOOLS_UPDATE_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Updater endpoint must be HTTPS without embedded credentials.');
  }
  overlay.bundle.createUpdaterArtifacts = true;
  args.push('--features', 'updater');
} else {
  delete env.MY_TOOLS_UPDATE_ENDPOINT;
  delete env.MY_TOOLS_UPDATE_PUBKEY;
}
if (Object.keys(overlay.bundle).length) {
  const config = new URL('../src-tauri/tauri.updater.generated.json', import.meta.url);
  writeFileSync(config, JSON.stringify(overlay, null, 2));
  args.push('--config', 'src-tauri/tauri.updater.generated.json');
}
args.push('--', '--locked');
const cli = require.resolve('@tauri-apps/cli/tauri.js');
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
