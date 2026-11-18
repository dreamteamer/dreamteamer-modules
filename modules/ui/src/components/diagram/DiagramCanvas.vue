<!--
	The one canvas. Presentational: a `DiagramModel` and a position map go in, a `move` (a node was
	dragged) and an `open` (a node was double-clicked) come out. It knows nothing about descriptors,
	records, collections or the engine — which is exactly what lets the same component draw a schema,
	a record graph, a module map, or whatever a provider invents next.

	Everything that IS diagram craft lives here, once, instead of once per view: group accents,
	hover-neighbourhood dimming, labels that appear as you zoom in, and the fit-after-measure dance.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { VueFlow, MarkerType, type Edge, type Node, type VueFlowStore, type ViewportTransform } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import EntityNode from './EntityNode.vue';
import DotNode from './DotNode.vue';
import GroupNode from './GroupNode.vue';
import type { DiagramModel } from '../../lib/diagram/types';
import type { LayoutBox } from '../../lib/diagram/layout';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const props = defineProps<{
	model: DiagramModel;
	positions: Map<string, { x: number; y: number }>;
	/** Container boxes, when the auto-layout produced them (grouped layouts only). */
	groupBoxes?: Map<string, LayoutBox>;
	/** Bumped by the host when the AUTO layout changed and the viewport should refit. Deliberately
	 *  not derived from `positions`: a hand-drag rewrites one position, and refitting on that would
	 *  yank the viewport out from under the gesture that caused it. */
	fitToken?: number;
}>();

const emit = defineEmits<{
	(e: 'move', id: string, pos: { x: number; y: number }): void;
	(e: 'open', id: string): void;
	(e: 'resize', id: string, size: { w: number; h: number }): void;
	/** Fired CONTINUOUSLY while a node is being dragged, so a container's members can follow it
	 *  live. `move` still fires once on release and is the only one that persists. */
	(e: 'dragging', id: string, pos: { x: number; y: number }): void;
}>();

/** Fixed hues rather than generated ones: checked to read on both themes, and a stable palette
 *  means the same model draws the same colours every time it is opened. */
const ACCENTS = ['#7c5cff', '#0e9f6e', '#e2a300', '#e5484d', '#3b82f6', '#c026d3', '#0891b2', '#ea580c'];
const UNGROUPED_ACCENT = '#64748b';

const accentOf = computed(() => {
	const map = new Map<string, string>();
	props.model.groups.forEach((g, i) => map.set(g.id, ACCENTS[i % ACCENTS.length]!));
	return map;
});

const hovered = ref<string | null>(null);

/**
 * Labels are hidden when zoomed out, the way every graph view worth using does it: 250 labels at
 * once is noise, and the shape of the graph is the information at that scale. Zoom in and the names
 * arrive. A hovered node keeps its label at any zoom. Entity nodes always carry theirs — they are
 * boxes with a title band, not dots.
 */
const zoom = ref(1);
const LABEL_ZOOM = 0.72;

/**
 * ⚠ `fitViewOnInit` — and a fit at `paneReady` — BOTH run before Vue Flow has MEASURED the nodes,
 * so they compute bounds from zero-sized boxes and park the diagram off-screen. Hold the store and
 * refit after the layout lands.
 */
const flow = ref<VueFlowStore | null>(null);
function onPaneReady(store: VueFlowStore) {
	flow.value = store;
}

/** ⚠ Watch the fit token, NEVER the computed node array: the node array recomputes on hover
 *  (dimming lives in node data), so refitting off it yanks the viewport back to centre every time
 *  the cursor crosses a node. */
watch(
	() => props.fitToken,
	async () => {
		await nextTick();
		// nextTick alone is not enough: Vue Flow measures node sizes through a ResizeObserver, which
		// reports AFTER the paint.
		setTimeout(() => void flow.value?.fitView({ padding: 0.1, maxZoom: 1 }), 120);
	},
	{ flush: 'post', immediate: true },
);

const shapeOf = computed(() => {
	const map = new Map<string, 'entity' | 'dot'>();
	for (const n of props.model.nodes) map.set(n.id, n.shape);
	return map;
});

const neighbours = computed<Set<string>>(() => {
	const id = hovered.value;
	if (!id) return new Set();
	const set = new Set<string>([id]);
	for (const e of props.model.edges) {
		if (e.source === id) set.add(e.target);
		if (e.target === id) set.add(e.source);
	}
	return set;
});

const nodes = computed<Node[]>(() => {
	const dimming = hovered.value !== null;
	const showLabels = zoom.value >= LABEL_ZOOM;

	// Containers first so they paint behind their members.
	const groupNodes: Node[] = [...(props.groupBoxes?.entries() ?? [])].map(([group, box]) => ({
		id: `group:${group}`,
		type: 'dtgroup',
		position: { x: box.x, y: box.y },
		style: { width: `${box.width}px`, height: `${box.height}px` },
		data: {
			label: props.model.groups.find((g) => g.id === group)?.label ?? group,
			accent: accentOf.value.get(group) ?? UNGROUPED_ACCENT,
			// The handle converts SCREEN deltas to graph units, so it needs the live zoom.
			zoom: zoom.value,
		},
		// DRAGGABLE since 2026-08-12 (operator, twice: "i cant move them, resize them"). It still
		// paints behind its members and is not selectable — but a container you cannot place is a
		// container that only auto-layout can arrange, and the whole point of saving a diagram is
		// that you arranged it. Moving one carries its members with it; the host does that, because
		// only the host knows which nodes belong to which group.
		selectable: false,
		draggable: true,
		zIndex: 0,
	}));

	const modelNodes: Node[] = props.model.nodes.flatMap((n) => {
		const p = props.positions.get(n.id);
		if (!p) return [];
		const accent = n.group ? (accentOf.value.get(n.group) ?? UNGROUPED_ACCENT) : UNGROUPED_ACCENT;
		const dimmed = dimming && !neighbours.value.has(n.id);

		return [
			{
				id: n.id,
				type: n.shape === 'entity' ? 'dtentity' : 'dtdot',
				position: p,
				zIndex: 1,
				data:
					n.shape === 'entity'
						? { label: n.label, icon: n.icon, system: n.system, fields: n.fields, accent, dimmed }
						: {
								label: n.label,
								group: n.group ?? '',
								ghost: n.ghost === true,
								accent,
								// Degree drives radius, so hubs read as hubs. Clamped so one very
								// popular node can't swallow the canvas.
								size: Math.min(34, 10 + (n.degree ?? 0) * 2.5),
								dimmed,
								showLabel: showLabels || hovered.value === n.id || neighbours.value.has(n.id),
							},
			} as Node,
		];
	});

	return [...groupNodes, ...modelNodes];
});

// A DECLARED relation's cardinality, read in the direction the arrow points — source is the owning
// side, the one that physically holds the foreign key. So a many-to-one edge reads `N:1` from the
// owner it leaves to the target it lands on; the same relation described from the target is the
// `1:N` its generated mirror would show, and that arrow is deliberately not drawn.
// A bare reference with no mirror keeps the old `N`/`1`, which is exactly the distinction worth
// seeing: one is a relation, the other is a pointer.
const KIND_LABEL: Record<'m2o' | 'o2o' | 'm2m', string> = { m2o: 'N:1', o2o: '1:1', m2m: 'N:M' };

const edges = computed<Edge[]>(() => {
	const dimming = hovered.value !== null;
	return props.model.edges.map((e) => {
		const lit = !dimming || (neighbours.value.has(e.source) && neighbours.value.has(e.target));
		const entity = shapeOf.value.get(e.source) === 'entity';
		return {
			id: e.id,
			source: e.source,
			target: e.target,
			// Entity nodes anchor per field; a nested reference (`attendees.contact`) anchors on its
			// top-level row, which is the row the node actually draws. Dots have one anonymous pair.
			sourceHandle: entity ? (e.sourceField ?? e.field).split('.')[0] : undefined,
			targetHandle: entity ? '__id' : undefined,
			type: entity ? 'smoothstep' : 'straight',
			label: entity ? (e.kind ? KIND_LABEL[e.kind] : e.many ? 'N' : '1') : dimming && lit ? e.field : undefined,
			animated: dimming && lit,
			markerEnd: MarkerType.ArrowClosed,
			style: { opacity: lit ? (entity ? 1 : 0.75) : entity ? 0.1 : 0.06 },
			zIndex: 2,
		};
	});
});

/** A group container is not a node in the model, so hovering or opening one means nothing. */
function isModelNode(id: string): boolean {
	return !id.startsWith('group:');
}
</script>

<template>
	<VueFlow
		:nodes="nodes"
		:edges="edges"
		:min-zoom="0.02"
		:max-zoom="2.5"
		fit-view-on-init
		class="dt-diagram__flow"
		@pane-ready="onPaneReady"
		@viewport-change="zoom = ($event as ViewportTransform).zoom"
		@node-mouse-enter="hovered = isModelNode($event.node.id) ? $event.node.id : null"
		@node-mouse-leave="hovered = null"
		@node-drag="emit('dragging', $event.node.id, $event.node.position)"
		@node-drag-stop="emit('move', $event.node.id, $event.node.position)"
		@node-double-click="isModelNode($event.node.id) && emit('open', $event.node.id)"
	>
		<Background :gap="16" :size="1.1" pattern-color="var(--dt-border)" />
		<Controls :show-interactive="false" />
		<!-- maskColor is a PROP, not CSS, so it can't take a `--dt-*` token; a neutral at low alpha
		     is the one value that reads on both themes. -->
		<MiniMap pannable zoomable mask-color="rgba(127,127,127,0.32)" :node-color="(n: any) => n.data?.accent ?? '#888'" />

		<template #node-dtentity="nodeProps">
			<EntityNode v-bind="nodeProps" />
		</template>
		<template #node-dtdot="nodeProps">
			<DotNode v-bind="nodeProps" />
		</template>
		<template #node-dtgroup="nodeProps">
			<GroupNode v-bind="nodeProps" @resize="(id, size) => emit('resize', id, size)" />
		</template>
	</VueFlow>
</template>

<style>
/* Vue Flow paints its own surface; hand it the app's. Unscoped because these are the library's own
   class names, emitted outside any component's style scope.
   ⚠ `--dt-bg`, the PAGE background, not `--dt-bg-subtle`: a canvas one shade off its own tab reads
   as a panel embedded in the page rather than as the page (operator 2026-08-12). The dot grid is
   what says "this pans", so it stays. */
.dt-diagram__flow.vue-flow {
	background: var(--dt-bg);
}
.dt-diagram__flow .vue-flow__edge-path {
	stroke: var(--dt-border-strong);
	stroke-width: 1.3;
}
.dt-diagram__flow .vue-flow__edge-text {
	fill: var(--dt-fg-subtle);
	font-size: 9px;
	font-family: var(--dt-font-mono);
}
.dt-diagram__flow .vue-flow__edge-textbg {
	fill: var(--dt-bg);
}
.dt-diagram__flow .vue-flow__controls-button {
	background: var(--dt-bg);
	border-bottom: 1px solid var(--dt-border);
	fill: var(--dt-fg);
}
.dt-diagram__flow .vue-flow__minimap {
	background-color: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
}
</style>
