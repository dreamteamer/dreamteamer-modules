<!--
	Markdown body Edit (`markdown-body`): a CodeMirror 6 EditorView with Obsidian-style live
	preview (ported from the archived dreamteamer-studio prototype's editor.js/editor-preview.js,
	Preact → Vue). Contract: dumb controlled text control — body content stays source-canonical
	markdown; decorations (lib/editor-preview.ts) are purely visual, reveal-on-cursor.

	Two modes, one document: **live preview** (default — markers hide, reveal on cursor) and
	**source** (raw markdown, no decorations). The toggle swaps the livePreview() extension via a
	Compartment, so switching never remounts the editor or loses undo history. The formatting
	toolbar (lib/editor-commands.ts, Directus-style button set) edits the source text directly and
	works identically in both modes; Mod-b/Mod-i/Mod-k are bound to bold/italic/link.

	Theme colors reference `var(--dt-*)` tokens directly in the CM6 theme (CSS resolves them
	live), so no getComputedStyle snapshot / MutationObserver reconfigure dance is needed here.

	The `value`-prop watcher is echo-guarded (lib/editor-guard.ts): every keystroke round-trips
	out via `update:value` and back in via `value`; only a text this editor never emitted itself
	(external refetch, cancel/revert) resets the doc.
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { FieldRow } from '../api/types';
import { livePreview } from '../lib/editor-preview';
import { pushEmitted, shouldReset } from '../lib/editor-guard';
import { insertLink, setHeading, toggleFence, toggleInline, toggleLinePrefix } from '../lib/editor-commands';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
// Ring of the last few doc texts THIS editor itself emitted, updated synchronously inside the
// CM6 update listener (never via Vue state — async round-trips are exactly what race under
// rapid keystrokes). Read by the value watcher's echo guard below.
let recentEmitted: string[] = [];

// Live preview ↔ source toggle. Sticky across records/sessions: an operator who prefers raw
// markdown shouldn't have to re-toggle on every field.
const SOURCE_MODE_KEY = 'dt.studio.mdSource';
const sourceMode = ref(localStorage.getItem(SOURCE_MODE_KEY) === '1');
const previewCompartment = new Compartment();

function setSourceMode(on: boolean): void {
	sourceMode.value = on;
	localStorage.setItem(SOURCE_MODE_KEY, on ? '1' : '0');
	view?.dispatch({ effects: previewCompartment.reconfigure(on ? [] : livePreview()) });
	view?.focus();
}

const theme = EditorView.theme({
	'&': { backgroundColor: 'transparent', color: 'var(--dt-fg)', fontSize: '13px' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'var(--dt-font-mono)', lineHeight: '1.6', minHeight: '260px' },
	'.cm-content': { padding: '14px', caretColor: 'var(--dt-accent)' },
	'.cm-gutters': { display: 'none' },
	'.cm-selectionBackground, ::selection': { backgroundColor: 'var(--dt-accent-subtle) !important' },
	'&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--dt-accent-subtle) !important' },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dt-accent)' },
});

// Toolbar model (Directus-style set): headings, inline marks, link, lists, quote, fence.
type ToolButton = { icon: string; title: string; run: (v: EditorView) => unknown };
const TOOLBAR: (ToolButton | 'gap')[] = [
	{ icon: 'format_h1', title: 'Heading 1', run: (v) => setHeading(v, 1) },
	{ icon: 'format_h2', title: 'Heading 2', run: (v) => setHeading(v, 2) },
	{ icon: 'format_h3', title: 'Heading 3', run: (v) => setHeading(v, 3) },
	'gap',
	{ icon: 'format_bold', title: 'Bold (⌘B)', run: (v) => toggleInline(v, '**') },
	{ icon: 'format_italic', title: 'Italic (⌘I)', run: (v) => toggleInline(v, '*') },
	{ icon: 'strikethrough_s', title: 'Strikethrough', run: (v) => toggleInline(v, '~~') },
	{ icon: 'code', title: 'Inline code', run: (v) => toggleInline(v, '`') },
	'gap',
	{ icon: 'link', title: 'Link (⌘K)', run: (v) => insertLink(v) },
	'gap',
	{ icon: 'format_list_bulleted', title: 'Bullet list', run: (v) => toggleLinePrefix(v, 'bullet') },
	{ icon: 'format_list_numbered', title: 'Numbered list', run: (v) => toggleLinePrefix(v, 'ordered') },
	{ icon: 'checklist', title: 'Task list', run: (v) => toggleLinePrefix(v, 'task') },
	{ icon: 'format_quote', title: 'Quote', run: (v) => toggleLinePrefix(v, 'quote') },
	{ icon: 'data_object', title: 'Code block', run: (v) => toggleFence(v) },
];

function runTool(tool: ToolButton): void {
	if (view) tool.run(view);
}

onMounted(() => {
	const state = EditorState.create({
		doc: props.value == null ? '' : String(props.value),
		extensions: [
			history(),
			keymap.of([
				{ key: 'Mod-b', run: (v) => toggleInline(v, '**') },
				{ key: 'Mod-i', run: (v) => toggleInline(v, '*') },
				{ key: 'Mod-k', run: (v) => insertLink(v) },
				...defaultKeymap,
				...historyKeymap,
			]),
			// `base: markdownLanguage` (GFM, not bare CommonMark) is required for the
			// Task/Strikethrough/Table nodes the live-preview decorations key off of — plain
			// `markdown()` never produces a `Task` node for `- [ ]`, silently breaking checkboxes.
			markdown({ base: markdownLanguage }),
			EditorView.lineWrapping,
			theme,
			previewCompartment.of(sourceMode.value ? [] : livePreview()),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const text = update.state.doc.toString();
					// Synchronous with this same dispatch — never lags a same-tick keystroke.
					recentEmitted = pushEmitted(recentEmitted, text);
					emit('update:value', text);
				}
			}),
		],
	});
	view = new EditorView({ state, parent: host.value as HTMLElement });
	if (props.autofocus) view.focus();
});

onBeforeUnmount(() => {
	view?.destroy();
	view = null;
});

watch(
	() => props.value,
	(value) => {
		if (!view || value === undefined) return;
		const incoming = value == null ? '' : String(value);
		const current = view.state.doc.toString();
		if (shouldReset(incoming, current, recentEmitted)) {
			view.dispatch({ changes: { from: 0, to: current.length, insert: incoming } });
		}
	},
);
</script>

<template>
	<div class="dt-markdown">
		<div class="dt-markdown-toolbar">
			<template v-for="(tool, index) in TOOLBAR" :key="index">
				<span v-if="tool === 'gap'" class="dt-markdown-toolbar__gap"></span>
				<!-- mousedown.prevent keeps the editor's selection/focus alive through the click -->
				<button
					v-else
					type="button"
					class="dt-markdown-toolbar__btn"
					:title="tool.title"
					tabindex="-1"
					@mousedown.prevent
					@click="runTool(tool)"
				>
					<DtIcon :name="tool.icon" />
				</button>
			</template>
			<span class="dt-markdown-toolbar__spacer"></span>
			<button
				type="button"
				class="dt-markdown-toolbar__btn"
				:class="{ 'is-active': sourceMode }"
				:title="sourceMode ? 'Switch to live preview' : 'Switch to source (raw markdown)'"
				tabindex="-1"
				@mousedown.prevent
				@click="setSourceMode(!sourceMode)"
			>
				<DtIcon :name="sourceMode ? 'preview' : 'code_blocks'" />
			</button>
		</div>
		<div ref="host" class="dt-markdown-editor"></div>
	</div>
</template>

<style scoped>
.dt-markdown {
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	transition:
		background-color 0.12s ease,
		border-color 0.12s ease;
}
.dt-markdown:focus-within {
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}
.dt-markdown-toolbar {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 4px 6px;
	border-bottom: 1px solid var(--dt-border);
	flex-wrap: wrap;
}
.dt-markdown-toolbar__btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	border: none;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg-subtle);
	cursor: pointer;
}
.dt-markdown-toolbar__btn:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
.dt-markdown-toolbar__btn.is-active {
	background: var(--dt-accent-subtle);
	color: var(--dt-accent);
}
.dt-markdown-toolbar__btn .codicon {
	font-size: var(--dt-icon);
}
.dt-markdown-toolbar__gap {
	width: 8px;
}
.dt-markdown-toolbar__spacer {
	flex: 1;
}
</style>
