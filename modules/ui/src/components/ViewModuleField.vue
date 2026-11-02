<!--
	A ui-view's MODULE, on its record page — the field that MOVES the view's source to another module
	(`dt set ui-views/<id> module=<m>`), the way a collection moves. Presentational: `ViewModulePanel`
	loads the record and performs the move; this draws the choice and the answer beside it.

	Only modules whose sources are in this workspace are offered — an inline module, or a linked
	clone's, which is how a view tested here becomes that module's source, ready to commit and publish
	from the clone. A view an installed package ships does not move from here, and the field says why
	instead of offering a choice that would be refused.
-->
<script setup lang="ts">
import DtIcon from './DtIcon.vue';
import type { SaveAnswer } from '../lib/save-answer';
import type { ViewModuleTarget } from '../lib/view-module-targets';

const props = defineProps<{
	/** The module the view is compiled from now (`$module` on the record). */
	module: string | undefined;
	/** Every module — a locked one is drawn with its reason and cannot be picked. */
	targets: ViewModuleTarget[];
	/** Set when the view cannot move from here: the reason, drawn in place of the choice. */
	readOnlyReason?: string | null;
	busy: boolean;
	answer: SaveAnswer | null;
}>();

const emit = defineEmits<{ move: [module: string] }>();

function pick(to: string | null): void {
	if (to && to !== props.module && !props.busy) emit('move', to);
}
</script>

<template>
	<section class="dt-view-module" data-view-module>
		<p class="dt-view-module__label">Module</p>
		<p v-if="readOnlyReason" class="dt-view-module__readonly" data-readonly>
			<strong>{{ module ?? '—' }}</strong> — {{ readOnlyReason }}
		</p>
		<!-- a short list, not a dropdown: every module is in view, a locked one with its reason on the row -->
		<fieldset v-else class="dt-view-module__choices" role="radiogroup" aria-label="Module">
			<label
				v-for="t in targets"
				:key="t.id ?? ''"
				class="dt-view-module__choice"
				:class="{ on: t.id === module, locked: t.locked }"
				:data-module="t.id ?? ''"
				:title="t.reason"
			>
				<input type="radio" name="dt-view-module" :checked="t.id === module" :disabled="t.locked || busy" @change="pick(t.id)" />
				<DtIcon v-if="t.locked" name="lock" />
				<span>{{ t.label }}</span>
				<span class="dt-view-module__hint">{{ t.locked ? t.reason : t.hint }}</span>
			</label>
		</fieldset>
		<p v-if="busy" class="dt-view-module__status">Moving…</p>
		<div v-if="answer" class="dt-view-module__answer" :class="answer.tone === 'error' ? 'is-error' : 'is-ok'" :role="answer.tone === 'error' ? 'alert' : 'status'" data-move-answer>
			<p class="dt-view-module__sentence">{{ answer.sentence }}</p>
			<p v-if="answer.detail" class="dt-view-module__detail">{{ answer.detail }}</p>
			<p v-if="answer.next" class="dt-view-module__next">{{ answer.next.label }}</p>
		</div>
	</section>
</template>

<style scoped>
.dt-view-module {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-1);
	max-width: 420px;
	margin-top: var(--dt-space-4);
}
.dt-view-module__label {
	margin: 0;
	font-size: var(--dt-label);
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
}
.dt-view-module__readonly,
.dt-view-module__status,
.dt-view-module__sentence,
.dt-view-module__detail,
.dt-view-module__next {
	margin: 0;
	font-size: var(--dt-text);
}
.dt-view-module__detail {
	white-space: pre-wrap;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-view-module__choices {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
	padding: 0;
	border: none;
}
.dt-view-module__choice {
	display: grid;
	grid-template-columns: auto auto 1fr;
	align-items: center;
	gap: 6px;
	padding: 2px 4px;
	border-radius: 3px;
	font-size: var(--dt-text);
	cursor: pointer;
}
.dt-view-module__choice.on {
	background: var(--dt-bg-active);
}
.dt-view-module__choice.locked {
	opacity: 0.6;
	cursor: default;
}
.dt-view-module__hint {
	grid-column: 2 / -1;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-view-module__answer {
	padding-left: var(--dt-space-2);
	border-left: 3px solid var(--dt-success);
}
.dt-view-module__answer.is-error {
	border-left-color: var(--dt-danger);
}
.dt-view-module__answer.is-error .dt-view-module__sentence {
	color: var(--dt-danger);
}
</style>
