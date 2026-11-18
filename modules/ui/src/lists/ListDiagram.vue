<!--
	The diagram List. An ordinary layout, like Table: it draws whatever the browse hands it, the
	filter scopes it, the sort orders it, and saving it is saving a `ui-view`.

	There is no "schema diagram" as a separate thing. `collections` is a collection, its records are
	descriptors, and a diagram over it is this layout with one control set differently. That is the
	whole design (operator 2026-08-11: "the model-diagram was all along just a diagram over the
	collections collection… we just need a nice way to navigate there").

	What a node and an edge are MADE OF is a control, not a hard-coded rule. Three link modes exist
	because a vault has three kinds of link — a typed reference, a shared value, and a value worth
	drawing as a node of its own — and the first pass supported only the first, which is why `blurbs`
	(zero reference fields, all structure in `tags`) drew nothing at all.
-->
<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import DiagramCanvas from '../components/diagram/DiagramCanvas.vue';
import { layoutForce, layoutGrouped, type LayoutBox, type SizedNode } from '../lib/diagram/layout';
import { buildRecordLinks, type LinkMode } from '../lib/diagram/providers/record-links';
import { buildSchemaRefs, type SchemaFieldRow, type SchemaInput, type SchemaRelationRow } from '../lib/diagram/providers/schema-refs';
import { useCollections } from '../composables/collections';
import { loadAllFields, loadRelations } from '../composables/fields';
import type { DiagramModel } from '../lib/diagram/types';
import { tryRenderDisplay } from '../lib/template';
import { titleOf } from '../lib/record-title';
import { isRelationField } from '../lib/field-row';
import { api } from '../api/client';
import type { BrowseState } from '../composables/browse-state';
import type { ItemRecord } from '../api/types';

const props = defineProps<{ state: BrowseState }>();

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['diagram'] ?? {});
const opt = <T,>(key: string, fallback: T): T => (options.value[key] as T) ?? fallback;

const linkBy = computed<LinkMode | 'schema'>(() => opt<LinkMode | 'schema'>('link_by', 'references'));
const nodeStyle = computed<'dot' | 'box' | 'table'>(() => opt('node', 'dot'));

/**
 * Whether these records are collection descriptors — used ONLY to explain an empty canvas, never to
 * pick a default. A component that computes its own default disagrees with the one the registry
 * declares, and the options panel reads the registry's: opening `collections` drew a schema diagram
 * under the controls for a record diagram. The default lives in the registry; what a particular
 * view draws lives in its RECORD (see `modules/<workspace module>/ui-views/system.ui-view.yaml`).
 */
const isDescriptors = computed(() =>
	props.state.items.items.value.some((r: any) => r && typeof r === 'object' && r.fields && typeof r.fields === 'object' && r.compiled),
);

/**
 * How many records to draw. A DECLARED, saved, visible control rather than a layout quietly raising
 * the pager behind your back — the first pass did that on mount and it was a layout reaching into
 * shared browse state. The default is high because a diagram of the first 25 records is a diagram of
 * nothing: a large private workspace has 51 collections, and a system map missing half of them is worse than no map.
 * Narrowing is still the filter's job; this only says how big a page a picture needs.
 */
watchEffect(() => {
	const size = Number(options.value['page_size'] ?? 500);
	if (Number.isFinite(size) && size > 0 && props.state.items.limit.value !== size) props.state.items.limit.value = size;
});

/** Reference fields, per the display contract's `role`. The role says a field IS a relation; the
 *  VALUE says what it points at. */
const relationFields = computed(() =>
	props.state.fields.visibleFields.value
		.filter((f) => isRelationField(f))
		.map((f) => f.field),
);

/** Which fields the chosen mode links by. Empty selection means ALL, per `field-multi-select`. */
const linkFields = computed<string[]>(() => {
	const key = linkBy.value === 'references' ? 'ref_fields' : 'value_fields';
	const chosen = (options.value[key] as string[] | undefined) ?? [];
	if (chosen.length) return chosen;
	if (linkBy.value === 'references') return relationFields.value;
	// A value mode with nothing chosen has no honest "all" — every field would connect every
	// record through its timestamps. `tags` is the convention across this vault's collections, so
	// it is the guess; anything else is one click in the control.
	const fields = props.state.fields.visibleFields.value.map((f) => f.field);
	return fields.includes('tags') ? ['tags'] : [];
});

/**
 * Every drawn string comes from a template — the collection's own `record_title` unless the view
 * overrides it. Nothing about a label is hard-coded any more (operator: "use the display template
 * or something similar to allow control on the text everywhere it makes sense").
 */
const labelTemplate = computed(() => String(options.value['label_template'] ?? '').trim());
function labelOf(rec: Record<string, unknown>): string {
	if (labelTemplate.value) {
		const out = (tryRenderDisplay(labelTemplate.value, rec) ?? '').trim();
		if (out) return out;
	}
	return titleOf(rec as ItemRecord);
}

/** The modules' own titles, for the group boxes. `modules` is an ordinary collection, so this is the
 *  ordinary record read — no route was added for it. Fetched once, and only where it is used. */
const moduleTitles = ref<Record<string, string>>({});
watchEffect(async () => {
	if (linkBy.value !== 'schema' || Object.keys(moduleTitles.value).length) return;
	try {
		const res = await api.get<Array<Record<string, unknown>>>('/items/modules?limit=200');
		const out: Record<string, string> = {};
		for (const m of res.data ?? []) {
			const id = String(m['id'] ?? '');
			if (id) out[id] = String(m['title'] ?? id);
		}
		moduleTitles.value = out;
	} catch {
		// An older engine has no `modules` collection; the group box falls back to the raw id.
	}
});

/**
 * What the schema diagram is drawn from: the DISPLAY CONTRACT — the collection rows, every drawn
 * collection's field rows and the relation rows — never a descriptor's own keys. All three come out
 * of the one cached `/presentation` payload the adapter holds, so the per-collection field reads cost
 * nothing after the first.
 */
const schemaInput = ref<Omit<SchemaInput, 'records'>>({ collections: [], fields: {}, relations: [] });
const { tree } = useCollections();
watchEffect(async () => {
	if (linkBy.value !== 'schema') return;
	const names = (props.state.items.items.value as Array<Record<string, unknown>>).map((r) => String(r['id'] ?? ''));
	const rows = tree.value;
	try {
		const [relations, perCollection] = await Promise.all([
			loadRelations(),
			Promise.all(names.map(async (n) => [n, (await loadAllFields(n)) as unknown as SchemaFieldRow[]] as const)),
		]);
		schemaInput.value = { collections: rows, fields: Object.fromEntries(perCollection), relations: relations as SchemaRelationRow[] };
	} catch {
		schemaInput.value = { collections: rows, fields: {}, relations: [] };
	}
});

const model = computed<DiagramModel>(() => {
	if (linkBy.value === 'schema') {
		return buildSchemaRefs({ records: props.state.items.items.value as Array<Record<string, unknown>>, ...schemaInput.value }, {
			detail: nodeStyle.value === 'table' ? (opt<'refs' | 'all'>('detail', 'all')) : 'title',
			moduleTitles: moduleTitles.value,
			showSystem: options.value['show_system'] === true,
			showIsolated: options.value['show_isolated'] === true,
		});
	}
	return buildRecordLinks({
		collection: props.state.collection,
		records: props.state.items.items.value as Array<Record<string, unknown>>,
		pkOf: (r) => props.state.pkOf(r as ItemRecord),
		labelOf,
		mode: linkBy.value,
		fields: linkFields.value,
		groupBy: (options.value['group_by'] as string | undefined) ?? null,
		shape: nodeStyle.value === 'dot' ? 'dot' : 'entity',
		hideLeaves: options.value['hide_leaves'] === true,
	});
});

/** Entity node size has to be known BEFORE the DOM exists — the solver places boxes, not elements.
 *  These track EntityNode's row padding and font size; change them together. A dot is uniform. */
const HEAD_H = 30;
const ROW_H = 23;
const NODE_W = 232;
const DOT_BOX = 34;

const sized = computed<SizedNode[]>(() =>
	model.value.nodes.map((n) => ({
		id: n.id,
		width: n.shape === 'entity' ? NODE_W : DOT_BOX,
		height: n.shape === 'entity' ? HEAD_H + (n.fields?.length ?? 0) * ROW_H : DOT_BOX,
		group: n.group,
	})),
);

/** Grouped packing when the model declares a partition worth drawing, force otherwise. Entity nodes
 *  always pack (a table in a force cloud overlaps itself); dots pack only when grouped by choice. */
const useGrouped = computed(() => nodeStyle.value !== 'dot' || Boolean(options.value['group_by']));

/**
 * What the auto-layout actually DEPENDS on: which nodes exist, how tall each is, how many edges,
 * and which solver. Deliberately a value key rather than the model object.
 *
 * ⚠ The model object is rebuilt whenever ANY option changes — and dragging a node changes an option
 * (the arrangement is written into `listOptions`, which is what makes Save persist it). Keying the
 * layout off object identity therefore re-solved the graph and re-fitted the viewport on every
 * drag: the zoom jumped away from you at the exact moment you were placing something. Same class of
 * bug as watching the node array, which recomputes on hover — one level further out.
 */
const layoutKey = computed(
	() =>
		`${useGrouped.value ? 'g' : 'f'}|${model.value.edges.length}|` +
		model.value.nodes.map((n) => `${n.id}:${n.fields?.length ?? 0}`).join(','),
);

/** The auto-layout on its own — no saved arrangement mixed in, and recomputed only when the key
 *  says the picture actually changed. Solving is not free: the force pass ticks 300 times over
 *  ~300 nodes, which is not something to redo because a node moved 4px. */
const auto = ref<{ positions: Map<string, { x: number; y: number }>; groupBoxes?: Map<string, LayoutBox> }>({
	positions: new Map(),
});
const fitToken = ref(0);

watch(
	layoutKey,
	() => {
		auto.value = useGrouped.value
			? layoutGrouped(sized.value, model.value.edges)
			: { positions: layoutForce(model.value.nodes, model.value.edges), groupBoxes: undefined };
		// Refit only alongside a genuine re-solve — never on a hand placement.
		fitToken.value++;
	},
	{ immediate: true },
);

/** A hand placement. `w`/`h` appear only on a resized GROUP — a node's size comes from its content. */
type Placement = { node: string; x: number; y: number; w?: number; h?: number };
const arrangement = computed(() => (options.value['arrangement'] ?? []) as Placement[]);

/**
 * A dragged GROUP is stored as one placement (`group:<id>`) and moves every member with it — which
 * is the only thing that makes a container worth dragging. The offset is what got saved minus where
 * the solver put the box, so a re-solve that moves the whole picture still lands the group where it
 * was put relative to everything else.
 */
const groupOffsets = computed(() => {
	const out = new Map<string, { dx: number; dy: number }>();
	for (const p of arrangement.value) {
		if (!p.node.startsWith('group:')) continue;
		const id = p.node.slice('group:'.length);
		const box = auto.value.groupBoxes?.get(id);
		if (box) out.set(id, { dx: p.x - box.x, dy: p.y - box.y });
	}
	// The drag IN PROGRESS, on top of whatever was already saved. Transient by design: members have
	// to follow the container while it moves, not jump to it on release, and a position mid-gesture
	// is not something to write into a record.
	const live = liveDrag.value;
	if (live) out.set(live.group, { dx: live.dx, dy: live.dy });
	return out;
});

/**
 * Saved hand placements beat auto-layout, per node. An entry whose node is gone is ignored, not an
 * error — the position is orphaned, the diagram still draws.
 *
 * ⚠ A node placement is RELATIVE TO ITS GROUP: `final = placement + groupOffset`. The first version
 * treated it as absolute and skipped the offset — "you moved that one deliberately" — which meant a
 * hand-placed node was orphaned from its container FOREVER. Measured 2026-08-12: dragging Finance
 * moved every collection except `finance-transactions` and `finance-obligations`, which were exactly
 * the two the operator had hand-placed. Moving a container has to move what is inside it; that is
 * what a container IS.
 */
const positions = computed(() => {
	const merged = new Map(auto.value.positions);
	const byNode = new Map(arrangement.value.filter((p) => !p.node.startsWith('group:')).map((p) => [p.node, p]));
	for (const n of model.value.nodes) {
		const own = byNode.get(n.id);
		const base = own ? { x: own.x, y: own.y } : merged.get(n.id);
		if (!base) continue;
		const off = n.group ? groupOffsets.value.get(n.group) : undefined;
		merged.set(n.id, off ? { x: base.x + off.dx, y: base.y + off.dy } : base);
	}
	return merged;
});

/**
 * A container being dragged right now. Only the MEMBERS read it — Vue Flow is already moving the
 * container itself, and feeding its position back through the prop mid-drag would have the two
 * fighting over the same node.
 */
const liveDrag = ref<{ group: string; dx: number; dy: number } | null>(null);

function onDragging(id: string, pos: { x: number; y: number }) {
	if (!id.startsWith('group:')) return;
	const group = id.slice('group:'.length);
	const box = auto.value.groupBoxes?.get(group);
	if (box) liveDrag.value = { group, dx: pos.x - box.x, dy: pos.y - box.y };
}

/** The containers, moved to wherever their group was dropped. */
const groupBoxes = computed(() => {
	const boxes = auto.value.groupBoxes;
	if (!boxes) return undefined;
	const out = new Map(boxes);
	for (const [id, off] of groupOffsets.value) {
		// The dragged container is NOT skipped. `:nodes` is prop-controlled, so this value wins over
		// Vue Flow's internal drag position anyway — skipping it left the box sitting still while its
		// members slid away, which is the original complaint inverted.
		const box = out.get(id);
		if (box) out.set(id, { ...box, x: box.x + off.dx, y: box.y + off.dy });
	}
	// A hand-set size WINS over the solver's bounding box. Members are not rescaled with it: the box
	// is a region you drew, and moving what is inside it is a separate gesture.
	for (const p of arrangement.value) {
		if (!p.node.startsWith('group:') || p.w == null || p.h == null) continue;
		const id = p.node.slice('group:'.length);
		const box = out.get(id);
		if (box) out.set(id, { ...box, width: p.w, height: p.h });
	}
	return out;
});

/**
 * Writing into `listOptions` is what makes the EXISTING Save button persist this into the ui-view
 * record — the right panel already reads `listOptions[layout]` and writes it as the view's options.
 *
 * ⚠ Never `toObject()` the graph: it carries `handleBounds`, `dimensions`, `selected`, `dragging`
 * and provider-computed `data`, so the record would churn on every click and its content would rot
 * the moment the schema changed. The arrangement is the only thing the operator authored.
 */
function onMove(id: string, pos: { x: number; y: number }) {
	// ⚠ Read the offset BEFORE clearing the live drag, and store a node's position RELATIVE to its
	// group — the rendered position already includes the offset, so persisting it raw would add the
	// offset a second time on the next render and the node would leap.
	const node = model.value.nodes.find((n) => n.id === id);
	const off = node?.group ? groupOffsets.value.get(node.group) : undefined;
	liveDrag.value = null; // the gesture is over; the arrangement takes it from here
	const saved = [...arrangement.value];
	const at = saved.findIndex((p) => p.node === id);
	const entry = {
		node: id,
		x: Math.round(pos.x - (off?.dx ?? 0)),
		y: Math.round(pos.y - (off?.dy ?? 0)),
	};
	if (at === -1) saved.push(entry);
	else saved[at] = entry;
	props.state.setListOptions('diagram', { ...options.value, arrangement: saved });
}

/** A resized container, stored beside its position on the same placement entry. */
function onResize(id: string, size: { w: number; h: number }) {
	const saved = [...arrangement.value];
	const at = saved.findIndex((p) => p.node === id);
	const box = auto.value.groupBoxes?.get(id.slice('group:'.length));
	const entry: Placement = {
		node: id,
		x: saved[at]?.x ?? box?.x ?? 0,
		y: saved[at]?.y ?? box?.y ?? 0,
		w: size.w,
		h: size.h,
	};
	if (at === -1) saved.push(entry);
	else saved[at] = { ...saved[at]!, ...entry };
	props.state.setListOptions('diagram', { ...options.value, arrangement: saved });
}

/** A node id is `<collection>/<id>`; opening one only makes sense for a record we actually loaded. */
function onOpen(id: string) {
	const own = `${props.state.collection}/`;
	if (!id.startsWith(own)) return;
	const pk = id.slice(own.length);
	const rec = (props.state.items.items.value as ItemRecord[]).find((r) => String(props.state.pkOf(r)) === pk);
	if (rec) props.state.openRecord(rec);
}

/** Say WHY the canvas is empty, and name the control that fixes it — an empty canvas with no
 *  explanation is what made the first version read as broken on `blurbs`. */
const emptyReason = computed(() => {
	if (props.state.items.items.value.length === 0) return 'no records in this view';
	if (linkBy.value === 'schema' && !isDescriptors.value)
		return 'these records are not collection descriptors — pick another Link by';
	if (linkBy.value === 'references' && !relationFields.value.length)
		return 'no reference fields on this collection — link by a shared value or by values instead';
	if (linkBy.value !== 'references' && !linkFields.value.length) return 'pick a field to link by';
	return 'nothing to draw';
});
</script>

<template>
	<div class="dt-diagram">
		<div v-if="!model.nodes.length" class="dt-empty">{{ emptyReason }}</div>

		<DiagramCanvas
			v-else
			:model="model"
			:positions="positions"
			:group-boxes="groupBoxes"
			:fit-token="fitToken"
			@move="onMove"
			@dragging="onDragging"
			@open="onOpen"
			@resize="onResize"
		/>
	</div>
</template>

<style scoped>
.dt-diagram {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 420px;
}
.dt-diagram :deep(.dt-diagram__flow) {
	flex: 1;
	min-height: 0;
}
.dt-empty {
	padding: 24px;
	color: var(--dt-fg-subtle);
	font-size: 12px;
}
</style>
