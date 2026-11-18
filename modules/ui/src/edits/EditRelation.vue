<!--
	Relation picker. Adaptation note: the plan calls for "reka-ui listbox/combobox" for
	single-select — ComboboxRoot exists in this reka-ui version (verified against
	node_modules/reka-ui/dist/index.d.ts) but its built-in filtering model assumes a fixed
	local item set, while here the candidate list is server-searched (useItems' `search`
	ref triggers a refetch). Wiring manual-filter combobox state on top of an async,
	paginated fetch added complexity disproportionate to C1's scope, so this uses a plain
	text input + list (behavior over primitive pedigree, per the plan's escape hatch).

	Polish wave (defect 1): this used to render the search input + full option list permanently
	open, eating the page on any form with a relation field. Now a closed `.dt-input`-alike control
	(selected title or placeholder, clear ×, expand caret) opens a hand-rolled anchored popover
	(position: absolute under the control, shadow-lg, max-height 320px) on click; a document
	mousedown listener closes it on outside-click, Escape closes it too, and picking an option
	closes it (both single and list mode — some pickers re-open for the next pick, but this
	stays simple per the spec's literal "selecting closes it"). Not reka-ui Popover: that primitive
	teleports its content to <body> via a Portal, which is exactly the sibling-DOM-order trap
	BrowseView.vue's header comment documents for AlertDialog (overlay/content siblings, needs its
	own z-index/position math) — a field-anchored popover has no such teleport need, so a plain
	`position: relative` wrapper + `position: absolute` panel avoids that whole class of bug.

	Polish wave (defect 1, effect-scope fix): the target-resolution fallback below (no
	`targetCollection` prop) resolves `target.value` from an awaited `loadRelations()` fetch — i.e.
	OUTSIDE this component's synchronous setup() call. The `watch(target, ...)` watcher itself is
	still created synchronously in setup (so ITS effect is properly scoped), but the callback body
	used to call `useItems(collection)` (which internally creates its own `watch([...])`) plus two
	`watchEffect`s and a nested `watch(search, ...)` — all of which are reactive effects created at
	CALLBACK-RUN time, not creation time. When `target.value` only ever changes synchronously
	(props.targetCollection passed, `{ immediate: true }` fires inline during setup) that happened to
	be harmless; when it changes via the async fallback, those nested effects are created with no
	active Vue effect scope (the component's `instance.scope` is only "current" while synchronously
	running inside `scope.run(setupFn)`, which has long since returned by the time the awaited
	`.then()` resolves) — so they're never registered for auto-disposal and leak forever past
	unmount. Fix: an explicit `effectScope()` created synchronously here (so it registers as a child
	of the component's own scope) and `.run()`-wrapped around every lazy effect creation inside the
	watch callback — `scope.run(fn)` re-establishes "current scope" for the duration of `fn` no
	matter when it's called, so the nested effects land in `scope` regardless of sync/async timing,
	and `onScopeDispose` (itself scoped to the component) stops `scope` — and everything in it — on
	unmount.
-->
<script setup lang="ts">
import { computed, effectScope, nextTick, onMounted, onScopeDispose, onUnmounted, ref, watch, watchEffect } from 'vue';
import type { FieldRow, ItemRecord } from '../api/types';
import { loadRelations } from '../composables/fields';
import { isRelationList } from '../lib/field-row';
import { useItems } from '../composables/items';
import { useCollections } from '../composables/collections';
import { pathStem, titleOf } from '../lib/record-title';
import { recordTitle } from '../lib/record-titles';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
	/** Owning-collection's relation target, when the caller already knows it (ItemForm/Task 6). */
	targetCollection?: string;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const isListMode = computed(() => isRelationList(props.field));

const target = ref<string | null>(props.targetCollection ?? null);

// See the file header's effect-scope note: a child scope, created synchronously (so Vue registers
// it under the component's own scope), re-entered via `.run()` around every reactive effect this
// component creates lazily/async — guarantees disposal on unmount regardless of timing.
const scope = effectScope();
onScopeDispose(() => scope.stop());

// Fallback target resolution: when the caller doesn't pass targetCollection, search the
// flat cached /relations list by field name. Ambiguous if two collections share a field
// name with different targets — callers should prefer passing targetCollection.
if (!props.targetCollection) {
	void loadRelations().then((rows) => {
		const match = rows.find((row) => row.field === props.field.field && row.related_collection);
		target.value = match?.related_collection ?? null;
	});
}

const search = ref('');
const records = ref<ItemRecord[]>([]);
const loading = ref(false);
let itemsState: ReturnType<typeof useItems> | null = null;

watch(
	target,
	(collection) => {
		if (!collection || itemsState) return;
		scope.run(() => {
			itemsState = useItems(collection);
			const state = itemsState;
			watchEffect(() => {
				records.value = state.items.value;
			});
			watchEffect(() => {
				loading.value = state.loading.value;
			});
			watch(search, (value) => {
				state.search.value = value;
			});
		});
	},
	{ immediate: true },
);

/** Canonical stored form: '/' + `$path` with the `data/` root stripped, e.g. `/humans/ada.human.md`. */
function pathOf(record: ItemRecord): string {
	return `/${String(record['$path']).replace(/^data\//, '')}`;
}

// An option and the selected value are named by the TARGET collection's `record_title` (descriptor
// v2 §3.1) — the same answer a relation cell, a record header and a card give for the record, so the
// picker never calls it something else. With no row for the target yet, the title guess stands.
const { tree } = useCollections();
const targetRow = computed(() => (target.value ? tree.value.find((r) => r.collection === target.value) : undefined));

function titleFor(record: ItemRecord): string {
	const fallback = titleOf(record, props.options?.['titleField'] as string | undefined) || String(record['id'] ?? '');
	return recordTitle(targetRow.value, record, fallback);
}

const selectedPaths = computed<string[]>(() => {
	if (isListMode.value) return Array.isArray(props.value) ? (props.value as string[]) : [];
	return typeof props.value === 'string' && props.value ? [props.value] : [];
});

function isSelected(record: ItemRecord): boolean {
	return selectedPaths.value.includes(pathOf(record));
}

/** Best-effort label for an already-selected path: the fetched page's title if present (usual
 * case for a small demo-sized target collection), else the path's basename without extension —
 * the same fallback ViewRelation now uses for unresolved relation values (defect 4). */
function labelForPath(path: string): string {
	const match = records.value.find((record) => pathOf(record) === path);
	return match ? titleFor(match) : pathStem(path);
}

const selectedLabel = computed(() => {
	const paths = selectedPaths.value;
	if (!paths.length) return '';
	if (isListMode.value) return paths.length === 1 ? labelForPath(paths[0]!) : `${paths.length} selected`;
	return labelForPath(paths[0]!);
});

function select(record: ItemRecord): void {
	const path = pathOf(record);

	if (isListMode.value) {
		const current = selectedPaths.value;
		const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
		emit('update:value', next);
	} else {
		emit('update:value', path);
	}

	closePopover();
}

function clear(): void {
	emit('update:value', isListMode.value ? [] : null);
}

// ---- closed/open popover state -----------------------------------------------------------------
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const searchInputEl = ref<HTMLInputElement | null>(null);

function openPopover(): void {
	open.value = true;
	void nextTick(() => searchInputEl.value?.focus());
}

function closePopover(): void {
	open.value = false;
}

function toggleOpen(): void {
	if (open.value) closePopover();
	else openPopover();
}

function onDocMousedown(event: MouseEvent): void {
	if (!open.value) return;
	if (rootEl.value && !rootEl.value.contains(event.target as Node)) closePopover();
}

onMounted(() => {
	document.addEventListener('mousedown', onDocMousedown);
	if (props.autofocus) openPopover();
});
onUnmounted(() => document.removeEventListener('mousedown', onDocMousedown));
</script>

<template>
	<div ref="rootEl" class="dt-relation" @keydown.escape="closePopover">
		<button type="button" class="dt-relation-control" :class="{ 'is-open': open }" @click="toggleOpen">
			<span class="dt-relation-control-text" :class="{ 'is-placeholder': !selectedLabel }">{{ selectedLabel || 'Select…' }}</span>
			<span class="dt-relation-control-actions">
				<span v-if="selectedLabel" class="dt-relation-clear" role="button" aria-label="Clear" tabindex="-1" @click.stop="clear">
					<DtIcon name="close" />
				</span>
				<DtIcon class="dt-relation-caret" name="triangle-down" />
			</span>
		</button>

		<div v-if="open" class="dt-relation-popover">
			<input ref="searchInputEl" v-model="search" dir="auto" class="dt-input dt-relation-search" type="text" placeholder="Search…" />
			<ul class="dt-relation-list">
				<li v-if="loading" class="dt-relation-empty">Loading…</li>
				<li v-else-if="!records.length" class="dt-relation-empty">No matches</li>
				<li
					v-for="record in records"
					:key="String(record['id'] ?? record['$path'])"
					class="dt-relation-item"
					:class="{ selected: isSelected(record) }"
					@click="select(record)"
				>
					{{ titleFor(record) }}
				</li>
			</ul>
		</div>
	</div>
</template>

<style scoped>
.dt-relation {
	position: relative;
}

.dt-relation-control {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	width: 100%;
	min-height: var(--dt-input-height);
	padding: 0 10px 0 14px;
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	color: var(--dt-fg);
	font-family: var(--dt-font);
	font-size: var(--dt-text);
	cursor: pointer;
	transition:
		background-color 0.12s ease,
		border-color 0.12s ease;
}

.dt-relation-control:hover,
.dt-relation-control.is-open {
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}

.dt-relation-control-text {
	flex: 1 1 auto;
	min-width: 0;
	text-align: left;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dt-relation-control-text.is-placeholder {
	color: var(--dt-fg-muted);
}

.dt-relation-control-actions {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 2px;
	color: var(--dt-fg-subtle);
}

.dt-relation-clear {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	cursor: pointer;
}

.dt-relation-clear:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}

.dt-relation-clear .codicon {
	font-size: var(--dt-icon);
}

.dt-relation-caret {
	font-size: var(--dt-icon);
}

.dt-relation-popover {
	position: absolute;
	top: calc(100% + 4px);
	left: 0;
	right: 0;
	z-index: 20;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	box-shadow: var(--dt-shadow-lg);
	padding: 8px;
	max-height: 320px;
	display: flex;
	flex-direction: column;
}

.dt-relation-search {
	margin-bottom: 8px;
	min-height: var(--dt-control-height);
}

.dt-relation-list {
	list-style: none;
	margin: 0;
	padding: 0;
	overflow-y: auto;
}

.dt-relation-item {
	padding: 8px 10px;
	border-radius: var(--dt-radius);
	cursor: pointer;
	color: var(--dt-fg);
	font-size: var(--dt-text);
}
.dt-relation-item:hover {
	background: var(--dt-bg-subtle);
}
.dt-relation-item.selected {
	background: var(--dt-accent);
	color: #ffffff;
}
.dt-relation-empty {
	padding: 8px 10px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
</style>
