/**
 * The one vocabulary every diagram provider and the canvas share. Nothing here knows about
 * descriptors, records or Vue Flow — that separation is what lets one canvas draw a schema, a record
 * graph, or whatever a module invents.
 */

/** How a node is drawn. `entity` = table with field rows; `dot` = labelled circle. */
export type NodeShape = 'entity' | 'dot';

export interface DiagramField {
	name: string;
	/** Right-hand annotation, e.g. `string?`, `contacts[]`. */
	label: string;
	/** Target of a reference field, for edge anchoring. Null for a plain field. */
	ref: string | null;
	isId: boolean;
}

export interface DiagramNode {
	/** STABLE and meaningful — `collections/meetings`, `meetings/2026/08/x`. Never a generated id:
	 *  a saved arrangement is keyed on this, so it must survive a re-derive. */
	id: string;
	label: string;
	shape: NodeShape;
	/** Group id this node sits in, or undefined. */
	group?: string;
	/** Drawn hollow — known of, but not loaded (a referenced record we never fetched). */
	ghost?: boolean;
	/** `entity` shape only. */
	fields?: DiagramField[];
	/** `dot` shape only — drives radius. */
	degree?: number;
	icon?: string;
	/** Engine-owned rather than the operator's own — badged `sys` on an entity node. */
	system?: boolean;
}

export interface DiagramEdge {
	id: string;
	source: string;
	target: string;
	/** The field the reference came from — `company`, `attendees`. Shown on hover. */
	field: string;
	/** Anchor on this field row of the source node (`entity` shape). */
	sourceField?: string;
	many: boolean;
	/**
	 * Cardinality of a DECLARED two-way relation, in the engine's own three names
	 * (`src/relations.js`): `m2o` many-to-one, `o2o` one-to-one, `m2m` many-to-many. Absent on a
	 * plain one-way reference (no mirror), which declares no cardinality to read — the canvas falls back to
	 * `many` there, so the drawing distinguishes a relation from a bare reference.
	 */
	kind?: 'm2o' | 'o2o' | 'm2m';
}

export interface DiagramGroup {
	id: string;
	label: string;
}

export interface DiagramModel {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	groups: DiagramGroup[];
}

/** What the viewer chose to see. Persisted in the ui-view's options. */
export interface Lens {
	/** Group ids drawn collapsed. */
	collapsed?: string[];
	/** Hand-placed positions. Array, not a map: each entry names a node so the shape stays
	 *  inspectable in a diff. */
	arrangement?: Array<{ node: string; x: number; y: number }>;
}
