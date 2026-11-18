<!--
	Icon chooser with live previews (operator 2026-07-27: "give me a nice selector with icon
	previews"). Replaces the free-text "Icon (e.g. view_kanban)" input, which required knowing
	Material Symbol names by heart and gave no feedback until the record was saved.

	The whole font is already bundled, so every one of its ~3900 names is renderable; the grid
	shows a curated shortlist up front and searches the full set, capping results so typing a
	single letter never tries to paint three thousand glyphs.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ALL_ICONS, COMMON_ICONS } from '../lib/icon-names';
import DtIcon from './DtIcon.vue';

const model = defineModel<string>({ default: '' });
withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: 'Pick an icon' });

const open = ref(false);
const query = ref('');
const searchEl = ref<HTMLInputElement | null>(null);

const MAX = 240;

const results = computed(() => {
	const q = query.value.trim().toLowerCase().replace(/[\s-]+/g, '_');
	if (!q) return COMMON_ICONS;
	// prefix matches first — typing "cal" should lead with `calendar_month`, not `local_cafe`
	const starts: string[] = [];
	const contains: string[] = [];
	for (const name of ALL_ICONS) {
		if (name.startsWith(q)) starts.push(name);
		else if (name.includes(q)) contains.push(name);
		if (starts.length >= MAX) break;
	}
	return [...starts, ...contains].slice(0, MAX);
});

const truncated = computed(() => query.value.trim() !== '' && results.value.length >= MAX);

async function toggle(): Promise<void> {
	open.value = !open.value;
	if (open.value) {
		query.value = '';
		await nextTick();
		searchEl.value?.focus();
	}
}

function choose(name: string): void {
	model.value = model.value === name ? '' : name;
	open.value = false;
}

// close on Escape from anywhere inside
watch(open, (isOpen) => {
	if (!isOpen) query.value = '';
});
</script>

<template>
	<div class="dt-iconpick">
		<button type="button" class="dt-iconpick-trigger" :title="model || placeholder" @click="toggle">
			<DtIcon v-if="model"  class="dt-iconpick-glyph" :name="model" />
			<DtIcon v-else  class="dt-iconpick-glyph dt-iconpick-glyph--empty" name="symbol-color" />
			<span class="dt-iconpick-name" :class="{ empty: !model }">{{ model || placeholder }}</span>
			<button
				v-if="model"
				type="button"
				class="dt-iconpick-clear"
				title="Clear icon"
				@click.stop="model = ''"
			>
				<DtIcon name="close" />
			</button>
			<DtIcon class="dt-iconpick-caret" :name="open ? 'chevron-up' : 'chevron-down'" />
		</button>

		<div v-if="open" class="dt-iconpick-pop" @keydown.esc.stop="open = false">
			<input
				ref="searchEl"
				v-model="query"
				class="dt-iconpick-search"
				type="text"
				placeholder="Search 3,895 icons…"
				spellcheck="false"
			/>
			<div class="dt-iconpick-grid">
				<button
					v-for="name in results"
					:key="name"
					type="button"
					class="dt-iconpick-cell"
					:class="{ active: name === model }"
					:title="name"
					@click="choose(name)"
				>
					<DtIcon :name="name" />
				</button>
			</div>
			<p v-if="!results.length" class="dt-iconpick-note">No icon matches “{{ query }}”</p>
			<p v-else-if="truncated" class="dt-iconpick-note">First {{ MAX }} matches — keep typing to narrow</p>
			<p v-else-if="!query" class="dt-iconpick-note">Common icons — type to search all 3,895</p>
		</div>
	</div>
</template>

<style scoped>
.dt-iconpick {
	position: relative;
	margin-bottom: 6px;
}

.dt-iconpick-trigger {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	height: 26px;
	padding: 0 4px 0 6px;
	border: 1px solid var(--vscode-dropdown-border, var(--dt-border));
	border-radius: 2px;
	background: var(--vscode-dropdown-background, var(--dt-bg-subtle));
	color: var(--dt-fg);
	font-family: inherit;
	font-size: var(--dt-text);
	cursor: pointer;
	text-align: left;
}
.dt-iconpick-trigger:hover {
	border-color: var(--vscode-focusBorder, var(--dt-border-strong));
}

.dt-iconpick-glyph {
	font-size: var(--dt-icon);
	flex-shrink: 0;
	color: var(--dt-fg);
}
.dt-iconpick-glyph--empty {
	color: var(--dt-fg-muted);
}

.dt-iconpick-name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.dt-iconpick-name.empty {
	color: var(--dt-fg-muted);
}

.dt-iconpick-clear,
.dt-iconpick-caret {
	flex-shrink: 0;
	color: var(--dt-fg-subtle);
}
.dt-iconpick-clear {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	border: none;
	border-radius: 3px;
	background: transparent;
	cursor: pointer;
	padding: 0;
}
.dt-iconpick-clear:hover {
	background: var(--dt-bg-active);
	color: var(--dt-fg);
}
.dt-iconpick-clear .codicon,
.dt-iconpick-caret {
	font-size: var(--dt-text);
}

.dt-iconpick-pop {
	margin-top: 4px;
	border: 1px solid var(--vscode-dropdown-border, var(--dt-border));
	border-radius: var(--dt-radius);
	background: var(--vscode-dropdown-background, var(--dt-bg-subtle));
	padding: 6px;
}

.dt-iconpick-search {
	width: 100%;
	height: 24px;
	margin-bottom: 6px;
	padding: 0 6px;
	border: 1px solid var(--vscode-input-border, var(--dt-border));
	border-radius: 2px;
	background: var(--vscode-input-background, var(--dt-bg));
	color: var(--vscode-input-foreground, var(--dt-fg));
	font-family: inherit;
	font-size: var(--dt-text);
}
.dt-iconpick-search:focus {
	outline: 1px solid var(--vscode-focusBorder, var(--dt-accent));
	outline-offset: -1px;
}

.dt-iconpick-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
	gap: 2px;
	max-height: 200px;
	overflow-y: auto;
}

.dt-iconpick-cell {
	display: flex;
	align-items: center;
	justify-content: center;
	aspect-ratio: 1;
	border: none;
	border-radius: 3px;
	background: transparent;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	padding: 0;
}
.dt-iconpick-cell:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
.dt-iconpick-cell.active {
	background: var(--vscode-list-activeSelectionBackground, var(--dt-bg-active));
	color: var(--vscode-list-activeSelectionForeground, var(--dt-fg));
	outline: 1px solid var(--vscode-focusBorder, var(--dt-accent));
	outline-offset: -1px;
}
.dt-iconpick-cell .codicon {
	font-size: var(--dt-icon);
}

.dt-iconpick-note {
	margin: 6px 0 0;
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}
</style>
