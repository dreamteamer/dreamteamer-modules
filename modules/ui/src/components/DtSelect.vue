<!--
	The app's dropdown. One component, replacing every native `<select>`.

	A native `<select>` cannot be searched, cannot be styled to match the surface around it, and
	renders an OS menu that ignores the editor theme entirely. On the vocabularies this app actually
	has — an analyte enum of ~100 values, a collection list, 3,895 icon names — it is a scrolling wall
	you hunt through. So: a button, a panel, a search box above the threshold, and full keyboard
	control.

	⚠ The panel is `position: fixed`, positioned from the control's rect. That is not a style choice.
	An absolutely positioned panel is CLIPPED by any scrolling ancestor, and this app puts dropdowns
	inside exactly that — `.dt-browse-filter-panel` is `overflow-y: auto`, which cost a whole
	debugging pass when the field picker's list came up as a sliver. Fixed positions against the
	viewport and escapes ancestor overflow WITHOUT a teleport, so the panel stays in its own
	component's DOM (FilterFieldPicker's header records why teleporting is refused here). The price is
	that the position must be recomputed while anything scrolls — hence the capture-phase scroll
	listener. Fixed is defeated by an ancestor with `transform`/`filter`/`will-change`; this app has
	none on a container, and if one ever appears the symptom is a panel stuck at the page origin.
-->
<script setup lang="ts">
import { themeColor } from '../lib/collection-display';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import DtIcon from './DtIcon.vue';
import {
	SEARCH_THRESHOLD, filterChoices, indexOfValue, moveActive, placePanel, sameValue, type Choice,
} from '../lib/listbox';

const props = withDefaults(defineProps<{
	modelValue: unknown;
	choices: Choice[];
	placeholder?: string;
	disabled?: boolean;
	autofocus?: boolean;
	/** Forces the search box on or off; omitted, it appears above SEARCH_THRESHOLD choices. */
	searchable?: boolean;
	ariaLabel?: string;
	// ⚠ `searchable: undefined` is LOAD-BEARING, not noise. A prop declared `boolean` with no default
	// gets Vue's BOOLEAN CASTING: absent means `false`, never `undefined` — so `props.searchable ??
	// (count > THRESHOLD)` below could never reach its right-hand side, and the search box has never
	// once rendered, on any dropdown, since DtSelect replaced the native <select>. Measured in a real
	// Extension Development Host: an operator list of 12 and a derived vocabulary of 15, both with no
	// search input in the panel. Declaring a default — even `undefined` — is what disables the cast.
}>(), { placeholder: '—', searchable: undefined });

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();

const open = ref(false);
const query = ref('');
const active = ref(-1);
const controlEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const style = ref<Record<string, string>>({});

const visible = computed(() => filterChoices(props.choices, query.value));
const showSearch = computed(() => props.searchable ?? props.choices.length > SEARCH_THRESHOLD);
const selected = computed(() => props.choices.find((c) => sameValue(c.value, props.modelValue)));
const label = computed(() => selected.value?.text ?? (props.modelValue == null || props.modelValue === '' ? props.placeholder : String(props.modelValue)));
const isPlaceholder = computed(() => !selected.value && (props.modelValue == null || props.modelValue === ''));

function reposition(): void {
	const el = controlEl.value;
	if (!el) return;
	const r = el.getBoundingClientRect();
	const p = placePanel(
		{ top: r.top, bottom: r.bottom, left: r.left, width: r.width },
		{ width: window.innerWidth, height: window.innerHeight },
		320,
		{ minWidth: 200 },
	);
	style.value = {
		top: `${p.top}px`,
		left: `${p.left}px`,
		width: `${p.width}px`,
		maxHeight: `${p.maxHeight}px`,
	};
}

function openPanel(): void {
	if (props.disabled) return;
	open.value = true;
	query.value = '';
	active.value = indexOfValue(visible.value, props.modelValue);
	void nextTick(() => {
		reposition();
		if (showSearch.value) searchEl.value?.focus();
		scrollActiveIntoView();
	});
}

function close(): void {
	open.value = false;
	query.value = '';
	active.value = -1;
}

function toggle(): void {
	open.value ? close() : openPanel();
}

function choose(choice: Choice): void {
	emit('update:modelValue', choice.value);
	close();
	void nextTick(() => controlEl.value?.focus());
}

function scrollActiveIntoView(): void {
	const el = panelEl.value?.querySelector<HTMLElement>('.dt-dd__option.is-active');
	el?.scrollIntoView({ block: 'nearest' });
}

function onKeydown(event: KeyboardEvent): void {
	if (!open.value) {
		// A closed control opens on the keys that mean "show me the options".
		if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
			event.preventDefault();
			openPanel();
		}
		return;
	}
	switch (event.key) {
		case 'Escape':
			// Stop it here: the filter panel behind this one also closes on Escape, and one keypress
			// closing two layers means you can never dismiss just the dropdown.
			event.stopPropagation();
			event.preventDefault();
			close();
			controlEl.value?.focus();
			break;
		case 'ArrowDown':
		case 'ArrowUp':
			event.preventDefault();
			active.value = moveActive(active.value, event.key === 'ArrowDown' ? 1 : -1, visible.value.length);
			void nextTick(scrollActiveIntoView);
			break;
		case 'Home':
		case 'End':
			event.preventDefault();
			active.value = event.key === 'Home' ? 0 : visible.value.length - 1;
			void nextTick(scrollActiveIntoView);
			break;
		case 'Enter': {
			event.preventDefault();
			const pick = visible.value[active.value] ?? (visible.value.length === 1 ? visible.value[0] : undefined);
			if (pick) choose(pick);
			break;
		}
		case 'Tab':
			close();
			break;
	}
}

function onDocumentMousedown(event: MouseEvent): void {
	const t = event.target as Node;
	if (controlEl.value?.contains(t) || panelEl.value?.contains(t)) return;
	close();
}

// ⚠ CAPTURE phase, and `true` for scroll: a scroll event does not bubble from the element that
// scrolled, so a listener on `window` alone never fires for an inner scroll container — and the
// filter panel is one. Without capture the panel detaches from its control the moment you scroll it.
watch(open, (isOpen) => {
	const method = isOpen ? 'addEventListener' : 'removeEventListener';
	document[method]('mousedown', onDocumentMousedown as EventListener);
	window[method]('scroll', reposition, true);
	window[method]('resize', reposition);
});
onUnmounted(() => {
	document.removeEventListener('mousedown', onDocumentMousedown as EventListener);
	window.removeEventListener('scroll', reposition, true);
	window.removeEventListener('resize', reposition);
});

// The active row follows the filtered list: after typing, "first match" is the useful default, and a
// stale index would have Enter commit a value that is no longer on screen.
watch(query, () => { active.value = visible.value.length ? 0 : -1; });
</script>

<template>
	<div class="dt-dd">
		<button
			ref="controlEl"
			type="button"
			class="dt-select dt-dd__control"
			:class="{ 'is-open': open, 'is-placeholder': isPlaceholder }"
			:disabled="disabled"
			:autofocus="autofocus"
			:aria-label="ariaLabel"
			:title="selected?.title"
			:aria-expanded="open"
			aria-haspopup="listbox"
			role="combobox"
			@click="toggle"
			@keydown="onKeydown"
		>
			<DtIcon
				v-if="selected?.icon"
				class="dt-dd__option-icon"
				:name="selected.icon"
				:style="selected.color ? { color: themeColor(selected.color) } : undefined"
			/>
			<span class="dt-dd__label">{{ label }}</span>
			<span v-if="selected?.hint" class="dt-dd__hint">{{ selected.hint }}</span>
			<DtIcon class="dt-dd__caret" name="chevron-down" />
		</button>

		<div v-if="open" ref="panelEl" class="dt-dd__panel" :style="style" @keydown="onKeydown">
			<input
				v-if="showSearch"
				ref="searchEl"
				v-model="query"
				class="dt-input dt-dd__search"
				type="text"
				placeholder="Search…"
				aria-label="Search options"
			/>
			<ul class="dt-dd__list" role="listbox">
				<li v-if="!visible.length" class="dt-dd__empty">No match.</li>
				<li v-for="(choice, index) in visible" :key="String(choice.value)">
					<button
						type="button"
						class="dt-dd__option"
						:class="{ 'is-active': index === active, 'is-selected': sameValue(choice.value, modelValue) }"
						role="option"
						:title="choice.title"
						:aria-selected="sameValue(choice.value, modelValue)"
						@click="choose(choice)"
						@mousemove="active = index"
					>
						<DtIcon
							v-if="choice.icon"
							class="dt-dd__option-icon"
							:name="choice.icon"
							:style="choice.color ? { color: themeColor(choice.color) } : undefined"
						/>
						<span class="dt-dd__option-label">{{ choice.text }}</span>
						<span v-if="choice.hint" class="dt-dd__option-hint">{{ choice.hint }}</span>
					</button>
				</li>
			</ul>
		</div>
	</div>
</template>

<style scoped>
.dt-dd { position: relative; min-width: 0; }

.dt-dd__control {
	display: flex; align-items: center; gap: 6px; width: 100%;
	text-align: left; cursor: pointer;
}
.dt-dd__control:disabled { cursor: default; opacity: 0.6; }
.dt-dd__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-dd__control.is-placeholder .dt-dd__label { opacity: 0.6; }
.dt-dd__hint { font-size: 11px; opacity: 0.55; flex: none; }
.dt-dd__caret { font-size: 16px; opacity: 0.7; flex: none; }

/* fixed, not absolute — see the header comment */
.dt-dd__panel {
	position: fixed; z-index: 1000;
	display: flex; flex-direction: column; gap: 6px;
	padding: 6px;
	background: var(--vscode-quickInput-background, var(--vscode-editorWidget-background, var(--dt-bg-subtle)));
	border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, var(--dt-border)));
	border-radius: 6px;
	box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
	overflow: hidden;
}

.dt-dd__search { width: 100%; flex: none; }
.dt-dd__list { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; }

.dt-dd__option {
	display: flex; align-items: baseline; gap: 8px; width: 100%;
	background: none; border: 0; padding: 5px 8px; border-radius: 4px;
	text-align: left; cursor: pointer; color: inherit; font: inherit;
}
/* `is-active` is KEYBOARD position, `is-selected` is the committed value — they are different
   things and a dropdown that conflates them cannot show you where you are while you arrow past
   your own selection. */
.dt-dd__option.is-active { background: var(--vscode-list-hoverBackground, var(--dt-bg-hover)); }
.dt-dd__option.is-selected { font-weight: 600; }
.dt-dd__option.is-selected.is-active { background: var(--vscode-list-activeSelectionBackground, var(--dt-bg-active)); color: var(--vscode-list-activeSelectionForeground, var(--dt-fg)); }
.dt-dd__option-icon { flex: 0 0 auto; }
.dt-dd__option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-dd__option-hint { margin-left: auto; padding-left: 8px; font-size: 11px; opacity: 0.55; flex: none; }

.dt-dd__empty { padding: 8px; opacity: 0.7; font-size: 12px; }
</style>
