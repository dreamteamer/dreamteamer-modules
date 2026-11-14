// THE ROUTE TABLE — the host protocol as data. PROTOCOL.md is the same list as prose, one
// `### <METHOD> <pattern>` section per entry, and test/routes.test.mjs keeps the two equal.
//
// A pattern is everything after `/api`. `:name` is ONE path segment, percent-decoded — so a namespaced
// collection (`lab/samples`) is sent encoded (`lab%2Fsamples`). `*name` is greedy and always last:
// record ids are paths (`2026/11/x`) and are sent unencoded.
//
// `level` is the least a pane must be at to be answered: `read` (every GET, and PUT /selection — a Read pane
// still reports its place), `edit` (record writes, the nav writes, POST /queue), `admin` (fields, rename, revert,
// commit, reload). A host that enforces levels (dt web) refuses a route above the pane's; the editor answers all.

/** @type {import('./routes.d.ts').Route[]} */
export const ROUTES = [
	{ id: 'info', method: 'GET', pattern: '/info', doc: 'get-info', level: 'read' },
	{ id: 'schema', method: 'GET', pattern: '/schema', doc: 'get-schema', level: 'read' },
	{ id: 'presentation', method: 'GET', pattern: '/presentation', doc: 'get-presentation', level: 'read' },
	{ id: 'sources', method: 'GET', pattern: '/sources', doc: 'get-sources', level: 'read' },
	{ id: 'sources-access', method: 'GET', pattern: '/sources/access', doc: 'get-sources-access', level: 'read' },
	{ id: 'sources-access-members', method: 'GET', pattern: '/sources/access/members', doc: 'get-sources-access-members', level: 'read' },
	{ id: 'activity', method: 'GET', pattern: '/activity', doc: 'get-activity', level: 'read' },
	{ id: 'nav', method: 'GET', pattern: '/nav', doc: 'get-nav', level: 'read' },
	{ id: 'nav-put', method: 'PUT', pattern: '/nav', doc: 'put-nav', level: 'edit' },
	{ id: 'nav-patch', method: 'PATCH', pattern: '/nav', doc: 'patch-nav', level: 'edit' },
	{ id: 'field-add', method: 'POST', pattern: '/fields/:collection', doc: 'post-fields-collection', level: 'admin' },
	{ id: 'field-edit', method: 'PATCH', pattern: '/fields/:collection/:field', doc: 'patch-fields-collection-field', level: 'admin' },
	{ id: 'field-remove', method: 'DELETE', pattern: '/fields/:collection/:field', doc: 'delete-fields-collection-field', level: 'admin' },
	{ id: 'field-rename', method: 'POST', pattern: '/fields/:collection/:field/rename', doc: 'post-fields-collection-field-rename', level: 'admin' },
	{ id: 'field-rename-value', method: 'POST', pattern: '/fields/:collection/:field/rename-value', doc: 'post-fields-collection-field-rename-value', level: 'admin' },
	{ id: 'folder', method: 'GET', pattern: '/folder/:collection/*id', doc: 'get-folder-collection-id', level: 'read' },
	{ id: 'values', method: 'GET', pattern: '/collections/:collection/values/:field', doc: 'get-collections-collection-values-field', level: 'read' },
	{ id: 'records-list', method: 'GET', pattern: '/collections/:collection/records', doc: 'get-collections-collection-records', level: 'read' },
	{ id: 'records-create', method: 'POST', pattern: '/collections/:collection/records', doc: 'post-collections-collection-records', level: 'edit' },
	{ id: 'record-read', method: 'GET', pattern: '/collections/:collection/records/*id', doc: 'get-collections-collection-records-id', level: 'read' },
	{ id: 'record-update', method: 'PATCH', pattern: '/collections/:collection/records/*id', doc: 'patch-collections-collection-records-id', level: 'edit' },
	{ id: 'record-remove', method: 'DELETE', pattern: '/collections/:collection/records/*id', doc: 'delete-collections-collection-records-id', level: 'edit' },
	{ id: 'file-import', method: 'POST', pattern: '/collections/:collection/files', doc: 'post-collections-collection-files', level: 'edit' },
	{ id: 'position', method: 'PATCH', pattern: '/collections/:collection/position/*id', doc: 'patch-collections-collection-position-id', level: 'edit' },
	{ id: 'rename', method: 'POST', pattern: '/collections/:collection/rename', doc: 'post-collections-collection-rename', level: 'admin' },
	{ id: 'revert', method: 'POST', pattern: '/collections/:collection/records-revert/*id', doc: 'post-collections-collection-records-revert-id', level: 'admin' },
	{ id: 'commands', method: 'GET', pattern: '/commands/:collection', doc: 'get-commands-collection', level: 'read' },
	{ id: 'notes', method: 'GET', pattern: '/notes/:collection', doc: 'get-notes-collection', level: 'read' },
	{ id: 'commit', method: 'POST', pattern: '/commit', doc: 'post-commit', level: 'admin' },
	{ id: 'history', method: 'GET', pattern: '/history/:collection/*id', doc: 'get-history-collection-id', level: 'read' },
	{ id: 'history-diff', method: 'GET', pattern: '/history-diff/:collection/*id', doc: 'get-history-diff-collection-id', level: 'read' },
	{ id: 'reload', method: 'POST', pattern: '/reload', doc: 'post-reload', level: 'admin' },
	{ id: 'host', method: 'GET', pattern: '/host', doc: 'get-host', level: 'read' },
	{ id: 'selection-put', method: 'PUT', pattern: '/selection', doc: 'put-selection', level: 'read' },
	{ id: 'selection-get', method: 'GET', pattern: '/selection', doc: 'get-selection', level: 'read' },
	{ id: 'queue-post', method: 'POST', pattern: '/queue', doc: 'post-queue', level: 'edit' },
	{ id: 'queue-get', method: 'GET', pattern: '/queue', doc: 'get-queue', level: 'read' },
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
