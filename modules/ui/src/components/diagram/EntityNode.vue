<!--
	An `entity` node — a header band plus one row per field, the id row first.

	Handles are per-FIELD on the source side (`:id="f.name"`) and a single `__id` handle on the
	target side, so an edge leaves the exact row that holds the reference and lands on the id it
	points at — the thing that makes an ERD readable rather than a box-and-line diagram. Vue Flow
	derives handle coordinates from the DOM, so each handle has to live inside its row.

	Everything is coloured from the app's own tokens (`--dt-*`), so the diagram themes with VS Code
	light/dark for free. The per-group accent is the ONE exception: a hue picked by group index,
	which is what gives the drawing its map-like legibility.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { DiagramField } from '../../lib/diagram/types';
import DtIcon from '../DtIcon.vue';

const props = defineProps<{
	data: {
		label: string;
		icon?: string;
		/** Engine-owned (runtime storage) — badged, so the operator's own model reads apart. */
		system?: boolean;
		fields?: DiagramField[];
		accent: string;
		dimmed: boolean;
	};
}>();

const fields = computed(() => props.data.fields ?? []);
</script>

<template>
	<div class="dt-entity" :class="{ '--dimmed': data.dimmed, '--system': data.system }">
		<div class="dt-entity__head" :style="{ background: data.accent }">
			<DtIcon class="dt-entity__icon" :name="data.icon || 'table'" />
			<span class="dt-entity__title">{{ data.label }}</span>
			<span v-if="data.system" class="dt-entity__sys" title="engine collection">sys</span>
		</div>

		<div v-for="f in fields" :key="f.name" class="dt-entity-row" :class="{ '--ref': !!f.ref, '--id': f.isId }">
			<!-- The id row is where every incoming reference lands. -->
			<Handle v-if="f.isId" type="target" :position="Position.Left" id="__id" class="dt-entity-handle" />

			<span class="dt-entity-row__name">{{ f.name }}</span>
			<DtIcon v-if="f.isId"  class="dt-entity-row__key" name="key" />
			<span class="dt-entity-row__type">{{ f.label }}</span>

			<Handle v-if="f.ref" type="source" :position="Position.Right" :id="f.name" class="dt-entity-handle" />
		</div>
	</div>
</template>

<style scoped>
.dt-entity {
	min-width: 232px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius-lg, 10px);
	box-shadow: var(--dt-shadow);
	overflow: hidden;
	font-family: var(--dt-font);
	transition: opacity 120ms ease, box-shadow 120ms ease;
}
.dt-entity.--dimmed {
	opacity: 0.35;
}
.dt-entity:hover {
	box-shadow: var(--dt-shadow-lg);
}

.dt-entity__head {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 7px 10px;
	color: #fff;
	font-weight: 600;
	font-size: 12px;
	letter-spacing: 0.01em;
}
.dt-entity__icon {
	font-size: 15px;
	opacity: 0.9;
}
.dt-entity__title {
	flex: 1;
	white-space: nowrap;
}
.dt-entity__sys {
	font-size: 9px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	opacity: 0.75;
	border: 1px solid rgba(255, 255, 255, 0.5);
	border-radius: 3px;
	padding: 0 3px;
}

.dt-entity-row {
	position: relative;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 10px;
	font-size: 11.5px;
	border-top: 1px solid var(--dt-border);
	color: var(--dt-fg);
}
.dt-entity-row.--id {
	font-weight: 600;
}
.dt-entity-row.--ref .dt-entity-row__name {
	color: var(--dt-link);
}
.dt-entity-row__name {
	flex: 1;
	white-space: nowrap;
}
.dt-entity-row__key {
	font-size: 13px;
	color: var(--dt-fg-subtle);
}
.dt-entity-row__type {
	font-family: var(--dt-font-mono);
	font-size: 10.5px;
	color: var(--dt-fg-subtle);
	white-space: nowrap;
}

/* Anchors, not ornaments — the edge should look like it leaves the row itself. */
.dt-entity-handle {
	width: 7px;
	height: 7px;
	min-width: 0;
	min-height: 0;
	border: 1px solid var(--dt-bg);
	background: var(--dt-fg-subtle);
	opacity: 0.9;
}
</style>
