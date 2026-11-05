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
import ViewModuleSelect from './ViewModuleSelect.vue';
import type { SaveAnswer } from '../lib/save-answer';
import type { ViewModuleTarget } from '../lib/view-module-targets';

const props = defineProps<{
	/** The module the view is compiled from now (`$module` on the record). */
	module: string | undefined;
	/** Every module — the npm-installed ones are not offered, and said once (ViewModuleSelect). */
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
		<template v-if="readOnlyReason">
			<p class="dt-view-module__label">Module</p>
			<p class="dt-view-module__readonly" data-readonly>
				<strong>{{ module ?? '—' }}</strong> — {{ readOnlyReason }}
			</p>
		</template>
		<!-- one dropdown, not a list (cr-vscode-010): a list of every module, a path under each, ran past the page -->
		<ViewModuleSelect v-else :model-value="module ?? null" :targets="targets" :disabled="busy" @update:model-value="pick" />
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
