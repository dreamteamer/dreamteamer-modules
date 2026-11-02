/**
 * ─── PATH/SHAPE TRANSLATOR over the clean engine contract (adapter INVERTED at M3) ──────────────────
 *
 * Pre-M3, this module SYNTHESIZED the Directus-ish rows (collections/fields/relations) the ported
 * components speak from raw `/api/schema` descriptors, client-side (667 lines). At M3 that
 * projection moved server-side — `GET /api/presentation` (engine `src/presentation.js`) returns the
 * exact same row shapes — so this file shrank to a thin path/shape translator. Decision (vs. the
 * original "delete the adapter, rewrite the composables" plan): the adapter was INVERTED — the
 * useful mapping became a server projection, and the client keeps ONE entry point
 * (`adapterRequest`) that everything already speaks through via api/client.ts.
 *
 * What it still does:
 *  - old-wire paths (`/collections`, `/fields/:c`, `/relations`, `/items/…`, `/revisions/…`) →
 *    clean endpoints, with tiny row deltas patched at mapping time (provenance/layer constants,
 *    relation `meta` shape).
 *  - record value translation: relation refs are stored slashless (`collection/id`), the
 *    components' canonical form is `/collection/id` — normalized on read, stripped on write.
 *  - clean-contract passthroughs: `/collections/*` and `/fields/*` WRITES (schema writes — the host
 *    compiles + commits; the cached contract is invalidated after every successful one), `/info`,
 *    `/history-diff/…`, `/records-revert/…`.
 *
 * Still stubbed (accepted loss):
 *  - legacy presets (`/items/.schema/presets`): empty list, no-op writes — saved views are
 *    ui-view RECORDS now (`POST /collections/ui-views/records`, see composables/schema.ts).
 *  - /utils/infer (folder registration): 501 — no server surface yet.
 *  - /users/me: static local operator (no auth yet).
 * ──────────────────────────────────────────────────────────────────────────────────────────────────
 */

// NOTE: ApiError is defined in client.ts; the import is circular on paper but safe — this module
// only references it at call time, long after both modules have evaluated.
import { ApiError } from './client';
import { collectionRows, type PresentationCollection } from './collection-rows';
import type { CollectionRow, FieldRow } from './types';
import { hostRequest, HostError } from './transport';
import { normalizeFilterRefs } from '../lib/filter-wire';

export interface AdapterResult {
	data: unknown;
	raw: Record<string, unknown>;
}

// ---- clean-contract shapes -----------------------------------------------------------------


interface PresentationRelation {
	collection: string;
	field: string;
	related_collection: string;
	list: boolean;
	/** OWNING side only — the engine's own three names (`src/relations.js`). Absent on a mirror. */
	kind?: 'm2o' | 'o2o' | 'm2m';
	/** GENERATED MIRROR side. One relation emits TWO rows; this flags the derived one. */
	mirror?: true;
}

interface PresentationPayload {
	collections: PresentationCollection[];
	fields: Record<string, FieldRow[]>;
	relations: PresentationRelation[];
}

interface RelationRowShape {
	collection: string;
	field: string;
	related_collection: string | null;
	list: boolean;
	kind?: 'm2o' | 'o2o' | 'm2m';
	mirror?: true;
	meta: Record<string, unknown>;
}

interface CleanInfo {
	name: string;
	host?: string;
	compiled?: string;
	stale?: number;
}

interface Contract {
	info: CleanInfo;
	collections: CollectionRow[];
	fields: Map<string, FieldRow[]>;
	relations: RelationRowShape[];
	/** collection → relation-valued fields: field name → is-list. */
	relationFields: Map<string, Map<string, boolean>>;
}

// ---- raw fetch to the clean API ---------------------------------------------------------------

// No HTTP: the clean contract is answered in-process by the extension host over postMessage
// (api/transport.ts, decision 48). Signature and error semantics are unchanged, so every caller
// below — and the whole adapter contract — is untouched by the server's removal.
async function cleanFetch(method: string, path: string, body?: unknown): Promise<unknown> {
	try {
		return await hostRequest(method, path, body);
	} catch (err) {
		if (err instanceof HostError) throw new ApiError(err.message, err.status);
		throw new ApiError(err instanceof Error ? err.message : String(err), 500);
	}
}

// ---- contract cache -----------------------------------------------------------------------------

let contractPromise: Promise<Contract> | null = null;

function loadContract(): Promise<Contract> {
	if (!contractPromise) {
		contractPromise = buildContract().catch((err: unknown) => {
			contractPromise = null; // a failed boot fetch must not wedge the cache forever
			throw err;
		});
	}
	return contractPromise;
}

/** Drop the cached /presentation contract — schema writes call this so the next read is fresh. */
export function invalidateContract(): void {
	contractPromise = null;
}

async function buildContract(): Promise<Contract> {
	const [presentation, info] = await Promise.all([
		cleanFetch('GET', '/presentation') as Promise<PresentationPayload>,
		cleanFetch('GET', '/info') as Promise<CleanInfo>,
	]);

	// Server rows are used VERBATIM; only the constants the components expect are patched in:
	// `provenance: 'disk'` (lib/okf.ts isOkfRow's "real registered collection" marker) and
	// `layer: ''` (= local workspace) on collection rows; the Directus-ish `meta` shape on
	// relation rows (useFields only reads the top-level keys, but the shape is part of the type).
	//
	// There is no collection-level read-only answer any more: the display contract (descriptor v2)
	// carries none, because nothing refuses a whole collection — a runtime kind is written through
	// its compile gate, and each refusal arrives as the engine's own sentence after the gesture.
	const collections = collectionRows(presentation.collections);
	const fields = new Map(Object.entries(presentation.fields));

	// ⚠ `kind`/`mirror`/`list` are carried VERBATIM. One relation emits two rows — the owner's,
	// carrying `kind`, and the generated mirror's, carrying `mirror: true` — and dropping either
	// here is how a consumer ends up counting a mirrored pair twice (the ERD drew two edges).
	const relations: RelationRowShape[] = presentation.relations.map((r) => ({
		collection: r.collection,
		field: r.field,
		related_collection: r.related_collection,
		list: r.list,
		...(r.kind ? { kind: r.kind } : {}),
		...(r.mirror ? { mirror: true as const } : {}),
		meta: { many_collection: r.collection, many_field: r.field, one_collection: r.related_collection },
	}));

	const relationFields = new Map<string, Map<string, boolean>>();
	for (const r of presentation.relations) {
		let perCollection = relationFields.get(r.collection);
		if (!perCollection) {
			perCollection = new Map();
			relationFields.set(r.collection, perCollection);
		}
		perCollection.set(r.field, r.list);
	}

	return { info, collections, fields, relations, relationFields };
}

// ---- record value translation -------------------------------------------------------------------
// the engine stores references as `collection/id` (no leading slash). The ported components' canonical
// stored form is `/collection/id` (old engine: '/' + workspace path). Normalize on read, strip on
// write, so EditRelation's select/isSelected round-trips exactly.

function readRelationValue(value: unknown): unknown {
	if (typeof value === 'string' && value !== '' && !value.startsWith('/')) return `/${value}`;
	return value;
}

function writeRelationValue(value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('/')) return value.slice(1);
	return value;
}

function recordToItem(contract: Contract, collection: string, record: Record<string, unknown>): Record<string, unknown> {
	const relFields = contract.relationFields.get(collection);
	const out: Record<string, unknown> = { ...record };
	if (relFields) {
		for (const [field, isList] of relFields) {
			const value = out[field];
			if (value === undefined || value === null) continue;
			out[field] = isList && Array.isArray(value) ? value.map(readRelationValue) : readRelationValue(value);
		}
	}
	const id = String(out['id'] ?? '');
	// synthetic path: `collection/id` — EditRelation derives the stored value as '/'+$path, and
	// ViewRelation's pathStem uses it for fallback labels. Never shown as a form field (hidden).
	out['$path'] = `${collection}/${id}`;
	out['$bundle'] = '';
	return out;
}

function itemToRecord(contract: Contract, collection: string, body: Record<string, unknown>): Record<string, unknown> {
	const relFields = contract.relationFields.get(collection);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (key.startsWith('$')) continue; // synthetic — never persisted
		if (relFields?.has(key)) {
			const isList = relFields.get(key) === true;
			out[key] = isList && Array.isArray(value) ? value.map(writeRelationValue) : writeRelationValue(value);
		} else {
			out[key] = value;
		}
	}
	return out;
}

// ---- query-string parsing (the old client flattens `filter` into bracketed params) --------------

interface ParsedQuery {
	limit: number;
	page: number;
	sort: string | null;
	search: string | null;
	filter: Record<string, unknown> | null;
}

function parseQueryString(search: string): ParsedQuery {
	const params = new URLSearchParams(search);
	const out: ParsedQuery = { limit: 25, page: 1, sort: null, search: null, filter: null };
	const filterTree: Record<string, unknown> = {};
	let hasFilter = false;

	for (const [rawKey, value] of params.entries()) {
		if (rawKey === 'limit') out.limit = Number(value) || 25;
		else if (rawKey === 'page') out.page = Number(value) || 1;
		else if (rawKey === 'sort') out.sort = value;
		else if (rawKey === 'search') out.search = value;
		else if (rawKey.startsWith('filter[') || rawKey === 'filter') {
			hasFilter = true;
			setBracketPath(filterTree, rawKey.replace(/^filter/, ''), value);
		}
		// limit/page/sort/search/filter are the params the adapter honors; `fields`/`meta` are
		// accepted and ignored (no relation expansion — ViewRelation resolves labels itself).
	}

	if (hasFilter) out.filter = normalizeArrays(filterTree) as Record<string, unknown>;
	return out;
}

/** `[a][0][b]` → nested assignment into `tree` (numeric segments become array-ish objects). */
function setBracketPath(tree: Record<string, unknown>, bracketPath: string, value: string): void {
	const segments = [...bracketPath.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1] ?? '');
	let node: Record<string, unknown> = tree;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i] ?? '';
		if (i === segments.length - 1) {
			node[seg] = value;
		} else {
			if (node[seg] === undefined || typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
			node = node[seg] as Record<string, unknown>;
		}
	}
}

/** Objects whose keys are all numeric indexes become real arrays (post-pass of setBracketPath). */
function normalizeArrays(node: unknown): unknown {
	if (node === null || typeof node !== 'object') return node;
	const obj = node as Record<string, unknown>;
	const keys = Object.keys(obj);
	const isArray = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
	if (isArray) {
		return keys
			.map(Number)
			.sort((a, b) => a - b)
			.map((k) => normalizeArrays(obj[String(k)]));
	}
	const out: Record<string, unknown> = {};
	for (const key of keys) out[key] = normalizeArrays(obj[key]);
	return out;
}

// ---- filter translation --------------------------------------------------------------------------
// The FilterBuilder compiles rule trees to Directus-style operator objects ({field:{_op:v}},
// _and/_or groups); buildQuery (client.ts) flattens them into bracketed params, parseQueryString
// above reconstructs the tree, and the engine's records endpoint accepts it verbatim as
// `filter=<url-encoded JSON>` — a straight pass-through, no client-side evaluation.
// One repair pass: bracket-flattening stringifies every leaf, so bare no-value flags (`_null`,
// `_nnull`, `_empty`, `_nempty`) arrive as the string "true" — restore real booleans.

const FLAG_OPERATORS = new Set(['_null', '_nnull', '_empty', '_nempty']);

function repairFilterLeaves(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(repairFilterLeaves);
	if (node === null || typeof node !== 'object') return node;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (FLAG_OPERATORS.has(key) && (value === 'true' || value === 'false')) out[key] = value === 'true';
		else out[key] = repairFilterLeaves(value);
	}
	return out;
}

// ---- items ---------------------------------------------------------------------------------------

function encodeIdPath(id: string): string {
	return id.split('/').map(encodeURIComponent).join('/');
}

async function listItems(collection: string, queryString: string): Promise<AdapterResult> {
	const contract = await loadContract();
	const query = parseQueryString(queryString);
	const offset = (query.page - 1) * query.limit;

	const params: string[] = [`limit=${query.limit}`, `offset=${offset}`];
	if (query.sort) params.push(`sort=${encodeURIComponent(query.sort.split(',')[0] ?? '')}`);
	if (query.search) params.push(`q=${encodeURIComponent(query.search)}`);
	// ⚠ Relation values cross the boundary in the components' `/collection/id` form and must land as
	// the engine's `collection/id`. `itemToRecord` does this for record BODIES; a filter is not a
	// body, so a relation condition used to arrive slashed and match NOTHING — 17 rows became 0, and
	// the symptom read as "that contact attends no meetings", which is a plausible answer and so the
	// worst kind of wrong. Field-aware on purpose: a plain string field may legitimately hold a value
	// that starts with `/`, and blanket-stripping would corrupt a correct filter to fix a broken one.
	if (query.filter) {
		const wire = normalizeFilterRefs(
			repairFilterLeaves(query.filter),
			collection,
			(c, f) => contract.relations.find((r) => r.collection === c && r.field === f)?.related_collection ?? undefined,
		);
		params.push(`filter=${encodeURIComponent(JSON.stringify(wire))}`);
	}

	const res = (await cleanFetch('GET', `/collections/${encodeURIComponent(collection)}/records?${params.join('&')}`)) as {
		records: Array<Record<string, unknown>>;
		total: number;
		/** every source of the collection, counted over the filtered rows (host `listRecords`, 0.24.0) */
		sources?: unknown[];
	};
	return {
		data: res.records.map((r) => recordToItem(contract, collection, r)),
		raw: { meta: { filter_count: res.total, ...(res.sources ? { sources: res.sources } : {}) } },
	};
}

async function getItem(collection: string, id: string): Promise<AdapterResult> {
	const contract = await loadContract();
	const res = (await cleanFetch('GET', `/collections/${encodeURIComponent(collection)}/records/${encodeIdPath(id)}`)) as {
		id: string;
		fields: Record<string, unknown>;
		path?: string;
	};
	return { data: recordToItem(contract, collection, { id: res.id, ...res.fields }), raw: {} };
}

async function createItem(collection: string, body: Record<string, unknown>, queryString = ''): Promise<AdapterResult> {
	const contract = await loadContract();
	// `?target=<source>` rides through: the root the create form chose (cr-vscode-004)
	const target = new URLSearchParams(queryString).get('target');
	const qs = target ? `?target=${encodeURIComponent(target)}` : '';
	const res = (await cleanFetch('POST', `/collections/${encodeURIComponent(collection)}/records${qs}`, itemToRecord(contract, collection, body))) as { id: string };
	return getItem(collection, res.id); // old wire contract: create returns the full record
}

async function updateItem(collection: string, id: string, body: Record<string, unknown>): Promise<AdapterResult> {
	const contract = await loadContract();
	await cleanFetch('PATCH', `/collections/${encodeURIComponent(collection)}/records/${encodeIdPath(id)}`, itemToRecord(contract, collection, body));
	return getItem(collection, id); // old wire contract: update returns the full record
}

async function deleteItem(collection: string, id: string): Promise<AdapterResult> {
	await cleanFetch('DELETE', `/collections/${encodeURIComponent(collection)}/records/${encodeIdPath(id)}?force=true`);
	return { data: null, raw: {} };
}

// ---- revisions (git history) ---------------------------------------------------------------------

async function listRevisions(collection: string, id: string): Promise<AdapterResult> {
	const log = (await cleanFetch('GET', `/history/${encodeURIComponent(collection)}/${encodeIdPath(id)}`)) as Array<{
		hash: string;
		author: string;
		date: string;
		subject: string;
	}>;
	// ActivityRow shape (api/types.ts): id `<sha>.<n>`, `action` is what the row renders as its
	// label — the commit subject is the most useful thing we have, so it rides there.
	return {
		data: log.map((entry, index) => ({
			id: `${entry.hash}.${index}`,
			action: entry.subject || 'commit',
			user: entry.author,
			timestamp: entry.date,
			collection,
			item: id,
		})),
		raw: {},
	};
}

// ---- stub helpers ---------------------------------------------------------------------------------

function notYet(feature: string): never {
	throw new ApiError(`${feature} isn't exposed by the engine server yet`, 501);
}

const PRESETS_PREFIX = '.schema/';

// ---- the one entry point ---------------------------------------------------------------------------

export async function adapterRequest(method: string, path: string, body?: unknown): Promise<AdapterResult> {
	const qIndex = path.indexOf('?');
	const pathname = qIndex === -1 ? path : path.slice(0, qIndex);
	const queryString = qIndex === -1 ? '' : path.slice(qIndex + 1);
	const segments = pathname.replace(/^\/+/, '').split('/').map((s) => decodeURIComponent(s));
	const head = segments[0] ?? '';
	const rest = segments.slice(1);

	// ⚠ THE `/schema/*` PASSTHROUGH IS GONE. There is no such route any more: a system entity is
	// written through the generic records endpoints and a field through `/fields/*`, both of which are
	// handled in their own branches below — and both of which drop the cached `/presentation` contract
	// on a successful write, which is what keeps the designer honest without a page reload.

	// /info — the clean contract's own workspace summary. A READ, passed straight through: the
	// Schema tab's `modules` surface takes each module's LOCATION and PATH from the manifest here
	// rather than from a records read, because how a module arrived is a fact about the manifest and
	// asking the records for it would let the surface disagree with what actually compiled.
	if (head === 'info' && method === 'GET') {
		const result = await cleanFetch('GET', '/info');
		return { data: result, raw: {} };
	}

	// /commands/:collection?ids=… — bound commands + per-record state (clean passthrough;
	// same shape `dreamteamer commands for` prints with --json).
	// /folder/:collection/:id?field=… — the images a record's folder template points at (clean
	// passthrough; the host renders the template and lists the folder, the carousel layout draws it).
	if (head === 'folder' && method === 'GET') {
		const result = await cleanFetch('GET', pathname + (queryString ? `?${queryString}` : ''));
		return { data: result, raw: {} };
	}

	// /sources — the stack of roots the workspace reads (own data, each layer, each module-owned
	// collection), for the Schema tab's Sources section. A READ, passed straight through.
	if (head === 'sources' && method === 'GET') {
		const result = await cleanFetch('GET', pathname);
		return { data: result, raw: {} };
	}

	// /activity — the Schema tab's Activity page (host `src/activity.ts`). A READ, passed straight through.
	if (head === 'activity' && method === 'GET') {
		const result = await cleanFetch('GET', pathname + (queryString ? `?${queryString}` : ''));
		return { data: result, raw: {} };
	}

	if (head === 'commands' && method === 'GET') {
		const result = await cleanFetch('GET', pathname + (queryString ? `?${queryString}` : ''));
		return { data: result, raw: {} };
	}

	// /commit — publish the record writes already on disk (clean passthrough; same op as
	// `dreamteamer commit [<collection>…]`). `{ dryRun: true }` samples without committing, which
	// is how the header gesture learns its pending count.
	if (head === 'commit' && method === 'POST') {
		const result = await cleanFetch('POST', pathname, body);
		return { data: result, raw: {} };
	}

	// /history-diff/:collection/:id?hash=<h> — unified diff of that commit vs its parent.
	if (head === 'history-diff' && method === 'GET') {
		const collection = rest[0] ?? '';
		const id = rest.slice(1).join('/');
		const result = await cleanFetch(
			'GET',
			`/history-diff/${encodeURIComponent(collection)}/${encodeIdPath(id)}${queryString ? `?${queryString}` : ''}`,
		);
		return { data: result, raw: {} };
	}

	// /records-revert/:collection/:id {hash} — restore the record's content AT that commit
	// (server does `git show hash:path`, validates, writes one new commit).
	if (head === 'records-revert' && method === 'POST') {
		const collection = rest[0] ?? '';
		const id = rest.slice(1).join('/');
		const result = await cleanFetch('POST', `/collections/${encodeURIComponent(collection)}/records-revert/${encodeIdPath(id)}`, body);
		return { data: result, raw: {} };
	}

	// /server/info — App.vue (project name) + modules.ts (module app bundles; none yet).
	if (head === 'server' && rest[0] === 'info') {
		const contract = await loadContract();
		return { data: { project: { project_name: contract.info.name }, modules: [] }, raw: {} };
	}

	// /users/me — no auth; a static local operator keeps the shell happy.
	if (head === 'users' && rest[0] === 'me') {
		return { data: { id: 'local', email: null, first_name: null, last_name: null }, raw: {} };
	}

	// /collections — the overview READ, plus every clean-contract passthrough that hangs off it.
	//
	// ⚠ A WRITE HERE IS A SCHEMA WRITE NOW. `POST /collections/collections/records` creates a
	// collection and `POST /collections/ui-views/records` saves a view — the same endpoints a data
	// record uses, which is the whole of "system entities are collections" at the transport. Anything
	// that is not a GET therefore passes through and invalidates the cached contract; the host decides
	// whether it lands in the record store or in a source behind a compile gate, keyed off the
	// collection's own `storage.base`. This branch used to answer `notYet()` for every write.
	if (head === 'collections') {
		if (method === 'GET' && rest.length === 0) {
			const contract = await loadContract();
			return { data: contract.collections, raw: { unregistered: [] } };
		}
		// /collections/:name/position/:id — clean passthrough (manual ordering). Before the generic
		// write below, because it moves a RECORD rather than the schema: the key is computed by the
		// engine, there is nothing for the adapter to translate, and nothing about the compiled schema
		// has changed, so the cached contract must survive it.
		if (method === 'PATCH' && rest[1] === 'position') {
			const result = await cleanFetch('PATCH', pathname, body);
			return { data: result, raw: {} };
		}
		if (method !== 'GET') {
			const result = await cleanFetch(method, pathname + (queryString ? `?${queryString}` : ''), body);
			invalidateContract();
			return { data: result, raw: {} };
		}
		// /collections/:name/values/:field — clean passthrough (filter-value choices).
		if (method === 'GET' && rest[1] === 'values') {
			const result = await cleanFetch('GET', pathname + (queryString ? `?${queryString}` : ''));
			return { data: result, raw: {} };
		}
		notYet('This collection operation');
	}

	// /fields/:collection[/:field] — ⚠ THE ONE ROUTE WHOSE READ AND WRITE LIVE ON OPPOSITE SIDES OF
	// THIS BOUNDARY, and it is deliberate.
	//
	//  - a GET is answered HERE, out of the single cached `/presentation` payload: one payload holds
	//    every collection's rows, so the second and every later collection's fields cost nothing. The
	//    host has no such route, which is why a tier-3 test that asks it for `GET /fields/:c` gets a
	//    404 that reads like a routing bug (see CLAUDE.md).
	//  - a WRITE goes to the host, which owns `/fields/*` since the grammar flip. A field is not a
	//    record, so it cannot ride the generic records endpoints; it is the one sub-entity, with verbs
	//    of its own that take the collection as their target. This branch used to `notYet()` them.
	if (head === 'fields') {
		if (method !== 'GET') {
			const result = await cleanFetch(method, pathname + (queryString ? `?${queryString}` : ''), body);
			invalidateContract();
			return { data: result, raw: {} };
		}
		const collection = rest.join('/');
		const contract = await loadContract();
		const rows = contract.fields.get(collection);
		if (!rows) throw new ApiError(`unknown collection '${collection}'`, 404);
		return { data: rows, raw: {} };
	}

	// /relations — one flat list, filtered client-side by useFields.
	if (head === 'relations' && method === 'GET') {
		const contract = await loadContract();
		return { data: contract.relations, raw: {} };
	}

	// /items/… — presets stub first, then real collections.
	if (head === 'items') {
		const itemPath = rest.join('/');

		// legacy saved views / presets: STUB — saved views are ui-view records now.
		if (itemPath.startsWith(PRESETS_PREFIX)) {
			if (method === 'GET') return { data: [], raw: {} };
			return { data: {}, raw: {} };
		}

		const collection = rest[0] ?? '';
		const id = rest.slice(1).join('/');

		if (id === '') {
			if (method === 'GET') return listItems(collection, queryString);
			if (method === 'POST') return createItem(collection, (body ?? {}) as Record<string, unknown>, queryString);
		} else {
			if (method === 'GET') return getItem(collection, id);
			if (method === 'PATCH') return updateItem(collection, id, (body ?? {}) as Record<string, unknown>);
			if (method === 'DELETE') return deleteItem(collection, id);
		}
	}

	// /revisions/:collection/:id — per-record git log (diffs live at /history-diff now).
	if (head === 'revisions') {
		const collection = rest[0] ?? '';
		return listRevisions(collection, rest.slice(1).join('/'));
	}

	// /utils/* — folder inference is the one server feature the engine still doesn't have.
	if (head === 'utils') {
		if (rest[0] === 'infer') notYet('Folder registration');
		notYet('This action');
	}

	throw new ApiError(`adapter: unhandled request ${method} ${path}`, 404);
}
