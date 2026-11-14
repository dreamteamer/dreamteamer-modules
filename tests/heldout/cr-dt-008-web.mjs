// The one place the cr-dt-008 held-outs reach `dt web` (hm3, hm4): where its API answers and how a request signs in.
//
// web 0.2.0 (feat/presets-nav-cr-dt-008) resolves `{ appUrl, token, … }` with a second listener for files; web 0.3.0
// (the pane branch, feat/pane-cr-modules-017) resolves `{ url, controlToken, pair(), … }` on one listener, and /api/
// takes the pane's session cookie (from a sign-in URL `pair()` mints) or a client token — never the control token.
//
// Signing in on 0.3.0 is two requests to the server, and the server runs IN this process — but the held-outs call
// `authHeaders(web)` synchronously, spread into a request's headers. So on 0.3.0 `authHeaders` answers a marker
// header naming the server, and this module wraps `globalThis.fetch` (which `call()` and the held-outs both use):
// a request carrying the marker waits for that server's sign-in — once per server: GET the pair URL, take the
// `dt_pane_<port>` cookie, and set the workspace's level to edit under the control token, since hm3 and hm4 PATCH
// /nav — then goes out with the cookie and `Sec-Fetch-Site: same-origin` (what the pane's own page sends) in place
// of the marker. A request without the marker is passed through untouched.

const MARKER = 'x-cr-dt-008-sign-in';

/** The origin `/api/…` is asked at: `web.appUrl` (0.2.0) or `web.url` (0.3.0). Throws, naming what it got, when
 *  neither is there — never `undefined/api/nav`, which fetch rejects with a message that says nothing about why. */
export function apiBase(web) {
	const base = web?.appUrl ?? web?.url;
	if (typeof base !== 'string' || !base) throw new Error(`dt web resolved no appUrl or url — it resolved { ${Object.keys(web ?? {}).join(', ')} }`);
	if (!web.token && typeof web.pair === 'function') signIn(web).catch(() => { /* raised again by the request that waits on it */ });
	return base.replace(/\/+$/, '');
}

/** The headers that sign one request in: 0.2.0's bearer token, or 0.3.0's marker (see the top of this file). */
export function authHeaders(web) {
	if (web?.token) return { authorization: `Bearer ${web.token}` };
	if (typeof web?.pair === 'function') { signIn(web).catch(() => {}); return { [MARKER]: idOf(web) }; }
	return {};
}

/** Per-test ceilings: a hung request or child fails its own test instead of stalling the suite. */
export const TIMEOUT = { test: 120_000, hook: 180_000 };

// ---- 0.3.0 sign-in ----------------------------------------------------------------------------------------------
const realFetch = globalThis.fetch;
const servers = new Map(); // marker id → { web, signedIn: Promise<string cookie> }
const ids = new WeakMap();
let next = 0;
function idOf(web) {
	if (!ids.has(web)) { const id = String(++next); ids.set(web, id); servers.set(id, { web, signedIn: null }); }
	return ids.get(web);
}
function signIn(web) {
	const entry = servers.get(idOf(web));
	entry.signedIn ??= (async () => {
		const base = String(web.url).replace(/\/+$/, '');
		const r = await realFetch(web.pair(), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
		await r.arrayBuffer();
		const set = r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? ''];
		const cookie = set.map((c) => c.split(';')[0]).find((c) => /^dt_pane_\d+=/.test(c));
		if (r.status !== 302 || !cookie) throw new Error(`dt web sign-in answered ${r.status} with no dt_pane_ cookie`);
		const lv = await realFetch(`${base}/_dt/level`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ level: 'edit' }), signal: AbortSignal.timeout(20_000) });
		const lvText = await lv.text();
		if (lv.status !== 200) throw new Error(`dt web level edit answered ${lv.status}: ${lvText}`);
		return cookie;
	})();
	return entry.signedIn;
}

globalThis.fetch = async function fetchSignedIn(input, init) {
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	const id = headers.get(MARKER);
	if (id === null) return realFetch(input, init);
	const entry = servers.get(id);
	if (!entry) throw new Error(`${MARKER}: no dt web server ${id} in this process`);
	const cookie = await signIn(entry.web);
	headers.delete(MARKER);
	headers.set('cookie', cookie);
	headers.set('sec-fetch-site', 'same-origin');
	return realFetch(input, { ...init, headers });
};
