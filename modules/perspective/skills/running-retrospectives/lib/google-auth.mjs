// google-auth — mint an access token from the credentials the google-workspace MCP server already
// holds, so a reader can reach Drive or Gmail with NO new grant, NO browser and NO broad system permission.
//
// WHY IT REUSES RATHER THAN ASKS. The person's standing rule is that a capability never buys
// itself a wider permission than the job needs, and Full Disk Access is never the answer. These
// files are a per-account OAuth refresh token the user has ALREADY granted to a tool they run — the
// narrow path, and the only one this module takes. It never writes them, never widens their scopes,
// and never prints a token value.
//
//   ~/.config/google-workspace-mcp/credentials/<email>.json
//   { client_id, client_secret, refresh_token, token_uri, scopes[], token, expiry }
//
// A missing file is a MISSING CAPABILITY, not an error to work around: the caller records the source
// as `unavailable` and says which account was looked for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CRED_DIR = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'credentials');

/** Which accounts have a stored credential. Never reads their contents. */
export function googleAccounts(dir = CRED_DIR) {
	try {
		return fs.readdirSync(dir)
			.filter((f) => f.endsWith('.json') && f !== 'oauth_states.json')
			.map((f) => f.replace(/\.json$/, ''))
			.sort();
	} catch { return []; }
}

/**
 * An access token for `email`, refreshed if the stored one has expired.
 * Returns null when there is no credential for that account — the caller decides what that means.
 * Never logs, returns or embeds `client_secret` or `refresh_token`.
 */
export async function accessTokenFor(email, dir = CRED_DIR) {
	const file = path.join(dir, `${email}.json`);
	if (!fs.existsSync(file)) return null;
	let cred;
	try { cred = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }

	// A stored token with real time left is used as-is — refreshing on every run would spend a
	// request per invocation for nothing. Sixty seconds of slack covers a slow read.
	const expiry = Date.parse(cred.expiry ?? '');
	if (cred.token && Number.isFinite(expiry) && expiry - Date.now() > 60_000) return cred.token;

	if (!cred.refresh_token || !cred.client_id || !cred.client_secret) return null;
	const res = await fetch(cred.token_uri || 'https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: cred.client_id,
			client_secret: cred.client_secret,
			refresh_token: cred.refresh_token,
			grant_type: 'refresh_token',
		}),
	});
	if (!res.ok) return null;                       // a revoked grant is unavailable, not a crash
	const json = await res.json().catch(() => null);
	return json?.access_token ?? null;
}

/** One authenticated Google API call. An ARRAY value is appended once per element — the Gmail API
 *  takes `metadataHeaders` repeated, and a `set` would keep only the last. A 429 or 5xx is retried
 *  three times with a growing pause, because a per-thread read of a year's mail WILL hit the
 *  per-user rate limit, and a reader that dies near the end has wasted everything before it. */
export async function gapi(token, base, endpoint, params = {}, { retries = 3 } = {}) {
	const url = new URL(`${base}/${endpoint}`);
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
		else url.searchParams.set(k, String(v));
	}
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
		if (res.ok) return res.json();
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= retries) throw new Error(`${base.split('/')[2]} ${endpoint} → ${res.status} ${(await res.text()).slice(0, 200)}`);
		await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
	}
}

/** One authenticated Drive API call. Throws on a non-2xx so the caller can report the status. */
export const drive = (token, endpoint, params = {}) => gapi(token, 'https://www.googleapis.com/drive/v3', endpoint, params);
/** One authenticated Gmail API call against the signed-in user's own mailbox. */
export const gmail = (token, endpoint, params = {}) => gapi(token, 'https://gmail.googleapis.com/gmail/v1/users/me', endpoint, params);
