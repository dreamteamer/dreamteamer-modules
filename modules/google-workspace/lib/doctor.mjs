import fs from 'node:fs';
import path from 'node:path';

export function doctor({ env = process.env, accessible = p => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } } } = {}) {
  const executable = (env.PATH ?? '').split(path.delimiter).some(dir => {
    if (!dir) return false;
    try { fs.accessSync(path.join(dir, process.platform === 'win32' ? 'uvx.exe' : 'uvx'), fs.constants.X_OK); return true; } catch { return false; }
  });
  const checks = [{ label: 'workspace-mcp runtime', state: executable ? 'ok' : 'bad', detail: executable ? 'uvx is available; server package is pinned when started.' : 'uvx is not available.', fix: 'Install uv from its official distribution after owner approval.' }];
  for (const [key, label] of [['GOOGLE_CLIENT_SECRET_PATH', 'OAuth client configuration'], ['WORKSPACE_MCP_CREDENTIALS_DIR', 'Local account credential store']]) {
    const ok = !!env[key] && path.isAbsolute(env[key]) && accessible(env[key]);
    checks.push({ label, state: ok ? 'ok' : 'bad', detail: ok ? 'Configured local path is readable; account authorization is not verified.' : 'Required absolute local path is missing or unreadable.', fix: `Configure ${key} outside Git and complete owner-controlled setup.` });
  }
  checks.push({
    label: 'Account authorization',
    state: 'warn',
    detail: 'Not verified. Local paths and stored files do not prove current authorization.',
    fix: 'After owner-controlled consent, verify a read for each intended account on this computer. Doctor performs no live account calls.'
  });
  return { checks };
}
