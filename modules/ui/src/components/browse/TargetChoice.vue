<!--
	WHERE A NEW RECORD GOES — asked BEFORE the form (cr-vscode-004, decision 2026-10-31 "a popover on the
	New button"). Opened by New on a list that reads two or more roots a record can be added to (or one
	the picker narrows to roots that take none): one row per target, each with its mark — the pencil says
	it writes — and the root's class; then each narrowed source that is NOT offered, with its reason
	(a layer not compiled here, an installed package, a layer not installed). A pick opens the ordinary
	create form with `?target=<name>`, whose Saves-to line names the root and whose save writes there.

	Anchored under the header's + (the filter panel's technique: absolute, no portal), closed by Escape,
	an outside click, or a pick. `lib/sources.ts` `targetChoice` decides when it opens and what it lists.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { TargetChoice } from '../../lib/sources';
import { viaWord } from '../../lib/sources';
import SourceMark from '../SourceMark.vue';

const props = defineProps<{ choice: Extract<TargetChoice, { mode: 'choose' }> }>();
const emit = defineEmits<{ pick: [name: string]; cancel: [] }>();

const panel = ref<HTMLElement | null>(null);

function onDocumentMousedown(event: MouseEvent): void {
	const target = event.target as Node | null;
	// the + itself toggles; a click anywhere else closes
	if (target && (panel.value?.contains(target) || panel.value?.parentElement?.contains(target))) return;
	emit('cancel');
}
function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape') emit('cancel');
}
onMounted(() => {
	if (typeof document === 'undefined') return;
	document.addEventListener('mousedown', onDocumentMousedown);
	document.addEventListener('keydown', onDocumentKeydown);
});
onUnmounted(() => {
	if (typeof document === 'undefined') return;
	document.removeEventListener('mousedown', onDocumentMousedown);
	document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
	<div ref="panel" class="dt-target-choice" role="menu" aria-label="New record in…" data-target-choice>
		<p class="dt-target-choice__head">New record in…</p>
		<button
			v-for="t in props.choice.targets"
			:key="t.name"
			type="button"
			role="menuitem"
			class="dt-target-choice__row"
			:data-target="t.name"
			@click="emit('pick', t.name)"
		>
			<SourceMark :name="t.name" :access="t.access" :via="t.via" :note="t.note" />
			<span class="dt-target-choice__via">{{ viaWord(t.via) }}</span>
		</button>
		<p v-if="!props.choice.targets.length" class="dt-target-choice__empty">No source of this list takes a new record from here.</p>
		<template v-if="props.choice.excluded.length">
			<p class="dt-target-choice__subhead">Not offered</p>
			<p v-for="x in props.choice.excluded" :key="x.source.name" class="dt-target-choice__excluded" :data-excluded="x.source.name">
				<SourceMark :name="x.source.name" :access="x.source.access" :via="x.source.via" />
				<span class="dt-target-choice__reason">{{ x.reason }}</span>
			</p>
		</template>
		<p v-if="props.choice.hidden" class="dt-target-choice__hidden">
			{{ props.choice.hidden }} other source{{ props.choice.hidden === 1 ? '' : 's' }} take{{ props.choice.hidden === 1 ? 's' : '' }} no new record from here — the Sources picker says why.
		</p>
	</div>
</template>

<style scoped>
.dt-target-choice {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 30;
	min-width: 260px;
	max-width: 420px;
	max-height: min(60vh, 480px);
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	padding: 4px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius-lg);
	box-shadow: var(--dt-shadow-lg);
	text-align: left;
}
.dt-target-choice__head,
.dt-target-choice__subhead {
	margin: 0;
	padding: 6px 8px 4px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
}
.dt-target-choice__subhead {
	border-top: 1px solid var(--dt-border);
	margin-top: 4px;
}
.dt-target-choice__row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border: 0;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dt-target-choice__row:hover,
.dt-target-choice__row:focus-visible {
	background: var(--dt-bg-hover);
}
.dt-target-choice__via {
	margin-left: auto;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
}
.dt-target-choice__excluded {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
	padding: 4px 8px;
	opacity: 0.8;
}
.dt-target-choice__reason,
.dt-target-choice__empty,
.dt-target-choice__hidden {
	margin: 0;
	padding: 0 8px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	white-space: normal;
}
.dt-target-choice__reason {
	padding: 0;
}
</style>
