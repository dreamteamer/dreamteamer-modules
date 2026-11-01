// THE ROUTE TABLE — the host protocol as data. PROTOCOL.md is the same list as prose, one
// `### <METHOD> <pattern>` section per entry, and test/routes.test.mjs keeps the two equal.
//
// A pattern is everything after `/api`. `:name` is ONE path segment, percent-decoded — so a namespaced
// collection (`lab/samples`) is sent encoded (`lab%2Fsamples`). `*name` is greedy and always last:
// record ids are paths (`2026/11/x`) and are sent unencoded.

/** @type {import('./routes.d.ts').Route[]} */
export const ROUTES = [
	{ id: 'info', method: 'GET', pattern: '/info', doc: 'get-info' },
	{ id: 'schema', method: 'GET', pattern: '/schema', doc: 'get-schema' },
	{ id: 'presentation', method: 'GET', pattern: '/presentation', doc: 'get-presentation' },
	{ id: 'sources', method: 'GET', pattern: '/sources', doc: 'get-sources' },
	{ id: 'activity', method: 'GET', pattern: '/activity', doc: 'get-activity' },
	{ id: 'nav', method: 'GET', pattern: '/nav', doc: 'get-nav' },
	{ id: 'scope', method: 'PUT', pattern: '/scope', doc: 'put-scope' },
	{ id: 'field-add', method: 'POST', pattern: '/fields/:collection', doc: 'post-fields-collection' },
	{ id: 'field-edit', method: 'PATCH', pattern: '/fields/:collection/:field', doc: 'patch-fields-collection-field' },
	{ id: 'field-remove', method: 'DELETE', pattern: '/fields/:collection/:field', doc: 'delete-fields-collection-field' },
	{ id: 'field-rename', method: 'POST', pattern: '/fields/:collection/:field/rename', doc: 'post-fields-collection-field-rename' },
	{ id: 'field-rename-value', method: 'POST', pattern: '/fields/:collection/:field/rename-value', doc: 'post-fields-collection-field-rename-value' },
	{ id: 'folder', method: 'GET', pattern: '/folder/:collection/*id', doc: 'get-folder-collection-id' },
	{ id: 'values', method: 'GET', pattern: '/collections/:collection/values/:field', doc: 'get-collections-collection-values-field' },
	{ id: 'records-list', method: 'GET', pattern: '/collections/:collection/records', doc: 'get-collections-collection-records' },
	{ id: 'records-create', method: 'POST', pattern: '/collections/:collection/records', doc: 'post-collections-collection-records' },
	{ id: 'record-read', method: 'GET', pattern: '/collections/:collection/records/*id', doc: 'get-collections-collection-records-id' },
	{ id: 'record-update', method: 'PATCH', pattern: '/collections/:collection/records/*id', doc: 'patch-collections-collection-records-id' },
	{ id: 'record-remove', method: 'DELETE', pattern: '/collections/:collection/records/*id', doc: 'delete-collections-collection-records-id' },
	{ id: 'file-import', method: 'POST', pattern: '/collections/:collection/files', doc: 'post-collections-collection-files' },
	{ id: 'position', method: 'PATCH', pattern: '/collections/:collection/position/*id', doc: 'patch-collections-collection-position-id' },
	{ id: 'rename', method: 'POST', pattern: '/collections/:collection/rename', doc: 'post-collections-collection-rename' },
	{ id: 'revert', method: 'POST', pattern: '/collections/:collection/records-revert/*id', doc: 'post-collections-collection-records-revert-id' },
	{ id: 'commands', method: 'GET', pattern: '/commands/:collection', doc: 'get-commands-collection' },
	{ id: 'commit', method: 'POST', pattern: '/commit', doc: 'post-commit' },
	{ id: 'history', method: 'GET', pattern: '/history/:collection/*id', doc: 'get-history-collection-id' },
	{ id: 'history-diff', method: 'GET', pattern: '/history-diff/:collection/*id', doc: 'get-history-diff-collection-id' },
	{ id: 'reload', method: 'POST', pattern: '/reload', doc: 'post-reload' },
];

const compiled = ROUTES.map((route) => {
	const names = [];
	const source = route.pattern.split('/').map((seg) => {
		if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
		if (seg.startsWith('*')) { names.push(seg.slice(1)); return '(.+)'; }
		return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}).join('/');
	return { route, names, re: new RegExp(`^${source}/?$`) };
});

/**
 * The route a request names, and its params (each `:param` percent-decoded; a `*param` kept as the
 * path it is, each segment decoded). The query string is ignored. `null` when no route has that
 * method and path — the "no route" a host answers 404.
 * @param {string} method
 * @param {string} rawPath everything after `/api`, query included or not
 */
export function matchRoute(method, rawPath) {
	const pathname = String(rawPath).split('?')[0];
	const m = String(method).toUpperCase();
	for (const { route, names, re } of compiled) {
		if (route.method !== m) continue;
		const hit = re.exec(pathname);
		if (!hit) continue;
		const params = {};
		names.forEach((n, i) => { params[n] = hit[i + 1].split('/').map(decodeURIComponent).join('/'); });
		return { route, params };
	}
	return null;
}
