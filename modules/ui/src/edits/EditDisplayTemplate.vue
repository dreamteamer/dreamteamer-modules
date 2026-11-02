<!--
	Display-template editor (operator 2026-07-29: "template - should be a markdown editor?", then
	"why not allow the user to render a markdown template for each card?").

	A template IS markdown now — `DisplayTemplate` runs it through the markdown renderer while each
	`{{ field }}` keeps its own View — so this editor can honestly offer markdown. It is a plain
	monospace text area rather than a rich editor: the output is one to four lines with `**` and `·`
	in it, WYSIWYG chrome would outweigh the content, and the live preview that would justify a rich
	editor needs a record to interpolate (the board itself is that preview — every card updates as
	you type).

	The part that was genuinely missing is the same thing the group-by dropdown was missing: you had
	to already know the field names. Hence the vocabulary as one-click tokens, inserted at the caret.
	Multi-line because a card is not a table cell, and a line break in a card template IS a line
	break (DisplayTemplate normalizes for that).

	Registered as `display-template`. It reads the ambient field context (lib/field-context.ts) for
	the token list; with no context it is simply a textarea, which is exactly the old behavior.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldRow } from '../api/types';
import { templateFields } from '../lib/template';
import { selectableFields, useFieldContext } from '../lib/field-context';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const context = useFieldContext();
const area = ref<HTMLTextAreaElement | null>(null);

const text = computed(() => (props.value == null ? '' : String(props.value)));

/** Field names already referenced, so the chips can show what is in play at a glance. */
const used = computed(() => new Set(templateFields(text.value)));

const candidates = computed<FieldRow[]>(() =>
	context ? selectableFields(context.fields.value, props.field.editor_options) : [],
);

function onInput(event: Event): void {
	const next = (event.target as HTMLTextAreaElement).value;
	emit('update:value', next === '' ? null : next);
}

/**
 * Insert `{{ name }}` at the caret (replacing any selection), then put the caret after it — the
 * point of a token button is to keep typing prose around it. Falls back to appending when the
 * textarea isn't focused/mounted.
 */
function insert(name: string): void {
	const token = `{{ ${name} }}`;
	const el = area.value;
	const current = text.value;
	if (!el) {
		emit('update:value', current + token);
		return;
	}
	const start = el.selectionStart ?? current.length;
	const end = el.selectionEnd ?? start;
	const next = current.slice(0, start) + token + current.slice(end);
	emit('update:value', next);
	// The value round-trips through the parent, so move the caret after Vue has patched the DOM.
	const caret = start + token.length;
	requestAnimationFrame(() => {
		el.focus();
		el.setSelectionRange(caret, caret);
	});
}
</script>

<template>
	<div class="dt-tpl">
		<textarea
			ref="area"
			class="dt-textarea dt-tpl-input"
			rows="3"
			spellcheck="false"
			:value="text"
			:autofocus="autofocus"
			placeholder="**{{ name }}**&#10;{{ status }} · {{ due }}"
			@input="onInput"
		></textarea>
		<p class="dt-tpl-hint">Markdown — <code>**bold**</code>, <code>- lists</code>, <code>#&nbsp;heading</code>.</p>

		<!-- ⚠ COLLAPSED BY DEFAULT since 0.13.0. Every visible field became a chip, unfiltered, so on a
		     wide collection this wrapped to five or six rows — around 200px, roughly half the OPTIONS
		     block and a quarter of the whole 320px panel — to teach a vocabulary you need once, for
		     thirty seconds. It was the largest thing on the panel and the least consequential. Behind
		     a disclosure it costs one click and gives the space back to the settings.
		     The summary still names the count, so the affordance is not hidden, only folded. -->
		<details v-if="candidates.length" class="dt-tpl-fields">
			<summary class="dt-tpl-hint">Insert a field <span class="dt-tpl-count">{{ candidates.length }}</span></summary>
			<div class="dt-tpl-tokens">
				<button
					v-for="row in candidates"
					:key="row.field"
					type="button"
					class="dt-tpl-token"
					:class="{ 'is-used': used.has(row.field) }"
					:title="`Insert {{ ${row.field} }}`"
					@click="insert(row.field)"
				>
					{{ row.field }}
				</button>
			</div>
		</details>
	</div>
</template>

<style scoped>
.dt-tpl-fields > summary {
	cursor: pointer;
	list-style: none;
	user-select: none;
}
.dt-tpl-fields > summary::-webkit-details-marker {
	display: none;
}
.dt-tpl-fields > summary::before {
	content: '\25B8';
	display: inline-block;
	width: 10px;
	transition: transform 0.12s ease;
}
.dt-tpl-fields[open] > summary::before {
	transform: rotate(90deg);
}
.dt-tpl-fields > summary:focus-visible {
	outline: 1px solid var(--dt-focus-ring);
	outline-offset: 2px;
}
.dt-tpl-fields[open] .dt-tpl-tokens {
	margin-top: var(--dt-space-2);
}
.dt-tpl-count {
	color: var(--dt-fg-muted);
}
@media (prefers-reduced-motion: reduce) {
	.dt-tpl-fields > summary::before {
		transition: none;
	}
}

.dt-tpl {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-tpl-input {
	height: auto;
	min-height: calc(var(--dt-input-height) * 1.6);
	font-family: var(--vscode-editor-font-family, monospace);
	line-height: 1.5;
	resize: vertical;
}
.dt-tpl-hint {
	margin: -2px 0 0;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-tpl-hint code {
	font-family: var(--vscode-editor-font-family, monospace);
	color: var(--dt-fg);
}
.dt-tpl-tokens {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}
/* Chips, not buttons-with-chrome: this is a vocabulary list you click, and it sits under a control
   in a narrow rail. `is-used` marks what the template already references. */
.dt-tpl-token {
	padding: 1px 8px;
	border: 1px solid var(--dt-border);
	border-radius: 999px;
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	font-family: var(--vscode-editor-font-family, monospace);
	cursor: pointer;
}
.dt-tpl-token:hover {
	color: var(--dt-fg);
	border-color: var(--dt-accent);
}
.dt-tpl-token.is-used {
	color: var(--dt-fg);
	border-color: var(--dt-accent);
	background: color-mix(in srgb, var(--dt-accent) 14%, var(--dt-bg-subtle));
}
</style>
