// The shared gate (cr-modules-007 design §4c; cr-modules-008 §4). Pure: no I/O, no clock, no headers.
// It decides WHAT a scope may call — the host adapter decides WHO and HOW MUCH around it.
import { matchRoute } from './routes.js';

/** The engine's filter operators (0.44 `KNOWN_OPERATORS`) minus the `_regex` family and the `_and`/`_or` structure keys. */
export const OPERATORS = new Set(['_eq', '_neq', '_ieq', '_nieq', '_lt', '_lte', '_gt', '_gte', '_in', '_nin', '_null', '_nnull',
	'_empty', '_nempty', '_contains', '_ncontains', '_icontains', '_starts_with', '_istarts_with', '_ends_with', '_iends_with',
	'_between', '_nbetween']);
export const READ_QUERY_KEYS = new Set(['limit', 'offset', 'sort', 'q', 'filter', 'with-body']);
export const BOUNDS = { operand: 200, list: 200, conditions: 50, q: 200, limit: 2000 };
export const SYSTEM_COLLECTIONS = new Set(['collections', 'modules', 'skills', 'agents', 'commands', 'command-bindings', 'ui-views', 'mixins']);
const WRITE_OPS = { 'records-create': 'create', 'record-update': 'update', 'record-remove': 'delete', position: 'position' };
const NEVER_WRITTEN = new Set(['id', 'created', 'stub']);
/** Keys a module scope may not filter, sort or search by on a collection that is not its own (008 D14). */
export const COMMIT_KEYS = new Set(['$last-commit-message', '$created-by', '$last-modified-by', '$repo', '$dirty', '$ahead']);

const refuse = (status, error) => ({ ok: false, status, error });
const entries = (q) => (q instanceof URLSearchParams ? [...q.entries()] : Object.entries(q ?? {}));
const descriptorOf = (descriptors, name) => (descriptors instanceof Map ? descriptors.get(name) : (descriptors ?? []).find((d) => d.name === name));

/** Walks a filter; returns a reason string, or null when it is inside the grammar. */
function filterProblem(node, fields, budget, hidden = new Set()) {
	if (node === null || typeof node !== 'object' || Array.isArray(node)) return 'a filter is an object';
	for (const [key, value] of Object.entries(node)) {
		if (key === '_and' || key === '_or') {
			if (!Array.isArray(value)) return `${key} takes a list`;
			for (const child of value) { const p = filterProblem(child, fields, budget, hidden); if (p) return p; }
			continue;
		}
		if (key.includes('.') || (!key.startsWith('$') && !fields.has(key)) || hidden.has(key)) return `no field ${key}`;
		if (++budget.n > BOUNDS.conditions) return `more than ${BOUNDS.conditions} conditions`;
		if (value === null || typeof value !== 'object') { const p = operandProblem(value); if (p) return p; continue; }
		if (Array.isArray(value)) return `${key} takes a value or operators`;
		for (const [op, operand] of Object.entries(value)) {
			if (!op.startsWith('_')) return 'no relational conditions — query the other collection and join in the page';
			if (!OPERATORS.has(op)) return `operator ${op} is not allowed`;
			if (Array.isArray(operand)) {
				if (operand.length > BOUNDS.list) return `more than ${BOUNDS.list} items`;
				for (const x of operand) { const p = operandProblem(x); if (p) return p; }
			} else { const p = operandProblem(operand); if (p) return p; }
		}
	}
	return null;
}
function operandProblem(v) {
	if (v !== null && typeof v === 'object') return 'no relational conditions — query the other collection and join in the page';
	if (typeof v === 'string' && v.length > BOUNDS.operand) return `an operand longer than ${BOUNDS.operand} characters`;
	return null;
}

/**
 * @returns {{ok: true, call: {method, path, query, body, routeId, collection?}, needsSource?: 'home', commit?: {only: string[]|null, message: string}} | {ok: false, status: number, error: string}}
 */
export function gate(scope, descriptors, method, path, query, body) {
	const m = String(method).toUpperCase();
	const hit = matchRoute(m, path);
	if (!hit) return refuse(404, `no route ${m} ${String(path).split('?')[0]}`);
	const { route, params } = hit;
	const s = scope.sentences;
	if (!scope.routes.has(route.id)) return refuse(403, s.route(scope, { method: m, pattern: route.pattern }));
	const collection = params.collection;
	const pathname = String(path).split('?')[0];
	const pairs = entries(query);

	if (m === 'GET') {
		if (collection !== undefined && !scope.reads.has(collection)) return refuse(403, s.collectionRead(scope, { collection }));
		const d = collection !== undefined ? descriptorOf(descriptors, collection) : undefined;
		const fields = new Set(Object.keys(d?.fields ?? {}));
		const foreign = scope.kind === 'module' && collection !== undefined && !scope.own?.has(collection);
		const hidden = foreign ? COMMIT_KEYS : new Set();
		for (const [key, value] of pairs) {
			if (READ_QUERY_KEYS.has(key)) {
				if (key === 'q' && foreign) return refuse(400, s.filter(scope, { reason: 'a module app searches only its own collections' }));
				if (key === 'q' && value.length > BOUNDS.q) return refuse(400, s.filter(scope, { reason: `q longer than ${BOUNDS.q}` }));
				if ((key === 'limit' || key === 'offset') && !/^\d+$/.test(value)) return refuse(400, s.filter(scope, { reason: `${key} is a number` }));
				if (key === 'limit' && Number(value) > BOUNDS.limit) return refuse(400, s.filter(scope, { reason: `limit above ${BOUNDS.limit}` }));
				if (key === 'sort') { const f = value.replace(/^-/, ''); if ((!f.startsWith('$') && !fields.has(f)) || hidden.has(f)) return refuse(400, s.filter(scope, { reason: `no field ${f} to sort by` })); }
				if (key === 'filter') {
					let parsed; try { parsed = JSON.parse(value); } catch { return refuse(400, s.filter(scope, { reason: 'the filter is not JSON' })); }
					const p = filterProblem(parsed, fields, { n: 0 }, hidden); if (p) return refuse(400, s.filter(scope, { reason: p }));
				}
				continue;
			}
			if (collection !== undefined && fields.has(key) && value.length <= BOUNDS.operand) continue; // field=value equality
			return refuse(400, s.filter(scope, { reason: `unknown query key ${key}` }));
		}
		return { ok: true, call: { method: m, path: pathname, query: Object.fromEntries(pairs), body: undefined, routeId: route.id, collection } };
	}

	const op = WRITE_OPS[route.id];
	const grant = collection !== undefined ? scope.writes.get(collection) : undefined;
	if (!op || !grant || !grant.ops.has(op) || SYSTEM_COLLECTIONS.has(collection)) return refuse(403, s.collectionWrite(scope, { collection, op }));
	for (const [key] of pairs) return refuse(403, s.query(scope, { key }));
	const d = descriptorOf(descriptors, collection);
	if (!d || d.runtime === true) return refuse(403, s.collectionWrite(scope, { collection, op }));
	const fields = d.fields ?? {};
	const mirrored = (f) => fields[f]?.mirror_of !== undefined;
	if (op === 'create' || op === 'update') {
		for (const key of Object.keys(body ?? {})) {
			const allowed = !key.startsWith('$') && !NEVER_WRITTEN.has(key) && key in fields
				&& (grant.fields === 'own-fields' || grant.fields.has(key))
				&& !(mirrored(key) && grant.mirroredRefs !== 'allow');
			if (!allowed) return refuse(403, s.field(scope, { collection, field: key }));
		}
	}
	if (op === 'delete' && grant.mirroredRefs !== 'allow' && Object.keys(fields).some(mirrored)) {
		return refuse(403, s.collectionWrite(scope, { collection, op, reason: 'it owns a mirrored relation' }));
	}
	if (grant.commit && grant.mirroredRefs === 'allow') return refuse(400, s.collectionWrite(scope, { collection, op, reason: 'a commit by id cannot carry a moved mirror' }));
	const decision = { ok: true, call: { method: m, path: pathname, query: op === 'create' && scope.home ? { target: scope.home } : {}, body, routeId: route.id, collection } };
	if (scope.kind === 'module' && op !== 'create') decision.needsSource = 'home';
	if (grant.commit) decision.commit = { only: op === 'create' ? null : [`${collection}/${params.id}`], message: `${scope.label}: ${op} ${collection}/${op === 'create' ? '<new>' : params.id}` };
	return decision;
}
