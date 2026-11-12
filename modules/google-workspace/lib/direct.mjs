import fs from 'node:fs';
import { configuration, credentialPath, validateCall } from './access.mjs';

export async function createGoogleRequest(account, service, { env = process.env, readFile = p => fs.readFileSync(p, 'utf8'), fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  validateCall(account, 'search_gmail_messages');
  if (!['calendar', 'drive'].includes(service)) throw new Error('Unsupported direct API service.');
  const config = configuration(env);
  let credentials, client;
  try {
    credentials = JSON.parse(readFile(credentialPath(config.WORKSPACE_MCP_CREDENTIALS_DIR, account)));
    client = JSON.parse(readFile(config.GOOGLE_CLIENT_SECRET_PATH)).installed;
  } catch { throw new Error('Local account credential or Desktop OAuth client could not be read.'); }
  if (!client?.client_id || !client?.client_secret || !credentials.refresh_token) throw new Error('A Desktop OAuth client and account refresh credential are required.');
  const scopes = credentials.scopes ?? String(credentials.scope ?? '').split(/\s+/);
  if (!Array.isArray(scopes) || !scopes.some(s => typeof s === 'string' && (s === `https://www.googleapis.com/auth/${service}` || s.startsWith(`https://www.googleapis.com/auth/${service}.`)))) throw new Error('Account credential lacks the requested service scope.');
  const refresh = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: credentials.refresh_token, grant_type: 'refresh_token' }),
  });
  let token; try { token = await refresh.json(); } catch { throw new Error('OAuth token refresh returned an invalid response.'); }
  if (!refresh.ok || typeof token.access_token !== 'string' || !token.access_token) throw new Error('OAuth token refresh failed; complete account authorization separately.');
  return async (resource, { method = 'GET', params = {}, body, raw = false, upload = false, headers = {} } = {}) => {
    if (typeof resource !== 'string' || resource.startsWith('/') || resource.includes('..') || /[?#:\\]/.test(resource)) throw new Error('Expected a relative Google API resource path.');
    const base = service === 'calendar' ? 'https://www.googleapis.com/calendar/v3/' : upload ? 'https://www.googleapis.com/upload/drive/v3/' : 'https://www.googleapis.com/drive/v3/';
    const url = new URL(resource, base);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    if (service === 'drive') url.searchParams.set('supportsAllDrives', 'true');
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { ...(body !== undefined ? { 'Content-Type': headers['Content-Type'] ?? 'application/json' } : {}), Authorization: `Bearer ${token.access_token}` }, ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) });
    if (!response.ok) { const error = new Error(`Google ${service} API request failed (${response.status}).`); error.status = response.status; throw error; }
    if (response.status === 204) return null;
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}
