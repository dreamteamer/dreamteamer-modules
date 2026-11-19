/**
 * Filter-builder pure logic (C2 spec item 1): the field-pill/operator-pill/value-widget rule
 * shape, the field-kind → operator-list mapping the value widget switches on, compiling a
 * `FilterGroup` into the server `filter` query object, and (de)serializing a group to/from the
 * URL `?filter=<json>` param so filtered browse views are shareable links.
 *
 * Kept framework-free (no Vue imports) so it's cheaply unit-testable per the plan's "LIGHT
 * tests, pure logic only" directive — FilterBuilder.vue is the untested UI shell around this.
 */
import type { FieldRow } from '../api/types';
import { choicesOf, isRelationField } from './field-row';

export type FilterLogic = '_and' | '_or';

/** One filter rule row: field pill + operator pill + value widget. */
export interface FilterRule {
	/** Stable key for v-for/removal — never round-tripped through the URL as meaningful data. */
	id: string;
	field: string;
	operator: string;
	value: unknown;
}

export interface FilterGroup {
	logic: FilterLogic;
	rules: FilterRule[];
}

export function emptyFilterGroup(): FilterGroup {
	return { logic: '_and', rules: [] };
}

let ruleCounter = 0;

/** Fresh, collision-free rule id. A plain counter (not crypto.randomUUID) — deterministic in tests, no runtime dependency. */
export function newRuleId(): string {
	ruleCounter += 1;
	return `rule-${ruleCounter}`;
}

export function newRule(overrides: Partial<Omit<FilterRule, 'id'>> = {}): FilterRule {
	return { id: newRuleId(), field: '', operator: '_eq', value: '', ...overrides };
}

/** The value-widget kind a field resolves to, driving both the operator list and the input control. */
export type FieldKind = 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'relation';

function hasChoices(field: FieldRow): boolean {
	return (choicesOf(field) ?? []).length > 0;
}

export function kindOfField(field: FieldRow): FieldKind {
	// Relation first: a `<collection>/<id>` ref field is wire-type `string` and never carries
	// choices, so nothing else can claim it — and it's the one kind whose value widget must be a
	// record picker rather than a text box (Directus resolves an `alias` field to its FK the same
	// way, input-group.vue's `fieldInfo`).
	if (isRelationField(field)) return 'relation';
	if (hasChoices(field)) return 'enum';
	if (field.type === 'boolean') return 'boolean';
	if (field.type === 'number' || field.type === 'integer') return 'number';
	if (field.type === 'date' || field.type === 'datetime') return 'datetime';
	return 'string';
}

/** Operators the server's query engine supports (engine `src/filter.js`'s `KNOWN_OPERATORS`), grouped by which value kinds each makes sense for. */
export const ALL_OPERATORS = [
	'_eq',
	'_neq',
	'_contains',
	'_icontains',
	'_starts_with',
	'_ends_with',
	'_gt',
	'_gte',
	'_lt',
	'_lte',
	'_between',
	'_nbetween',
	'_in',
	'_nin',
	'_null',
	'_nnull',
	'_empty',
	'_nempty',
] as const;

const OPERATORS_BY_KIND: Record<FieldKind, readonly string[]> = {
	string: ['_eq', '_neq', '_contains', '_icontains', '_starts_with', '_ends_with', '_in', '_nin', '_null', '_nnull', '_empty', '_nempty'],
	number: ['_eq', '_neq', '_gt', '_gte', '_lt', '_lte', '_between', '_nbetween', '_in', '_nin', '_null', '_nnull'],
	boolean: ['_eq', '_neq', '_null', '_nnull'],
	datetime: ['_eq', '_neq', '_gt', '_gte', '_lt', '_lte', '_between', '_nbetween', '_null', '_nnull'],
	enum: ['_eq', '_neq', '_in', '_nin', '_null', '_nnull'],
	// A ref field's value is an opaque `<collection>/<id>` path — ordering it is meaningless, but
	// the engine's `_eq`/`_in` do array-containment on list-valued ref fields (filter.js `compare`),
	// so "is any of" works for both single and list relations.
	relation: ['_eq', '_neq', '_in', '_nin', '_contains', '_null', '_nnull', '_empty', '_nempty'],
};

export function operatorsForField(field: FieldRow): readonly string[] {
	return OPERATORS_BY_KIND[kindOfField(field)];
}

/**
 * Human labels for the operator dropdown AND the active-filter chips. It lives here rather than in
 * FilterBuilder because BrowseView's chips need the same words: they used to keep a hand-copy,
 * which promptly drifted (a `_between` rule read "Date _be…" on the chip while the dropdown said
 * "is between").
 */
const OPERATOR_LABELS: Record<string, string> = {
	_eq: 'is',
	_neq: 'is not',
	_contains: 'contains',
	_icontains: 'contains (any case)',
	_starts_with: 'starts with',
	_ends_with: 'ends with',
	_gt: 'after',
	_gte: 'on/after',
	_lt: 'before',
	_lte: 'on/before',
	_between: 'is between',
	_nbetween: 'is not between',
	_in: 'is any of',
	_nin: 'is none of',
	_null: 'is empty',
	_nnull: 'is not empty',
	_empty: 'is blank',
	_nempty: 'is not blank',
};

export function operatorLabel(operator: string): string {
	return OPERATOR_LABELS[operator] ?? operator;
}

/** Operators that take no value widget at all — the server treats the clause as a boolean flag. */
const NO_VALUE_OPERATORS = new Set(['_null', '_nnull', '_empty', '_nempty']);
/** Operators whose value is an open-ended list of values (rendered as one widget per entry). */
const LIST_OPERATORS = new Set(['_in', '_nin']);
/** Operators whose value is exactly two bounds (rendered as `<widget> and <widget>`). */
const PAIR_OPERATORS = new Set(['_between', '_nbetween']);

export function operatorTakesValue(operator: string): boolean {
	return !NO_VALUE_OPERATORS.has(operator);
}

export function operatorTakesList(operator: string): boolean {
	return LIST_OPERATORS.has(operator);
}

export function operatorTakesPair(operator: string): boolean {
	return PAIR_OPERATORS.has(operator);
}

/** The blank value a freshly-picked operator starts from — arrays for the multi-value operators. */
export function emptyValueFor(operator: string): unknown {
	return LIST_OPERATORS.has(operator) || PAIR_OPERATORS.has(operator) ? [] : '';
}

function isBlank(value: unknown): boolean {
	return value === '' || value === null || value === undefined;
}

/**
 * A multi-value operator's entries, tolerating both the array shape the widgets now emit and the
 * legacy comma-separated string persisted in older `?filter=` links / saved views. Values keep
 * their runtime type (numbers stay numbers) — the engine's `looseEq` would cope either way, but
 * round-tripping a number field's filter through the URL shouldn't silently stringify it.
 */
export function valueList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.filter((v) => !isBlank(v));
	if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
	return isBlank(value) ? [] : [value];
}

/**
 * A rule's `field` is a PATH — `flag`, or `person.name` for a condition on a referenced record.
 *
 * ⚠ The engine wants NESTING, not a dotted key: `{person:{name:{_eq:x}}}`. `filter.js`'s
 * `matchesField` treats any non-operator key as a hop to the referenced record and recurses, so
 * `{"person.name":{…}}` would be read as a field literally called `person.name` and match nothing.
 * Depth is unbounded there and arrays already mean "any target matches" (`_some` semantics).
 */
export function splitFieldPath(field: string): string[] {
	return field.split('.').filter((seg) => seg.length > 0);
}

/** `['person','name']` + a leaf condition → `{person:{name:<cond>}}`. */
function nest(path: string[], leaf: Record<string, unknown>): Record<string, unknown> {
	return path.reduceRight<Record<string, unknown>>((inner, seg) => ({ [seg]: inner }), leaf);
}

/** One rule → its nested clause, or `null` when it's incomplete (dropped, never sent half-formed). */
function ruleClause(rule: FilterRule): Record<string, unknown> | null {
	const path = splitFieldPath(rule.field);
	if (path.length === 0 || !rule.operator) return null;

	if (NO_VALUE_OPERATORS.has(rule.operator)) {
		return nest(path, { [rule.operator]: true });
	}

	if (LIST_OPERATORS.has(rule.operator)) {
		const list = valueList(rule.value);
		if (list.length === 0) return null;
		return nest(path, { [rule.operator]: list });
	}

	if (PAIR_OPERATORS.has(rule.operator)) {
		// Both bounds required — a half-entered range is dropped, same posture as any other
		// incomplete rule (never send a clause the user hasn't finished stating).
		const pair = Array.isArray(rule.value) ? rule.value : [];
		if (pair.length !== 2 || isBlank(pair[0]) || isBlank(pair[1])) return null;
		return nest(path, { [rule.operator]: pair });
	}

	if (isBlank(rule.value) || (Array.isArray(rule.value) && rule.value.length === 0)) return null;
	return nest(path, { [rule.operator]: rule.value });
}

/**
 * Compile a `FilterGroup` into the shape `useItems`/`buildQuery` expect for the `filter` query
 * param. Empty/incomplete rules are silently dropped (never sent as a broken clause). A single
 * complete rule compiles to a bare `{ field: { op: value } }` (no group wrapper needed); two or
 * more wrap in `{ [logic]: [...clauses] }`. Returns `undefined` when nothing compiles, so the
 * caller can omit `filter` from the query entirely rather than sending `filter=`.
 */
export function compileFilter(group: FilterGroup): Record<string, unknown> | undefined {
	const clauses = group.rules.map(ruleClause).filter((c): c is Record<string, unknown> => c !== null);
	if (clauses.length === 0) return undefined;
	if (clauses.length === 1) return clauses[0];
	return { [group.logic]: clauses };
}

/** Serialize a group for the URL `?filter=` param; `null` when there's nothing worth persisting. */
export function serializeFilterGroup(group: FilterGroup): string | null {
	if (group.rules.length === 0) return null;
	return JSON.stringify(group);
}

function isValidRule(value: unknown): value is FilterRule {
	if (value === null || typeof value !== 'object') return false;
	const r = value as Record<string, unknown>;
	return typeof r['field'] === 'string' && typeof r['operator'] === 'string';
}

/**
 * Parse a `?filter=` URL param back into a `FilterGroup`. Never throws — malformed/absent input
 * (a hand-edited URL, an old link format) degrades to an empty group rather than crashing the
 * browse view, matching the rest of the studio's "never an error" posture.
 */
export function parseFilterGroup(raw: string | null | undefined): FilterGroup {
	if (!raw) return emptyFilterGroup();

	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object') return emptyFilterGroup();

		const obj = parsed as { logic?: unknown; rules?: unknown };
		const logic: FilterLogic = obj.logic === '_or' ? '_or' : '_and';
		// Ids are ALWAYS re-minted, never taken from the URL. `newRuleId`'s counter restarts at 0 on
		// every page load, so a restored `rule-1` collided with the id the next `Add rule` handed
		// out — and since `updateRule` patches by id, editing either one silently edited both
		// (seen 2026-07-28: picking a field on rule 1 changed rule 2 too). The id is a v-for key,
		// explicitly not data, so minting fresh ones costs nothing.
		const rules = Array.isArray(obj.rules)
			? obj.rules.filter(isValidRule).map((r) => ({ id: newRuleId(), field: r.field, operator: r.operator, value: r.value }))
			: [];

		return { logic, rules };
	} catch {
		return emptyFilterGroup();
	}
}

/**
 * THE INVERSE OF `compileFilter` — the engine's `{field:{op:value}}` / `{_and:[…]}` shape back into
 * builder rules.
 *
 * ⚠ It never existed, and its absence is why opening the filter panel on a SAVED VIEW showed "No
 * filters yet" over a table that was visibly filtered. `parseFilterGroup` only ever read the
 * builder's own `{logic, rules}` shape out of the URL; a `ui-view` record stores the engine shape,
 * so nothing could turn one into the other and the panel had nothing to show.
 *
 * Returns `null` — deliberately, rather than a lossy approximation — when the filter says something
 * the flat builder cannot: nested groups, or a mix of `_and` and `_or`. A caller that gets `null`
 * should show the filter read-only rather than pretend it is editable, because round-tripping a
 * filter we only half-understood would SILENTLY REWRITE the operator's saved view. Losing an
 * expression we cannot represent is a much worse failure than declining to edit it.
 */
export function decompileFilter(filter: unknown): FilterGroup | null {
	if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return null;
	const obj = filter as Record<string, unknown>;
	const keys = Object.keys(obj);
	if (keys.length === 0) return emptyFilterGroup();

	// `{_and:[…]}` / `{_or:[…]}` — the shape `compileFilter` emits for two or more clauses.
	if (keys.length === 1 && (keys[0] === '_and' || keys[0] === '_or')) {
		const logic = keys[0] as FilterLogic;
		const clauses = obj[logic];
		if (!Array.isArray(clauses)) return null;
		const rules: FilterRule[] = [];
		for (const clause of clauses) {
			const got = clauseRules(clause);
			if (!got) return null; // a nested group — not representable, say so
			rules.push(...got);
		}
		return { logic, rules };
	}

	// A bare object: every top-level key is a field, `_and`-combined (what the engine does).
	const rules: FilterRule[] = [];
	for (const key of keys) {
		if (key === '_and' || key === '_or') return null; // mixed shape — not representable
		const got = clauseRules({ [key]: obj[key] });
		if (!got) return null;
		rules.push(...got);
	}
	return { logic: '_and', rules };
}

/**
 * One `{field: cond}` clause → its rules, or `null` if it is not a clause at all.
 *
 * A cond may hold SEVERAL operators (`{_gte:a,_lte:b}` — the engine ands them), which becomes one
 * rule each; and any non-operator key is a HOP, appended to the path and recursed into, which is
 * what makes `person.name` round-trip.
 */
function clauseRules(clause: unknown, path: string[] = []): FilterRule[] | null {
	if (clause === null || typeof clause !== 'object' || Array.isArray(clause)) return null;
	const obj = clause as Record<string, unknown>;
	const out: FilterRule[] = [];

	for (const [key, cond] of Object.entries(obj)) {
		if (key === '_and' || key === '_or') return null;

		if (key.startsWith('_')) {
			// An operator at this level: the path so far IS the field.
			if (path.length === 0) return null;
			out.push({
				id: newRuleId(),
				field: path.join('.'),
				operator: key,
				// A no-value operator stores `true` on the wire; the builder holds no value for it.
				value: NO_VALUE_OPERATORS.has(key) ? '' : (cond as unknown),
			});
			continue;
		}

		// Not an operator → a field name or a ref hop. A scalar here is the engine's `_eq` shorthand
		// (`matchesField` compares directly when the cond is not an object).
		if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
			out.push({ id: newRuleId(), field: [...path, key].join('.'), operator: '_eq', value: cond as unknown });
			continue;
		}
		const deeper = clauseRules(cond, [...path, key]);
		if (!deeper) return null;
		out.push(...deeper);
	}

	return out.length ? out : null;
}

/**
 * A filter in words: `Flag is any of high, low, abnormal, positive`.
 *
 * Plain function, no model involved — it feeds the filter button's tooltip and the active chips, so
 * it has to be instant and identical every time. `label` resolves a field PATH to what the operator
 * calls it (`person.name` → `Person › Name`); it falls back to the raw path so an unknown field
 * degrades to something readable rather than to `undefined`.
 */
/**
 * One filter value, as a human reads it.
 *
 * ⚠ Strips the components' wire slash: a relation value travels as `/contacts/ada` (see
 * `filter-wire.ts`) and a chip reading "Attendees is /contacts/ada" shows plumbing. What it does
 * NOT do is resolve the reference to that record's title — that needs a fetch per reference, and a
 * label that is sometimes a title and sometimes a raw ref, depending on what happens to be cached,
 * is worse than one that is always the reference.
 */
export function displayValue(value: unknown): string {
	if (typeof value === 'string' && /^\/[^/]+\//.test(value)) return value.slice(1);
	return String(value);
}

export function filterToProse(group: FilterGroup, label: (path: string) => string): string {
	const parts = group.rules
		.filter((r) => r.field && r.operator)
		.map((r) => {
			const head = `${label(r.field)} ${operatorLabel(r.operator)}`;
			if (!operatorTakesValue(r.operator)) return head;
			if (operatorTakesList(r.operator)) {
				const list = valueList(r.value);
				return list.length ? `${head} ${list.map(displayValue).join(', ')}` : head;
			}
			if (operatorTakesPair(r.operator)) {
				const pair = Array.isArray(r.value) ? r.value : [];
				return pair.length === 2 ? `${head} ${displayValue(pair[0])} and ${displayValue(pair[1])}` : head;
			}
			return isBlank(r.value) ? head : `${head} ${displayValue(r.value)}`;
		});
	// "and"/"or" spelled out — the chips already carry the same words, and `_and` on a tooltip reads
	// like a bug rather than like a conjunction.
	return parts.join(group.logic === '_or' ? ' or ' : ' and ');
}
