import fs from 'node:fs';
import { configuration, credentialPath, validateCall } from './access.mjs';
import { connect } from './client.mjs';

export function storedAccounts({ env = process.env, list = p => fs.readdirSync(p) } = {}) {
  const config = configuration(env);
  let names; try { names = list(config.WORKSPACE_MCP_CREDENTIALS_DIR); } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Credential directory could not be listed.'); }
  const accounts = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const email = decodeURIComponent(name.slice(0, -5));
      validateCall(email, 'search_gmail_messages');
      accounts.push({ account: email, state: 'stored_not_verified' });
    } catch { /* Not an account credential filename. */ }
  }
  return accounts.sort((a, b) => a.account.localeCompare(b.account));
}
function consentUrl(result) {
  const text = (result?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const candidate = text.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s<>"']+/)?.[0]?.replace(/[)\]]+$/, '');
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.google.com' || parsed.port || parsed.username || parsed.password || parsed.hash) return null;
    if (!['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(parsed.pathname)) return null;
    for (const key of ['redirect_uri', 'state', 'response_type', 'client_id']) {
      if (parsed.searchParams.getAll(key).length !== 1 || !parsed.searchParams.get(key).trim()) return null;
    }
    if (parsed.searchParams.get('response_type') !== 'code') return null;
    const redirect = new URL(parsed.searchParams.get('redirect_uri'));
    if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) || redirect.username || redirect.password || redirect.hash || redirect.search || redirect.pathname !== '/oauth2callback') return null;
    return parsed.href;
  } catch { return null; }
}
export async function authorize({ account, platform = process.platform, allowWrite = false, env = process.env, connectionFactory = connect, fileExists = fs.existsSync, onConsentUrl = () => {}, signal, waitMs = 9 * 60 * 1000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (platform === 'win32') throw new Error('Manual OAuth authorization is not supported on Windows by this bridge; no server was started. Use a supported macOS or Linux setup.');
  if (signal?.aborted) throw new Error('Authorization cancelled.');
  validateCall(account, 'search_drive_files');
  const serverEnv = configuration(env);
  if (!fileExists(serverEnv.GOOGLE_CLIENT_SECRET_PATH)) throw new Error('OAuth client configuration is missing.');
  const credential = credentialPath(serverEnv.WORKSPACE_MCP_CREDENTIALS_DIR, account);
  if (fileExists(credential) && allowWrite) throw new Error('A credential already exists; auth --allow-write cannot broaden its scopes. Arrange owner-controlled reauthorization separately, or use a new dedicated local credential directory. Existing credentials are not modified.');
  if (fileExists(credential)) return { account, state: 'stored_not_verified', message: 'A credential already exists. Verify a read; this command does not delete or overwrite it.' };
  if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > 9 * 60 * 1000) throw new Error('Consent wait must be between 1 ms and nine minutes.');
  const client = connectionFactory({ env: serverEnv, args: ['--with', 'python-dotenv==1.2.3', 'workspace-mcp==2.4.2', '--transport', 'stdio', '--tools', 'gmail', 'drive', 'calendar', ...(allowWrite ? [] : ['--read-only'])] });
  const probe = () => client.send('tools/call', { name: 'search_drive_files', arguments: { user_google_email: account, query: 'trashed = false', page_size: 1 } });
  try {
    await client.ready();
    // Exactly one unauthenticated call; the owner opens the validated URL manually.
    const initial = await probe();
    const url = consentUrl(initial);
    if (!url) throw new Error('Server did not return a valid Google consent URL; account authorization is not established.');
    await onConsentUrl(url);
    const deadline = now() + waitMs;
    while (!fileExists(credential) && now() < deadline) {
      if (signal?.aborted) throw new Error('Authorization cancelled.');
      await sleep(Math.min(1000, deadline - now()));
    }
    if (signal?.aborted) throw new Error('Authorization cancelled.');
    if (!fileExists(credential)) throw new Error('Consent timed out. Start a fresh explicit authorization when ready.');
    const verification = await probe();
    const text = (verification?.content ?? []).map(c => c.text ?? '').join('\n');
    if (!verification || verification.isError || consentUrl(verification) || /Authentication Needed|ACTION REQUIRED/i.test(text)) throw new Error('Credential appeared, but the verification read failed.');
    return { account, state: 'verified_read', service: 'drive', message: 'Consent and one Drive read succeeded. Other services still need acceptance checks.' };
  } finally { client.close(); }
}
