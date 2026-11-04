// The module scope (cr-modules-008 §4): built from the workspace's compiled runtime and the person's grant —
// never from anything a module's own files declare beyond its own collections.
import { SYSTEM_COLLECTIONS } from './gate.js';

export const MODULE_READ_ROUTES = ['info', 'schema', 'presentation', 'records-list', 'record-read', 'values', 'commands'];
export const MODULE_WRITE_ROUTES = ['records-create', 'record-update', 'record-remove', 'position'];
export const MODULE_ROUTES = [...MODULE_READ_ROUTES, ...MODULE_WRITE_ROUTES];
const settings = "this workspace's .vscode/settings.json";

/**
 * @param {{ module: string, home: string, collectionsRows: Array<{id: string, $module?: string}>,
 *   descriptors: Array<{name: string, fields?: object, compiled?: {overlaid_by?: string[]}, runtime?: boolean}>,
 *   grant: Record<string, {reads?: string[], writes?: string[]}> }} input
 */
export function buildModuleScope({ module, home, collectionsRows, descriptors, grant }) {
	const ownerOf = new Map(collectionsRows.map((r) => [r.id, r.$module]));
	const byName = new Map(descriptors.map((d) => [d.name, d]));
	const own = new Set(descriptors
		.filter((d) => ownerOf.get(d.name) === module && !SYSTEM_COLLECTIONS.has(d.name) && d.runtime !== true && (d.compiled?.overlaid_by ?? []).length === 0)
		.map((d) => d.name));
	const referenced = new Set();
	for (const c of own) for (const f of Object.values(byName.get(c)?.fields ?? {})) if (byName.has(f?.type)) referenced.add(f.type);
	const g = grant?.[module] ?? {};
	const reads = new Set([...own, ...(g.reads ?? []).filter((c) => referenced.has(c) && !SYSTEM_COLLECTIONS.has(c)), 'ui-views']);
	const writes = new Map((g.writes ?? []).filter((c) => own.has(c))
		.map((c) => [c, { ops: new Set(['create', 'update', 'delete', 'position']), fields: 'own-fields', mirroredRefs: 'refuse', commit: false }]));
	const label = `module app ${module}`;
	const ownList = [...own].sort().join(', ');
	const owner = (c) => ownerOf.get(c) ?? 'no module';
	return {
		kind: 'module', module, home, label, own, reads, writes,
		routes: new Set(MODULE_ROUTES), // the writes map decides; a write with no grant gets the grant sentence
		sentences: {
			route: (s, d) => `${label} cannot call ${d.method} ${d.pattern}: a module app reads and writes records only`,
			collectionRead: (s, d) => `${label} cannot read ${d.collection}: it belongs to ${owner(d.collection)} — a module app reads only its own collections (${ownList}) and what ${settings} grants it`,
			collectionWrite: (s, d) => d.reason
				? `${label} cannot ${d.op ?? 'write'} ${d.collection}: ${d.reason}`
				: own.has(d.collection)
					? `${label} cannot write ${d.collection}: no write is granted to it — grant one in dreamteamer.moduleApps in ${settings}`
					: `${label} cannot write ${d.collection}: it belongs to ${owner(d.collection)} — a module app writes only its own collections, and only what this workspace grants it`,
			field: (s, d) => `${label} cannot set ${d.field} on ${d.collection}`,
			filter: (s, d) => `${label}: ${d.reason}`,
			query: (s, d) => `${label} cannot pass ${d.key} on a write`,
		},
	};
}
