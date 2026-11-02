<!--
	Right-rail "Layout options" drawer. Registered once by BrowseView.vue's setup() with
	`props: { state, collection }` — `state` is a stable composable-instance object (refs inside),
	so this section reads it reactively without BrowseView re-registering on every change.

	Saved views here are ui-view RECORDS (`POST /collections/ui-views/records`): saving builds a
	`{route, scope: collection, collection, display: {nav, list}, filter?}` from the CURRENT browse
	state and the engine writes + compiles it, so the view becomes a real route immediately. The
	collection's own default is its `display.list`, saved with `dt set collections/<c>` (`lib/view-write.ts`).

	VS CODE PASS (operator 2026-07-27): layout is a dropdown, not a five-button stack; the drawer
	header is a 35px VS Code panel bar with "Save as view" teleported into it; the field list shows
	ONLY the displayed columns — in their real order, drag-to-rearrange — with a separate picker to
	add a hidden one back, and no inner scroll container competing with the drawer's own.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { BrowseState } from '../../composables/browse-state';
import { saveUiView, setCollectionKeys } from '../../composables/schema';
import { collectionListWrite, namedViewWrite, newViewWrite, type ListPresentation } from '../../lib/view-write';
import { useCollections } from '../../composables/collections';
import { compileFilter } from '../../lib/filter-query';
import { filterToWrite } from '../../lib/view-filter';
import { labelOf } from '../../lib/format-title';
import { computedReason } from '../../lib/field-row';
import { slugify } from '../../lib/slugify';
import { lists } from '../../registry/index';
import { loadUiViews, uiViews } from '../../ui-views';
import OptionsForm from '../render/OptionsForm.vue';
import { provideFieldContext } from '../../lib/field-context';
import DtSelect from '../DtSelect.vue';
import DtIcon from '../DtIcon.vue';
import ViewSaveActions from './ViewSaveActions.vue';
import { refusalAnswer, savedAnswer, type NextAction, type SaveAnswer } from '../../lib/save-answer';
import { viewModuleTargets } from '../../lib/view-module-targets';
import { useModules } from '../../composables/modules';

const props = defineProps<{
	state: BrowseState;
	collection: string;
}>();

const router = useRouter();


// An option that configures something ABOUT the collection (the board's group-by field, a card
// template's tokens) needs to know which fields exist. Provided once here, injected by the Edits
// that offer fields (lib/field-context.ts) — the generic options machinery in between stays
// collection-agnostic.
provideFieldContext({ collection: props.collection, fields: props.state.fields.visibleFields });

// The active List's self-describing options: drawn by OptionsForm through the same Edit resolution
// chain a record form uses — no bespoke settings markup. Empty for Lists that declare none.
const activeListOptions = computed(() => lists.get(props.state.layout.value)?.options ?? []);

/**
 * Does the options form draw its own section headings? True once every option the active layout
 * declares carries a `group` — `page_size` excepted, which is a lone trailing control whose label
 * says everything and which a heading of its own would only clutter.
 */
const optionsSelfHeaded = computed(() =>
	activeListOptions.value.length > 0 &&
	activeListOptions.value.every((o) => !!o.group || o.field === 'page_size'),
);

// Layouts come from the LIST REGISTRY, so core layouts and module-registered Lists both appear.
const availableLayouts = computed(() => lists.all().map((entry) => ({ id: entry.id, name: entry.name })));

// ---- columns -------------------------------------------------------------------------------
// The list shows the ACTUAL columns in their ACTUAL order, so this panel reads as "what the table
// looks like" rather than "every field, tick the ones you want" (operator: "show only fields
// displayed + add column fields selector").
const shownColumns = computed(() => props.state.columns.value);
const addableFields = computed(() => props.state.hiddenFields.value);
const addPick = ref('');

function addColumn(field: string): void {
	if (!field) return;
	props.state.toggleColumn(field);
	addPick.value = '';
}

// ---- sort ------------------------------------------------------------------------------------
// Sort was always PART of a view record (`options.sort`) but had no control here — the only way to
// set it was clicking a table header, which no other layout has. Now it is an ordinary panel
// control like layout and columns, so a kanban/cards/calendar view can be ordered at all, and the
// modified-dot/Save/Reset flow covers it exactly as it covers the rest.
const sortableFields = computed(() => props.state.fields.visibleFields.value);

function setSortField(field: string): void {
	// keep the current direction when swapping fields; a fresh pick starts ascending
	props.state.setSortValue(field ? (props.state.sortDesc.value ? `-${field}` : field) : '');
}

function setSortDesc(desc: boolean): void {
	const field = props.state.sortField.value;
	if (!field) return;
	props.state.setSortValue(desc ? `-${field}` : field);
}

const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function onDragStart(index: number, event: DragEvent): void {
	dragFrom.value = index;
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', String(index)); // Firefox won't start a drag without it
	}
}

function onDragOver(index: number): void {
	if (dragFrom.value === null) return;
	dragOver.value = index;
}

function onDrop(index: number): void {
	if (dragFrom.value !== null) props.state.moveColumn(dragFrom.value, index);
	dragFrom.value = null;
	dragOver.value = null;
}

function onDragEnd(): void {
	dragFrom.value = null;
	dragOver.value = null;
}

/** Keyboard parity for the drag — a mouse-only reorder is not a reorder. */
function nudge(index: number, delta: number): void {
	props.state.moveColumn(index, index + delta);
}

// ---- views: the collection's own display, and its named variants ------------------------------
// (operator 2026-07-27, Directus parity; descriptor v2 §3.5). "Save" writes the on-screen
// presentation back to whichever governs the page: a NAMED view record, or the collection's own
// `display.list` when the page is the bare collection.
const currentViewId = computed(() => props.state.viewId);
const { tree } = useCollections();

/** Everything the on-screen presentation contributes to a list block. */
function presentation(): ListPresentation {
	const snap = props.state.snapshot();
	// `sort` is written UNCONDITIONALLY, including `''`. Omitting it when falsy meant "no sort"
	// could not round-trip: on the next load the absent key fell through to the collection's sort,
	// so choosing Unsorted silently un-chose itself.
	return { layout: snap.layout, columns: [...snap.columns], sort: snap.sort, options: { ...(snap.listOptions[snap.layout] ?? {}) } };
}

const saving = ref(false);

// ---- the answer to the last save, drawn BESIDE the button that was pressed (ViewSaveActions) -------
const answer = ref<SaveAnswer | null>(null);
const answerFor = ref<'save' | 'save-as' | null>(null);
function answered(a: SaveAnswer, by: 'save' | 'save-as'): void {
	answer.value = a;
	answerFor.value = by;
}

/**
 * Save the current presentation — layout, columns, sort, list options AND the filter. What the
 * screen shows is what gets written; that is the whole contract of a Save button, and `dirty` is
 * computed against exactly this set.
 *
 * The one filter that is preserved verbatim is an OPAQUE one (`state.filterOpaque`): a stored
 * nested/mixed-logic filter the builder cannot represent never reached it, so writing the builder's
 * version would flatten the record's real filter away. A view's `nav` is preserved because this
 * panel has no control for it.
 *
 * The collection's OWN display takes the layout, its options, the columns and the sort in one
 * `dt set collections/<c>` write (`collectionListWrite`). ⚠ A FILTER is not part of a collection's
 * display, so it is named as unsaved and the page stays dirty, rather than reading as saved and
 * reverting on the next compile.
 *
 * A view or a collection an installed package ships is never refused here any more: the engine writes
 * the difference as an overlay in the workspace module, and the answer says so.
 */
async function saveCurrent(): Promise<void> {
	if (saving.value) return;
	saving.value = true;
	answer.value = null;
	try {
		const existing = uiViews.value.find((v) => v.id === currentViewId.value);
		const p = presentation();
		// The filter, from the builder — except for an opaque stored one, which is kept as-is. An
		// absent `filter` key is meaningful: the engine REPLACES the view source, so clearing every
		// condition and saving is how a view's filter is removed.
		const filter = filterToWrite(props.state.filterGroup.value, { opaque: props.state.filterOpaque, stored: existing?.filter });
		if (existing) {
			const out = await saveUiView(existing.id, namedViewWrite(existing, props.collection, p, filter));
			await loadUiViews(router);
			props.state.markSaved();
			answered(savedAnswer('view', out), 'save');
			return;
		}
		const own = tree.value.find((r) => r.collection === props.collection)?.list;
		const { changes, unsaved } = collectionListWrite(own, p, filter);
		const out = await setCollectionKeys(props.collection, changes);
		if (!unsaved.length) props.state.markSaved();
		answered(savedAnswer('collection', out, { unsaved }), 'save');
	} catch (err) {
		answered(refusalAnswer(err, { saveAs: false }), 'save');
	} finally {
		saving.value = false;
	}
}

function resetView(): void {
	props.state.resetToView();
	answer.value = null;
}

const savingView = ref(false);
const viewBusy = ref(false);

// The module picker's rows: the workspace module first (the engine's default), every module whose
// sources are here by name, a node_modules one locked with its reason (lib/view-module-targets.ts).
const { modules, workspaceModule } = useModules();
const moduleTargets = computed(() => viewModuleTargets(modules.value, workspaceModule.value));

// The route is DERIVED, not typed (operator asked what `/views/` even implied — it is a routing
// detail, not a decision), and the record id is the engine's own `{{ route | slug }}`. Scoping the
// route by collection means two collections can each have a view called "Recent" without colliding.
const collectionSlug = computed(() => props.collection.replace(/\//g, '-'));

function startSaveView(): void {
	answer.value = null;
	savingView.value = true;
}

async function confirmSaveView(v: { name: string; icon: string; module: string | null }): Promise<void> {
	const id = slugify(v.name);
	if (!id || viewBusy.value) return;
	viewBusy.value = true;
	answer.value = null;
	try {
		const view = newViewWrite(
			`/views/${collectionSlug.value}/${id}`,
			props.collection,
			{ title: v.name, icon: v.icon || undefined },
			presentation(),
			compileFilter(props.state.filterGroup.value) ?? undefined,
		);
		await saveUiView(undefined, view, v.module ?? undefined);
		await loadUiViews(router); // re-run the boot wiring: the route appears without a reload
		savingView.value = false;
		answered(savedAnswer('new-view', undefined, { route: view.route, module: v.module }), 'save-as');
	} catch (err) {
		// the form STAYS open: every next action a refusal names (rename, another module) is in it
		answered(refusalAnswer(err, { saveAs: true }), 'save-as');
	} finally {
		viewBusy.value = false;
	}
}

/** The answer's one next action: both open (or keep open) the form, where the name and the module are. */
function onNext(action: NextAction): void {
	// from a Save refusal this opens the form; from a Save as… refusal the form is already open
	if ((action === 'rename' || action === 'pick-module') && !savingView.value) startSaveView();
}

// Adapters onto DtSelect's `{text, value}` shape — every one of these was a native <select>.
const layoutChoices = computed(() => availableLayouts.value.map((e) => ({ text: e.name, value: e.id })));
const sortChoices = computed(() => sortableFields.value.map((f) => ({ text: labelOf(f), value: f.field })));
const addableChoices = computed(() => addableFields.value.map((f) => ({ text: labelOf(f), value: f.field })));
</script>

<template>
	<div class="dt-lo">
		<!-- primary action rides in the drawer's own title bar (DtDrawer exposes the target) -->
		<!-- `defer`: the drawer header renders in the same patch as this body, so the target
		     does not exist yet on first mount — deferring resolves it after the tick. -->
		<Teleport defer to=".dt-drawer__actions">
			<ViewSaveActions
				:dirty="state.dirty.value"
				:saving="saving"
				:save-title="currentViewId ? 'Save this presentation to the current view record' : 'Save the layout, its options, the columns and the sort to the collection\'s own display'"
				:answer="answer"
				:answer-for="answerFor"
				:form-open="savingView"
				:busy="viewBusy"
				:collection="collection"
				:targets="moduleTargets"
				@save="saveCurrent"
				@open-form="startSaveView"
				@cancel-form="savingView = false"
				@reset="resetView"
				@dismiss="answer = null"
				@confirm="confirmSaveView"
				@next="onNext"
			/>
		</Teleport>

		<section class="dt-lo-section">
			<label class="dt-lo-label" for="dt-lo-layout">Layout</label>
			<DtSelect
				class="dt-lo-select"
				:model-value="state.layout.value"
				:choices="layoutChoices"
				aria-label="Layout"
				@update:model-value="state.setLayout(String($event))"
			/>
		</section>

		<section class="dt-lo-section">
			<label class="dt-lo-label" for="dt-lo-sort">Sort</label>
			<div class="dt-lo-sort">
				<DtSelect
					class="dt-lo-select"
					:model-value="state.sortField.value"
					:choices="sortChoices"
					placeholder="Unsorted"
					aria-label="Sort"
					@update:model-value="setSortField(String($event ?? ''))"
				/>
				<div class="dt-lo-dir" role="group" aria-label="Sort direction">
					<button
						type="button"
						title="Ascending"
						:class="{ on: !state.sortDesc.value }"
						:disabled="!state.sortField.value"
						@click="setSortDesc(false)"
					>
						<DtIcon name="arrow-up" />
					</button>
					<button
						type="button"
						title="Descending"
						:class="{ on: state.sortDesc.value }"
						:disabled="!state.sortField.value"
						@click="setSortDesc(true)"
					>
						<DtIcon name="arrow-down" />
					</button>
				</div>
			</div>
		</section>

		<!-- ⚠ NO "OPTIONS" LABEL WHEN THE FORM SUPPLIES ITS OWN. Every layout's options now sit in a
		     named group, and `OptionsForm` draws that group's heading in a style identical to
		     `.dt-lo-label` — so keeping this one put "OPTIONS" directly above "TIME AXIS" as two
		     apparent peers. The group headings ARE the sections; this label existed to name the
		     undifferentiated stack they replaced (operator 2026-09-10: "ui sucks for the layout").
		     It stays for a layout whose options are ungrouped, so nothing is ever unlabelled. -->
		<section v-if="activeListOptions.length" class="dt-lo-section">
			<p v-if="!optionsSelfHeaded" class="dt-lo-label">Options</p>
			<OptionsForm
				:options="activeListOptions"
				:model-value="state.listOptions.value[state.layout.value] ?? {}"
				@update:model-value="state.setListOptions(state.layout.value, $event)"
			/>
		</section>

		<section v-if="state.layout.value === 'table'" class="dt-lo-section">
			<p class="dt-lo-label">Columns</p>

			<ul class="dt-lo-cols">
				<li
					v-for="(field, index) in shownColumns"
					:key="field.field"
					class="dt-lo-col"
					:class="{ dragging: dragFrom === index, over: dragOver === index && dragFrom !== index }"
					draggable="true"
					@dragstart="onDragStart(index, $event)"
					@dragover.prevent="onDragOver(index)"
					@drop.prevent="onDrop(index)"
					@dragend="onDragEnd"
				>
					<DtIcon class="dt-lo-grip" title="Drag to reorder" name="gripper" />
					<span class="dt-lo-col-name" :class="{ 'dt-computed': computedReason(field, { create: false }) !== null }" :title="computedReason(field, { create: false }) ?? undefined">{{ labelOf(field) }}</span>
					<span class="dt-lo-col-actions">
						<button type="button" title="Move up" :disabled="index === 0" @click="nudge(index, -1)">
							<DtIcon name="chevron-up" />
						</button>
						<button type="button" title="Move down" :disabled="index === shownColumns.length - 1" @click="nudge(index, 1)">
							<DtIcon name="chevron-down" />
						</button>
						<button type="button" title="Hide column" @click="state.toggleColumn(field.field)">
							<DtIcon name="close" />
						</button>
					</span>
				</li>
			</ul>
			<p v-if="!shownColumns.length" class="dt-lo-status">No columns shown</p>

			<DtSelect
				v-if="addableFields.length"
				class="dt-lo-select dt-lo-add"
				:model-value="addPick"
				:choices="addableChoices"
				placeholder="+ Add column…"
				aria-label="Add column"
				@update:model-value="addColumn(String($event ?? ''))"
			/>
		</section>

		<!-- ⚠ THE LIST OF VIEWS IS GONE (0.13.0, operator: "views in layout options is redundant and
		     confusing") — the sidebar tree shows every view under its collection. And the Save as… form
		     and the save's answer are no longer a section HERE either (0.24.22): they drop down from the
		     title bar beside the buttons (ViewSaveActions.vue), because at the bottom of the drawer they
		     were below the fold and a refusal went unseen. -->

	</div>
</template>

<style scoped>
.dt-lo {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-4);
	/* A dense rail wants a switch that does not out-shout its own setting. EditBoolean sizes itself
	   from this, so no variant prop and no second component (see EditBoolean's header). */
	--dt-switch-h: 16px;
}

/* 4px inside against 16px between is a 4:1 ratio. It was 6:16 — 2.67:1 — which is not enough
   separation for sections that stack up to six blocks, and 6px was not on the 4/8/12/16/24 scale
   the tokens declare. Every `margin` that used to fight this gap has been deleted rather than
   retuned: one axis of vertical rhythm, owned by the flex gap. */
.dt-lo-section {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-1);
}

/* The panel's own type scale, imposed on the generic form machinery inside OPTIONS.
   ⚠ WITHOUT THIS THE HIERARCHY IS INVERTED: `FormField`'s label is 13px/600/full-contrast because a
   record form is a page of fields where that is right, and it rendered UNDER an 11px/400/subtle
   "OPTIONS" heading — every child louder than its own parent. Scoped with :deep so the record form,
   where the current treatment is correct, is untouched. */
.dt-lo :deep(.dt-form-field-label) {
	font-size: var(--dt-text);
	font-weight: 400;
	color: var(--dt-fg);
	margin-bottom: var(--dt-space-1);
}


/* VS Code section labels: 11px uppercase — and 600, so a heading outranks the controls beneath it.
   At 400 it was the quietest text in its own section while its children were 13px bold. */
.dt-lo-label {
	margin: 0 0 var(--dt-space-1);
	font-size: var(--dt-label);
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
}

/* ---- the select ----
   ⚠ `DtSelect` does NOT set `inheritAttrs: false`, so this class lands on its ROOT WRAPPER, not on
   the `.dt-select` button inside it. Until 0.13.0 this rule gave the wrapper its own border, its own
   background and its own 2px radius — around a button that already had all three — so every dropdown
   in the panel was a bordered box inside a bordered box, with a 26px wrapper containing a 26px button
   that overflowed it by its own 2px of border. It also explained why the LAYOUT and SORT dropdowns
   looked different from the ones inside OPTIONS, which get no class and so render as `.dt-select`
   alone. The chrome belongs to `.dt-select`; a wrapper may only size itself. `:focus` is gone with
   it — it targeted a div with no tabindex and could never match. */
.dt-lo-select {
	width: 100%;
	min-height: var(--dt-control-height);
}
.dt-lo-add {
	color: var(--dt-fg-subtle);
}

/* ---- sort: field select + direction segment ---- */
.dt-lo-sort {
	display: flex;
	align-items: center;
	gap: var(--dt-space-1);
}
.dt-lo-sort .dt-lo-select {
	flex: 1 1 auto;
	min-width: 0;
}

.dt-lo-dir {
	display: flex;
	flex-shrink: 0;
	border: 1px solid var(--vscode-dropdown-border, var(--dt-border));
	border-radius: 2px;
	overflow: hidden;
}
.dt-lo-dir button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	border: none;
	background: var(--vscode-dropdown-background, var(--dt-bg-subtle));
	color: var(--dt-fg-subtle);
	cursor: pointer;
}
.dt-lo-dir button:hover:not(:disabled) {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
.dt-lo-dir button.on {
	background: var(--dt-bg-active);
	color: var(--dt-fg);
}
.dt-lo-dir button:disabled {
	opacity: 0.4;
	cursor: default;
}
.dt-lo-dir .codicon {
	font-size: var(--dt-text);
}

/* ---- columns: shown-only, ordered, draggable, NO inner scroll ---- */
.dt-lo-cols {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.dt-lo-col {
	display: flex;
	align-items: center;
	gap: 4px;
	height: 24px;
	padding: 0 2px 0 0;
	border-radius: 3px;
	font-size: var(--dt-text);
	color: var(--dt-fg);
	cursor: grab;
	user-select: none;
}
.dt-lo-col:hover {
	background: var(--dt-bg-hover);
}
.dt-lo-col.dragging {
	opacity: 0.45;
}
.dt-lo-col.over {
	box-shadow: inset 0 -2px 0 0 var(--vscode-focusBorder, var(--dt-accent));
}

.dt-lo-grip {
	font-size: var(--dt-icon);
	color: var(--dt-fg-muted);
	flex-shrink: 0;
	cursor: grab;
}

.dt-lo-col-name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.dt-lo-col-actions {
	display: none;
	align-items: center;
	flex-shrink: 0;
}
.dt-lo-col:hover .dt-lo-col-actions,
.dt-lo-col:focus-within .dt-lo-col-actions {
	display: flex;
}

.dt-lo-col-actions button {
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
.dt-lo-col-actions button:hover:not(:disabled) {
	background: var(--dt-bg-active);
	color: var(--dt-fg);
}
.dt-lo-col-actions button:disabled {
	opacity: 0.3;
	cursor: default;
}
.dt-lo-col-actions .codicon {
	font-size: var(--dt-text);
}

/* ---- the one status line left here ("No columns shown"); a save's answer is ViewSaveActions' ---- */
.dt-lo-status {
	margin: 0;
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}
</style>
