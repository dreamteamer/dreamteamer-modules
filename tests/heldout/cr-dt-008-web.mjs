// The one place the cr-dt-008 held-outs reach `dt web` (hm3, hm4): where its API answers and how a request signs in.
//
// web 0.2.0 (this branch) resolves `{ appUrl, token, … }` with a second listener for files; web 0.3.0 (the pane
// branch, feat/pane-cr-modules-017) resolves `{ url, … }` on one listener and signs in by cookie or a client token.
// The base URL is read here for both; sign-in is 0.2.0's bearer token, and the pane branch adapts `authHeaders`
// here and nowhere else.

/** The origin `/api/…` is asked at: `web.appUrl` (0.2.0) or `web.url` (0.3.0). Throws, naming what it got, when
 *  neither is there — never `undefined/api/nav`, which fetch rejects with a message that says nothing about why. */
export function apiBase(web) {
	const base = web?.appUrl ?? web?.url;
	if (typeof base !== 'string' || !base) throw new Error(`dt web resolved no appUrl or url — it resolved { ${Object.keys(web ?? {}).join(', ')} }`);
	return base.replace(/\/+$/, '');
}

/** The headers that sign one request in. */
export function authHeaders(web) {
	return web?.token ? { authorization: `Bearer ${web.token}` } : {};
}

/** Per-test ceilings: a hung request or child fails its own test instead of stalling the suite. */
export const TIMEOUT = { test: 120_000, hook: 180_000 };
