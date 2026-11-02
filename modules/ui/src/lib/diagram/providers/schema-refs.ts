/**
 * The collections → the schema diagram's model. The ERD.
 *
 * Read off the DISPLAY CONTRACT (descriptor v2, §4.3) — the engine's own answer — never off a
 * descriptor's keys: a node is a collection row (title, `nav.icon`, `internal`), its rows are that
 * collection's field rows (type, `many`, `required`, choices), and its edges are the relation rows,
 * which name every reference's target and mark the generated far end `mirror`. The drawing therefore
 * shows exactly the relations the engine declares, not a second opinion about them; if this file and
 * the engine ever disagree, the engine is right and this is the bug.
 *
 * The browse's own records (the `collections` collection) say WHICH collections are drawn, and each
 * record's compile-written `compiled.module` says the module that owns it — the one partition the
 * nav draws, so a group box reads exactly as the nav folder does.
 */
import type { DiagramModel, DiagramField, DiagramNode, DiagramEdge } from '../types';

/** One collection row of the display contract — the keys the diagram reads. */
export interface SchemaCollectionRow {
	collection: string;
	title: string;
	nav: { icon?: string };
	internal: boolean;
}

/** One field row of the display contract (engine `PresentationField`) — the keys the diagram reads. */
export interface SchemaFieldRow {
	field: string;
	type: string;
	many?: boolean;
	required?: boolean;
	editor_options?: { choices?: unknown[] };
}

/** One relation row: one per SIDE — the key's carries `kind`, the generated far end `mirror: true`. */
export interface SchemaRelationRow {
	collection: string;
	field: string;
	related_collection: string | null;
	list?: boolean;
	kind?: 'm2o' | 'o2o' | 'm2m';
	mirror?: true;
}

/** Everything the diagram is built from. */
export interface SchemaInput {
	/** The `collections` records the browse holds — which collections are drawn, by record id. */
	records: Array<Record<string, unknown>>;
	collections: SchemaCollectionRow[];
	fields: Record<string, SchemaFieldRow[]>;
	relations: SchemaRelationRow[];
}

/** A record's collection name: its id (`collections/<name>` is the record's own ref). */
function nameOf(record: Record<string, unknown>): string {
	return String(record['name'] ?? record['id'] ?? '').replace(/^\/?collections\//, '');
}

/** The module that owns a collection — the `compiled.module` compile wrote on its record. */
function moduleOf(record: Record<string, unknown> | undefined): string | undefined {
	const compiled = record?.['compiled'];
	const m = compiled && typeof compiled === 'object' ? (compiled as Record<string, unknown>)['module'] : undefined;
	return typeof m === 'string' && m ? m : undefined;
}

/** The short type annotation a table row shows. A reference renders its target instead. */
function typeLabel(row: SchemaFieldRow, target: string | null): string {
	const opt = row.required ? '' : '?';
	const list = row.many ? '[]' : '';
	if (target) return `${target}${list}${opt}`;
	const choices = row.editor_options?.choices;
	if (Array.isArray(choices) && choices.length > 0) return `enum(${choices.length})${list}${opt}`;
	const short: Record<string, string> = { integer: 'int', boolean: 'bool', map: 'object' };
	return `${short[row.type] ?? row.type}${list}${opt}`;
}

export interface SchemaRefsOptions {
	/**
	 * How much of each table to draw. `title` is not a degraded mode — it is the only one in which
	 * the WHOLE system fits a screen: measured 2026-08-11, a large private workspace's 34 connected collections at full
	 * detail lay out 4384 × 3934 and fit at ~0.2, where a field row is a pixel. Title bands read.
	 */
	detail?: 'title' | 'refs' | 'all';
	/** module id → its own title, so a group box reads "CRM" exactly as the nav folder does. Without
	 *  it the one axis would still be spelled two ways, which is the whole thing this replaced. */
	moduleTitles?: Record<string, string>;
	/** Include the workspace's plumbing — the `internal` collections (skills, commands, ui-views…). */
	showSystem?: boolean;
	/**
	 * Draw collections with no references in either direction. Hidden by DEFAULT because this is a
	 * relationship diagram: an unconnected table contributes a box and no information, and in this
	 * workspace they are the majority — 40 collections, most of them islands, which the solver
	 * stacks into one unreadable column. They are never lost, only undrawn; the table layout still
	 * lists every one.
	 */
	showIsolated?: boolean;
}

/** One pass: collections → nodes and edges, restricted to `only` when given. */
function build(input: SchemaInput, opts: SchemaRefsOptions, only?: Set<string>): DiagramModel {
	const rows = new Map(input.collections.map((c) => [c.collection, c]));
	const records = new Map(input.records.map((r) => [nameOf(r), r]));
	const names = [...records.keys()].filter((n) => rows.has(n));
	const known = new Set(names);
	const nodes: DiagramNode[] = [];
	const edges: DiagramEdge[] = [];

	for (const name of names) {
		if (only && only.size > 0 && !only.has(name)) continue;
		const row = rows.get(name)!;
		const targets = new Map(input.relations.filter((r) => r.collection === name && r.related_collection).map((r) => [r.field, r.related_collection!]));

		// The injected `id` is not drawn as a field row of its own (it is `virtual`), so it is
		// synthesised here, first, so the node carries its key row like any table.
		const all: DiagramField[] = [
			{ name: 'id', label: 'string', ref: null, isId: true },
			...(input.fields[name] ?? [])
				.filter((f) => f.field !== 'id' && f.field !== 'created' && f.field !== 'last_modified')
				.map((f) => {
					const target = targets.get(f.field) ?? null;
					return { name: f.field, label: typeLabel(f, target), ref: target, isId: false };
				}),
		];
		// ⚠ The id row carries the incoming-edge handle, so `refs` keeps it even though it is not a
		// reference — drop it and every edge loses its landing point. `title` has no rows at all,
		// and the canvas anchors those edges on the node box itself.
		const detail = opts.detail ?? 'all';
		const fields: DiagramField[] =
			detail === 'all' ? all : detail === 'refs' ? all.filter((f) => f.isId || f.ref) : [];

		nodes.push({
			// STABLE and meaningful: `collections/<name>` is the record's own ref, which is what a
			// saved arrangement is keyed on.
			id: `collections/${name}`,
			label: row.title || name,
			shape: 'entity',
			icon: row.nav.icon,
			// The OWNING MODULE, which is the same partition the nav draws — one axis, not two. It is
			// the module whose source is the BASE, so a collection another module overlays stays with
			// its owner.
			group: moduleOf(records.get(name)),
			system: row.internal,
			fields,
		});
	}

	const drawn = new Set(nodes.map((n) => n.id));

	for (const r of input.relations) {
		// ONE EDGE PER RELATION. The generated mirror is the same edge seen from the other end —
		// drawing it too gives every two-way relation a redundant second arrow, and makes a relation
		// look like two independent references. The row still appears in the node's field list, so
		// nothing is hidden; it just does not get its own arrow.
		if (r.mirror || !r.related_collection) continue;
		// A reference to a collection that isn't drawn (filtered out, or genuinely missing — which
		// `check` reports as a violation) gets no edge. The row still shows the target name, so the
		// information isn't lost, it just has nowhere to land.
		const source = `collections/${r.collection}`;
		const target = `collections/${r.related_collection}`;
		if (!drawn.has(source) || !drawn.has(target) || !known.has(r.related_collection)) continue;
		edges.push({
			id: `${source}.${r.field}->${r.related_collection}`,
			source,
			target,
			field: r.field,
			sourceField: r.field,
			many: r.list === true,
			...(r.kind && { kind: r.kind }),
		});
	}

	const groups: DiagramModel['groups'] = [];
	for (const n of nodes)
		if (n.group && !groups.some((g) => g.id === n.group))
			groups.push({ id: n.group, label: opts.moduleTitles?.[n.group] ?? n.group });

	return { nodes, edges, groups };
}

export function buildSchemaRefs(input: SchemaInput, opts: SchemaRefsOptions = {}): DiagramModel {
	const internal = new Set(input.collections.filter((c) => c.internal).map((c) => c.collection));
	const names = input.records.map(nameOf);
	const visible = opts.showSystem ? names : names.filter((n) => !internal.has(n));
	const first = build(input, opts, new Set(visible));
	if (opts.showIsolated) return first;

	// Connectivity is only knowable AFTER the edges are built, so this is a second pass over the
	// same builder rather than a filter argument — cheap (tens of collections) and keeps `build`
	// ignorant of presentation choices.
	const connected = new Set<string>();
	for (const e of first.edges) {
		connected.add(e.source.slice('collections/'.length));
		connected.add(e.target.slice('collections/'.length));
	}
	if (connected.size === 0) return first;
	return build(input, opts, connected);
}
