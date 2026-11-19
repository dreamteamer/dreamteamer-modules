/**
 * The filter field picker's TREE — which fields you can filter on, including fields of records this
 * one references.
 *
 * The engine has always been able to answer "lab results whose author's name is X": `filter.js`'s
 * `matchesField` treats any non-operator key as a hop to the referenced record and recurses, so depth
 * is unbounded and a list-valued ref already means "any target matches". The UI just never offered it
 * — the field picker was a flat `<select>` of the root collection's own fields. Filtering a related
 * record BY ITS NAME was never a feature of its own; it is the one-hop case of this.
 *
 * Framework-free on purpose (no Vue), like `filter-query.ts`: the parts worth arguing about — the
 * depth cap, the cycle guard, what search matches — are then testable by running them.
 */
import type { FieldRow } from '../api/types';

/** One row in the picker. `path` is what a rule's `field` holds: `flag`, `person.name`. */
export interface FieldNode {
	/** Dotted path from the root collection. */
	path: string;
	/** This segment's own label — `Name`, not `Person › Name`. */
	label: string;
	/** Every segment's label, root first — what a breadcrumb or a search hit shows. */
	labels: string[];
	/** The field row this node stands for, for kind/operator resolution. */
	field: FieldRow;
	/** Collection this field belongs to (the ROOT collection for a depth-0 node). */
	collection: string;
	/** Set when this field references another collection — the node can be expanded. */
	target?: string;
	/** How many hops from the root: `flag` is 0, `person.name` is 1. */
	depth: number;
	/** False when the node references a collection we refuse to walk into — see `MAX_DEPTH`/cycles. */
	expandable: boolean;
}

/**
 * How many REFERENCE HOPS the picker will walk. `flag` is depth 0, `person.name` depth 1.
 *
 * Chosen rather than discovered. Three covers every shape in a real vault — `lab-results → person →
 * …`, `meeting-summaries → meeting → company → name` — while keeping the tree readable and the
 * number of `/fields` fetches bounded. Deeper is not refused by the ENGINE; it is refused here,
 * because a picker that can expand forever is a picker nobody can scan. A hand-written filter still
 * goes as deep as it likes.
 */
export const MAX_DEPTH = 3;

/** The label a field row carries, falling back to its raw name rather than to `undefined`. */
export function labelOfField(field: FieldRow): string {
	return field.title || field.field;
}

/** A field that REFERENCES another collection, per the relations table. */
export type RelationLookup = (collection: string, field: string) => string | undefined;

/**
 * The child nodes under `parent` — or the root row set when `parent` is undefined.
 *
 * ⚠ The cycle guard is a VISITED SET ALONG THE CURRENT PATH, not a global one. `meetings → company`
 * and `contacts → company` both reach `companies`, and a global set would let whichever expanded
 * first poison the other branch. What must never happen is a path revisiting a collection it already
 * came through (`meeting → company → … → meeting`), which is exactly a per-path set.
 */
export function childNodes(
	fields: FieldRow[],
	collection: string,
	relationOf: RelationLookup,
	parent?: FieldNode,
	visited: readonly string[] = [],
): FieldNode[] {
	const depth = parent ? parent.depth + 1 : 0;
	const seen = [...visited, collection];
	return fields.map((field) => {
		const target = relationOf(collection, field.field);
		return {
			path: parent ? `${parent.path}.${field.field}` : field.field,
			label: labelOfField(field),
			labels: parent ? [...parent.labels, labelOfField(field)] : [labelOfField(field)],
			field,
			collection,
			target,
			depth,
			// Expandable only if it points somewhere, we have hops left, and we would not be walking
			// back into a collection already on this path.
			expandable: Boolean(target) && depth < MAX_DEPTH && !seen.includes(target as string),
		};
	});
}

/** The collections along a node's path, for the next `childNodes` call's cycle guard. */
export function visitedAlong(node: FieldNode, rootCollection: string): string[] {
	// The node's own collection is where its children come FROM, so both ends are on the path.
	return node.collection === rootCollection ? [rootCollection] : [rootCollection, node.collection];
}

/**
 * Search across everything currently loaded, flattened to full paths — typing `name` surfaces
 * `Person › Name` without making you expand Person first.
 *
 * Matching is on the LABELS and on the raw path, case-insensitively, and every whitespace-separated
 * term must hit somewhere: `per nam` finds `Person › Name`, which is how people actually type when
 * they half-remember a path. Deliberately NOT fuzzy — a filter picker that guesses is worse than one
 * that finds nothing, because a wrong field silently filters the wrong thing.
 */
export function searchNodes(nodes: readonly FieldNode[], query: string): FieldNode[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return [...nodes];
	return nodes.filter((n) => {
		const hay = `${n.labels.join(' ')} ${n.path}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}

/** `['Person','Name']` → `Person › Name`. `›` rather than `.`: a path through records, not a property access. */
export function joinLabels(labels: readonly string[]): string {
	return labels.join(' › ');
}

/**
 * The label for a path when we only have the ROOT collection's rows — the closed state of the picker,
 * and the chips. Deeper segments title-case their own name, because their fields belong to a
 * collection whose rows the caller has not necessarily fetched.
 */
export function labelForPath(path: string, rootFields: readonly FieldRow[], titleCase: (s: string) => string): string {
	const segments = path.split('.').filter(Boolean);
	if (!segments.length) return '';
	const root = rootFields.find((f) => f.field === segments[0]);
	const head = root ? labelOfField(root) : titleCase(segments[0] as string);
	return joinLabels([head, ...segments.slice(1).map(titleCase)]);
}

/**
 * Which collection a PATH's leaf lives in, and the leaf's own field name.
 *
 * ⚠ Everything downstream of the field pill resolves against the LEAF, not the root: the operator
 * list, the value widget, the relation target. `person.name` must offer string operators and a text
 * box — resolving it against the root collection finds no field called `person.name` at all, which
 * silently degrades to "every operator, no value widget". Returns `null` when a hop does not point
 * anywhere, which is a path built against a schema that has since changed.
 */
export function resolvePathTarget(
	path: string,
	rootCollection: string,
	relationOf: RelationLookup,
): { collection: string; field: string } | null {
	const segments = path.split('.').filter(Boolean);
	if (!segments.length) return null;
	let collection = rootCollection;
	for (const segment of segments.slice(0, -1)) {
		const target = relationOf(collection, segment);
		if (!target) return null;
		collection = target;
	}
	return { collection, field: segments[segments.length - 1] as string };
}

/** Every collection a path traverses, so a caller can fetch their field rows in one pass. */
export function collectionsAlongPath(path: string, rootCollection: string, relationOf: RelationLookup): string[] {
	const segments = path.split('.').filter(Boolean);
	const out = [rootCollection];
	let collection = rootCollection;
	for (const segment of segments.slice(0, -1)) {
		const target = relationOf(collection, segment);
		if (!target) break;
		collection = target;
		out.push(target);
	}
	return out;
}
