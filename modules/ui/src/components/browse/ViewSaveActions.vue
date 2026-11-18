<!--
	The layout drawer's SAVE actions — Save, Save as…, discard — and everything they answer, in ONE
	place: the drawer's title bar, where the buttons are.

	⚠ WHY THIS IS ITS OWN COMPONENT (operator 2026-10-31: "most save and save as operations on ui views
	fail with non intuitive UI (op btn on top, error below the scroll on bottom)"). The buttons were
	teleported into the 35px title bar while the Save as… form and the status line that reported the
	result rendered in a section at the BOTTOM of the drawer — below the fold on any collection with a
	few layout options, so a refusal was a paragraph nobody saw. Now the form and the answer drop down
	from the title bar itself, anchored to the buttons: the title bar never scrolls, so the answer is in
	view by construction, and `scrollIntoView` covers a drawer narrower than the callout.

	It holds no write logic: the parent saves and hands back a `SaveAnswer` (`lib/save-answer.ts`) —
	the engine's sentence verbatim and the one next action it implies.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import DtIcon from '../DtIcon.vue';
import IconPicker from '../IconPicker.vue';
import ViewModuleSelect from '../ViewModuleSelect.vue';
import { slugify } from '../../lib/slugify';
import type { NextAction, SaveAnswer } from '../../lib/save-answer';
import type { ViewModuleTarget } from '../../lib/view-module-targets';

const props = defineProps<{
	dirty: boolean;
	saving: boolean;
	/** The Save button's tooltip: where a plain Save writes (the view record, or the collection). */
	saveTitle: string;
	/** The last save's answer, and which button it answers — drawn beside THAT button. */
	answer: SaveAnswer | null;
	answerFor: 'save' | 'save-as' | null;
	formOpen: boolean;
	busy: boolean;
	collection: string;
	targets: ViewModuleTarget[];
}>();

const emit = defineEmits<{
	save: [];
	'open-form': [];
	'cancel-form': [];
	reset: [];
	dismiss: [];
	confirm: [value: { name: string; icon: string; module: string | null }];
	next: [action: NextAction];
}>();

const name = ref('');
const icon = ref('');
/** The picked module's `?module=` value; `null` is the workspace module, the default. */
const module = ref<string | null>(null);
const slug = computed(() => slugify(name.value));

watch(() => props.formOpen, (open) => {
	if (!open) return;
	name.value = '';
	icon.value = '';
	module.value = null;
});

function confirm(): void {
	if (!slug.value || props.busy) return;
	emit('confirm', { name: name.value.trim(), icon: icon.value.trim(), module: module.value });
}

const answerEl = ref<{ scrollIntoView?: (o?: unknown) => void } | null>(null);
watch(() => props.answer, async (a) => {
	if (!a) return;
	await nextTick();
	// the render tier has no layout: a node without the method is simply not scrolled
	answerEl.value?.scrollIntoView?.({ block: 'nearest' });
});
</script>

<template>
	<div class="dt-vsa" data-view-save-actions>
		<span v-if="dirty" class="dt-lo-dirty" title="Unsaved changes to this view">&#9679;</span>
		<button
			type="button"
			class="dt-lo-hdr-btn"
			data-action="save"
			:class="{ strong: dirty }"
			:disabled="!dirty || saving"
			:title="saveTitle"
			@click="emit('save')"
		>
			<DtIcon name="save" />
			{{ saving ? 'Saving…' : 'Save' }}
		</button>
		<button type="button" class="dt-lo-hdr-btn" data-action="save-as" title="Save as a new named view" @click="emit('open-form')">
			<DtIcon name="bookmark" />
			Save as…
		</button>
		<button type="button" class="dt-lo-hdr-btn" data-action="reset" :disabled="!dirty" title="Discard unsaved changes" @click="emit('reset')">
			<DtIcon name="discard" />
		</button>

		<!-- The form and the answer, anchored under the buttons. `data-anchor` names the button the
		     callout answers, so a test (and a reader) can tell which press it belongs to. -->
		<div v-if="formOpen || answer" class="dt-vsa__pop" :data-anchor="formOpen ? 'save-as' : answerFor ?? undefined">
			<form v-if="formOpen" class="dt-vsa__form" data-save-as-form @submit.prevent="confirm">
				<p class="dt-vsa__title">Save as a new view</p>
				<input :value="name" class="dt-input" type="text" placeholder="View name…" aria-label="View name" autofocus @input="name = ($event.target as HTMLInputElement).value" />
				<IconPicker v-model="icon" placeholder="Icon (optional)" />
				<ViewModuleSelect v-model="module" :targets="targets" />
				<p class="dt-vsa__hint">
					Appears under <strong>{{ collection }}</strong> in the sidebar<span v-if="slug">, id <code>{{ slug }}</code></span>
				</p>
				<div class="dt-vsa__row">
					<button type="submit" class="dt-btn dt-btn--sm" data-action="confirm" :disabled="!slug || busy">{{ busy ? 'Saving…' : 'Save' }}</button>
					<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm" @click="emit('cancel-form')">Cancel</button>
				</div>
			</form>

			<div
				v-if="answer"
				ref="answerEl"
				class="dt-vsa__answer"
				:class="answer.tone === 'error' ? 'is-error' : 'is-ok'"
				:role="answer.tone === 'error' ? 'alert' : 'status'"
				data-save-answer
			>
				<p class="dt-vsa__sentence">{{ answer.sentence }}</p>
				<pre v-if="answer.detail" class="dt-vsa__detail">{{ answer.detail }}</pre>
				<div class="dt-vsa__row">
					<button v-if="answer.next && answer.next.action" type="button" class="dt-btn dt-btn--sm" data-action="next" @click="emit('next', answer.next.action)">
						{{ answer.next.label }}
					</button>
					<span v-else-if="answer.next" class="dt-vsa__next" data-next>{{ answer.next.label }}</span>
					<button type="button" class="dt-vsa__dismiss" title="Dismiss" data-action="dismiss" @click="emit('dismiss')">
						<DtIcon name="close" />
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* ---- the title-bar buttons (moved here from LayoutOptionsSection with them) ---- */
.dt-lo-hdr-btn {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 22px;
	padding: 0 8px;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--dt-fg-subtle);
	font-family: inherit;
	font-size: var(--dt-label);
	cursor: pointer;
	white-space: nowrap;
}
.dt-lo-hdr-btn:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
.dt-lo-hdr-btn .codicon {
	font-size: var(--dt-text);
}

.dt-lo-hdr-btn:disabled {
	opacity: 0.4;
	cursor: default;
}
.dt-lo-hdr-btn.strong {
	color: var(--dt-fg);
}
.dt-lo-dirty {
	color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--dt-warning));
	font-size: 9px;
	line-height: 1;
}

.dt-vsa {
	position: relative;
	display: flex;
	align-items: center;
	gap: 4px;
}
.dt-vsa__pop {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 10;
	width: 300px;
	max-width: calc(100vw - 48px);
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-2);
	padding: var(--dt-space-3);
	border: 1px solid var(--dt-border);
	border-radius: 4px;
	background: var(--dt-bg);
	box-shadow: var(--dt-shadow-lg);
}
.dt-vsa__form {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-2);
}
.dt-vsa__title {
	margin: 0;
	padding: 0;
	font-size: var(--dt-label);
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
}
.dt-vsa__hint {
	margin: 0;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-vsa__row {
	display: flex;
	align-items: center;
	gap: var(--dt-space-2);
}
.dt-vsa__answer {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-1);
	padding-left: var(--dt-space-2);
	border-left: 3px solid var(--dt-success);
}
.dt-vsa__answer.is-error {
	border-left-color: var(--dt-danger);
}
.dt-vsa__sentence {
	margin: 0;
	font-size: var(--dt-text);
	color: var(--dt-fg);
}
.dt-vsa__answer.is-error .dt-vsa__sentence {
	color: var(--dt-danger);
}
.dt-vsa__detail {
	margin: 0;
	white-space: pre-wrap;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-vsa__next {
	font-size: var(--dt-text);
	color: var(--dt-fg);
}
.dt-vsa__dismiss {
	margin-left: auto;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border: none;
	border-radius: 3px;
	background: transparent;
	color: var(--dt-fg-subtle);
	cursor: pointer;
}
.dt-vsa__dismiss:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
</style>
