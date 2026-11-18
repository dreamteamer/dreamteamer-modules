/**
 * Translating a filter from the components' wire form into the engine's.
 *
 * The adapter has always carried one translation: the engine stores a reference as `collection/id`,
 * while the ported components' canonical form is `/collection/id` — `readRelationValue` adds the
 * slash on the way out, `writeRelationValue` strips it on the way in. That second half ran for
 * record BODIES only (`itemToRecord`), and a filter is not a body.
 *
 * ⚠ So a relation condition built in the UI sent `/contacts/ada` to a store holding
 * `contacts/ada`, and matched NOTHING — measured: 17 rows for the reference, 0 for the slashed
 * form. It looked like "that contact attends no meetings", which is a perfectly plausible answer and
 * therefore the worst kind of wrong.
 *
 * ⚠ Stripping every leading slash blindly is NOT the fix. A plain string field may legitimately hold
 * a value that starts with `/` — a path, a route, a regex fragment — and rewriting it would corrupt a
 * correct filter to fix an incorrect one. So this walks the tree with the schema in hand and rewrites
 * ONLY values compared against a relation-valued field.
 */

/** collection → (field → target collection), for the fields that hold references. */
export type RelationTargets = (collection: string, field: string) => string | undefined;

const isOperator = (key: string) => key.startsWith('_');

/** `/contacts/ada` → `contacts/ada`. Anything that is not a slashed string is left alone. */
function unslash(value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('/')) return value.slice(1);
	if (Array.isArray(value)) return value.map(unslash);
	return value;
}

/**
 * A filter, with relation values normalized to the engine's reference form.
 *
 * `collection` is what the filter is being evaluated against; a non-operator key on a relation field
 * is a HOP, so the walk continues in the target collection — which is what keeps `person.gp` (a
 * relation two levels down) correct rather than only the top level.
 */
export function normalizeFilterRefs(filter: unknown, collection: string, targetOf: RelationTargets): unknown {
	if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return filter;
	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
		if (key === '_and' || key === '_or') {
			out[key] = Array.isArray(value) ? value.map((clause) => normalizeFilterRefs(clause, collection, targetOf)) : value;
			continue;
		}
		if (isOperator(key)) {
			// Reached only via `fieldCondition` below, which already decided this field is a relation.
			out[key] = unslash(value);
			continue;
		}

		const target = targetOf(collection, key);
		if (!target) {
			// Not a relation: leave the condition entirely alone, slashes and all.
			out[key] = value;
			continue;
		}
		out[key] = fieldCondition(value, target, targetOf);
	}
	return out;
}

/** The condition on a RELATION field: operator operands get unslashed, hops recurse into the target. */
function fieldCondition(cond: unknown, target: string, targetOf: RelationTargets): unknown {
	// `{ attendees: "/contacts/ada" }` — the engine's scalar shorthand for `_eq`.
	if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return unslash(cond);

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(cond as Record<string, unknown>)) {
		if (isOperator(key)) out[key] = unslash(value);
		// A non-operator key under a relation field is a hop into the target record.
		else out[key] = (normalizeFilterRefs({ [key]: value }, target, targetOf) as Record<string, unknown>)[key];
	}
	return out;
}
