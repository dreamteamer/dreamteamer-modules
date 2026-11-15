import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const CODE_SERVER_VERSION = '4.138.0';
export function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} failed (${code ?? signal})`)));
  });
}
export async function ensureRuntime(home, explicit) {
  if (explicit) return path.resolve(explicit);
  if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) throw new Error('Supported hosts: macOS and Linux, arm64 or x64.');
  const platform = process.platform === 'darwin' ? 'macos' : 'linux';
  const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
  const name = `code-server-${CODE_SERVER_VERSION}-${platform}-${arch}`;
  const executable = path.join(home, name, 'bin/code-server');
  try { await fs.access(executable); return executable; } catch {}
  console.error(`Installing code-server ${CODE_SERVER_VERSION} for ${platform}/${arch}…`);
  const response = await fetch(`https://api.github.com/repos/coder/code-server/releases/tags/v${CODE_SERVER_VERSION}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`);
  const release = await response.json();
  const asset = release.assets?.find(a => a.name === name + '.tar.gz');
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) throw new Error('Release has no SHA-256 verified archive for this host. Use --code-server with an installed executable.');
  const archive = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180000) });
  if (!archive.ok) throw new Error(`Download failed: ${archive.status}`);
  const bytes = Buffer.from(await archive.arrayBuffer());
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest) throw new Error('code-server archive checksum mismatch');
  const staging = await fs.mkdtemp(path.join(home, '.install-'));
  try {
    const file = path.join(staging, 'runtime.tgz'); await fs.writeFile(file, bytes, { mode: 0o600 });
    await run('tar', ['-xzf', file, '-C', staging]);
    await fs.rename(path.join(staging, name), path.join(home, name));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return executable;
}
