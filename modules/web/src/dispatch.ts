// The one listener's prefix dispatcher (cr-modules-017 §1). A raw pathname — never decoded, never case-folded, never
// normalised — names exactly one kind or none; what is not named here is 404 before any auth or handler runs. A
// path reaches the API only when it begins `/api/` as written.
export const PREFIXES = [
	{ kind: 'sign-in', prefix: '/sign-in/' }, { kind: 'shell', prefix: '/app/' }, { kind: 'root', exact: '/' },
	{ kind: 'api', prefix: '/api/' }, { kind: 'dt', prefix: '/_dt/' }, { kind: 'files', prefix: '/_files/' }, { kind: 'frames', prefix: '/_frames/' },
];

/** @param {string} pathname the request's path as it arrived, query removed @returns {string|null} */
export function classify(pathname) {
	if (typeof pathname !== 'string') return null;
	for (const p of PREFIXES) {
		if (p.exact !== undefined ? pathname === p.exact : pathname.startsWith(p.prefix)) return p.kind;
	}
	return null;
}
