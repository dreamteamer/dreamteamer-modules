<!--
	Core kanban List (layouts wave, operator ask 2026-07-27: "everything Directus supports"; widened
	2026-07-29 when the board moved out of a workspace module into core — see
	docs/superpowers/specs/2026-07-29-kanban-core-move-design.md in the vault).

	Same BrowseState-driven contract as ListCards: ContentBrowse/BrowseView owns the state, this
	renders it. Five declared options (registered in registry/register-defaults.ts, drawn by
	OptionsForm, persisted in the ui-view record):

	  group_by              the field the COLUMNS come from; defaults to the first field with `choices`
	  show_ungrouped        a column for records whose group value is empty (default false)
	  group_by   the field the horizontal BANDS come from; empty = the historical single strip
	  show_ungrouped_lane   a lane for records with no lane value (default false)
	  template              card content as a `{{ field }}` display template; default = title + id

	COLUMNS COME FROM THE SCHEMA, IN SCHEMA ORDER. A descriptor's `enum:` compiles to
	`editor_options.choices` in declared order (engine `src/presentation.js`), so `todo, doing,
	done` renders left-to-right as authored — no second ordering stored in the view record to drift
	from it (decision: no drag-to-reorder). Labels are `choices[].text`.

	A value present in the DATA but absent from the enum gets its own column, appended after the
	declared ones. The previous version folded those into the ungrouped bucket, which was survivable
	only while that bucket was always visible — now that `show_ungrouped` defaults to false, an
	off-enum record would have vanished from the board entirely.

	BANDS are horizontal rows keyed by `group_by` (any field, not just an enum). Each lane renders its
	own copy of the column set, so the STATUS axis reads across lanes and the LANE axis reads down
	them. Presentation-only: a card carries the same group_by field it always did, and dragging still
	patches THAT field alone — the lane is derived from a field the drag doesn't touch. An empty
	group_by keeps the historical picture verbatim; a named-but-missing one degrades to it too,
	because a mistyped option should never erase the board.

	Dragging a card to a column PATCHes that one field through the ordinary items API (one engine
	commit per move) and reloads; dropping onto the ungrouped column CLEARS it (`null`). Both are
	things `dreamteamer <collection> set` can do — no UI-only capability here (engine/UI split).
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import { rowContext } from '../lib/vscode-context';
import { choicesOf } from '../lib/field-row';
import { api } from '../api/client';
import type { ItemRecord } from '../api/types';
import { bucketize, buildLanes, ungroupedAllowed as ungroupedAllowedOf, UNGROUPED, valueOf } from '../lib/grouping';
import DisplayTemplate from '../components/render/DisplayTemplate.vue';
import DtIcon from '../components/DtIcon.vue';
import SourceMark from '../components/SourceMark.vue';
import StubNote from '../components/StubNote.vue';

const props = defineProps<{ state: BrowseState }>();

// BrowseView passes the module-List prop set (`collection`, `query`, `options`) alongside `state`.
// This List consumes only `state`, and without this the rest fall through onto the root element as
// literal DOM attributes (`options="[object Object]"`) — same posture as ListCards.
defineOptions({ inheritAttrs: false });

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['kanban'] ?? {});

/** The group-by FIELD (not just its name): its choices give the columns, its `required` decides
 *  whether "no value" is even reachable. Option first, else the first field declaring choices. */
const groupField = computed(() => {
	const fields = props.state.fields.visibleFields.value;
	const named = options.value['lanes_by'];
	if (typeof named === 'string' && named.length) return fields.find((f) => f.field === named) ?? null;
	return fields.find((f) => choicesOf(f) !== null) ?? null;
});

/** The LANE-by field: only ever resolved from the option, never inferred. An empty option, or a
 *  named field the collection does not carry, both mean "no lane axis" — a typo in the ui-view
 *  should never erase the board. */
const laneField = computed(() => {
	const fields = props.state.fields.visibleFields.value;
	const named = options.value['group_by'];
	if (typeof named !== 'string' || !named.length) return null;
	return fields.find((f) => f.field === named) ?? null;
});

interface Column {
	value: string;
	label: string;
	records: ItemRecord[];
	/** The ungrouped bucket accepts drops too — it just writes `null` instead of a value. */
	ungrouped?: boolean;
}

const groupUngroupedAllowed = computed(() => ungroupedAllowedOf(groupField.value));
const laneUngroupedAllowed = computed(() => ungroupedAllowedOf(laneField.value));

const showUngrouped = computed(() => groupUngroupedAllowed.value && options.value['show_ungrouped_columns'] === true);
const showUngroupedLane = computed(() => laneUngroupedAllowed.value && options.value['show_ungrouped_rows'] === true);
// ⚠ The two axes have OPPOSITE defaults, and the asymmetry is the whole reason there are two
// options. A COLUMN is a drop target: an empty "Blocked" is where you drag the thing you just got
// blocked on, so hiding it removes the gesture — hence `!== false`. A BAND is not a drop target
// (a drop patches the column field alone), so an empty band is only distance between the reader and
// the work — hence `=== true`. Reported 2026-09-07: a filtered board drew every declared lane.
const showEmptyColumns = computed(() => options.value['show_empty_columns'] !== false);
const showEmptyLanes = computed(() => options.value['show_empty_rows'] === true);

function groupValueOf(record: ItemRecord): string {
	return valueOf(record, groupField.value);
}

/**
 * The rendered structure. When `group_by` is not set, this is a single implicit lane containing every
 * column — the template loops one way and the historical picture falls out. When set, this is one
 * entry per lane value, each carrying the same column set derived from that lane's records.
 *
 * Kept as ONE computed rather than `lanes` + `columns` derived separately: the columns depend on the
 * lane's record subset, so deriving them in the template with two loops would recompute per record.
 */
interface LaneRow {
	value: string;
	label: string;
	columns: Column[];
	/** True for the ungrouped LANE — currently unused by the template but part of the same shape as
	 *  a column, so future lane-level gestures (dropping to clear the lane field) can reach it. */
	ungrouped?: boolean;
}

const layout = computed<LaneRow[]>(() => {
	if (!groupField.value) return [];
	const records = props.state.items.items.value;
	const lanes = buildLanes(laneField.value, records, { showUngrouped: showUngroupedLane.value, showEmpty: showEmptyLanes.value });
	// No lane axis: one implicit lane holding every record. The template renders the lane header only
	// when `.length > 1` or when the lane is a real (named) axis, so the single-strip look is unchanged.
	if (!lanes) {
		return [
			{
				value: '__all__',
				label: '',
				columns: bucketize(groupField.value, records, { showUngrouped: showUngrouped.value, showEmpty: showEmptyColumns.value }),
			},
		];
	}
	return lanes.map((lane) => ({
		value: lane.value,
		label: lane.label,
		ungrouped: lane.ungrouped,
		columns: bucketize(groupField.value, lane.records, { showUngrouped: showUngrouped.value, showEmpty: showEmptyColumns.value }),
	}));
});

/** True whenever the operator asked for a lane axis. Distinguishes "no lane_by" (one implicit lane,
 *  render no header) from "lane_by set with one distinct value" (one lane, header should still show,
 *  because that fact is a real answer to what the option currently produces). */
const laned = computed(() => laneField.value !== null);

/** Records hidden because their group value is empty and the ungrouped column is off — surfaced as
 *  a hint rather than silently dropped (the cost the operator accepted in taking Directus parity). */
const hiddenCount = computed(() => {
	if (!groupField.value || showUngrouped.value) return 0;
	return props.state.items.items.value.filter((r) => groupValueOf(r) === '').length;
});

/** How many records fall into no lane, when a lane axis exists and the ungrouped lane is off. Same
 *  discipline as `hiddenCount` above: never silently dropped. */
const laneHiddenCount = computed(() => {
	if (!laneField.value || showUngroupedLane.value) return 0;
	return props.state.items.items.value.filter((r) => valueOf(r, laneField.value) === '').length;
});

// ---- card content ---------------------------------------------------------------------------
// A `{{ field }}` template renders through the shared DisplayTemplate (tokens resolve to their
// Views — a status as its label, a date formatted); unset keeps the title + id pair the board has
// always shown, so a board with no options configured looks exactly as it did.
const cardTemplate = computed<string | null>(() => {
	const raw = options.value['card_title'];
	return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
});

// ---- drag and drop -------------------------------------------------------------------------
const dragging = ref<string | null>(null);
const dropTarget = ref<string | null>(null);
const saving = ref(false);
const moveError = ref<string | null>(null);

/**
 * Create a record already carrying this column's value — the header `+`. The prefill rides to the
 * create form as a query param and is applied through `item.setField` (see browse-state's
 * `createRecord`), so the operator lands on a normal create page with the group field already set
 * and everything else empty. Not offered on the ungrouped column: "create a record with no status"
 * is what the page-header `+` already does.
 *
 * When a lane axis is active, the LANE's value rides along too — a `+` inside the "finance" lane's
 * "todo" column creates a finance/todo task, not a todo task with no module. The ungrouped lane
 * does not prefill the lane field (dropping in it CLEARS the value; creating a record there means
 * "no lane value", which is what leaving the field empty already produces).
 */
function addTo(lane: LaneRow, column: Column): void {
	const field = groupField.value;
	if (!field || column.ungrouped) return;
	const prefill: Record<string, unknown> = { [field.field]: column.value };
	if (laneField.value && !lane.ungrouped && lane.value !== '__all__') {
		prefill[laneField.value.field] = lane.value;
	}
	props.state.createRecord(prefill);
}

function onDragStart(record: ItemRecord): void {
	dragging.value = props.state.pkOf(record);
	moveError.value = null;
}

function onDragEnd(): void {
	dragging.value = null;
	dropTarget.value = null;
	dropSlot.value = null;
}

/**
 * Manual card ordering — OFF unless the collection declares a `position_field` (a field of `type:
 * position`) and the list is currently sorted by it. A collection with none gets no drag, and the
 * board behaves exactly as it did before.
 */
const canReorder = computed<boolean>(() => props.state.manualOrder.value);

/** The gap a drop would land in: the card it would sit ABOVE, or null for the end of the column. */
const dropSlot = ref<string | null>(null);

/**
 * Drop into a GAP rather than onto a column. Two writes to one record when the column also changed —
 * the group field, then the position — because they are independent facts about the record and the
 * engine validates each. The key itself is computed engine-side: this component never spells the
 * alphabet, which is the one thing a second implementation would get silently wrong.
 */
async function onDropAt(column: Column, above: ItemRecord | null): Promise<void> {
	const pk = dragging.value;
	const field = groupField.value;
	dropSlot.value = null;
	dropTarget.value = null;
	dragging.value = null;
	if (!pk || !field || saving.value || !canReorder.value) return;
	if (column.ungrouped && !groupUngroupedAllowed.value) return;

	const aboveId = above ? props.state.pkOf(above) : null;
	if (aboveId === pk) return; // dropped into its own gap

	const next = column.ungrouped ? null : column.value;
	const current = props.state.items.items.value.find((r) => props.state.pkOf(r) === pk);

	saving.value = true;
	moveError.value = null;
	try {
		if (current && groupValueOf(current) !== (next ?? '')) {
			await api.patch(`/items/${encodeURIComponent(props.state.collection)}/${encodeURIComponent(pk)}`, { [field.field]: next });
		}
		await api.patch(
			`/collections/${encodeURIComponent(props.state.collection)}/position/${encodeURIComponent(pk)}`,
			aboveId ? { before: aboveId } : { bottom: true },
		);
		await props.state.items.reload();
	} catch (error) {
		moveError.value = error instanceof Error ? error.message : String(error);
	} finally {
		saving.value = false;
	}
}

async function onDrop(column: Column): Promise<void> {
	const pk = dragging.value;
	const field = groupField.value;
	dropTarget.value = null;
	dragging.value = null;
	if (!pk || !field || saving.value) return;
	if (column.ungrouped && !groupUngroupedAllowed.value) return;

	const next = column.ungrouped ? null : column.value;
	const current = props.state.items.items.value.find((r) => props.state.pkOf(r) === pk);
	if (current && groupValueOf(current) === (next ?? '')) return; // dropped where it already was

	saving.value = true;
	moveError.value = null;
	try {
		await api.patch(`/items/${encodeURIComponent(props.state.collection)}/${encodeURIComponent(pk)}`, { [field.field]: next });
		await props.state.items.reload();
	} catch (error) {
		// The engine validates on write, so a rejected move is real information (a required field, a
		// value the enum doesn't allow) — it belongs on screen, not only in the console.
		moveError.value = error instanceof Error ? error.message : String(error);
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<div v-if="!groupField" class="dt-empty">
		<DtIcon name="split-horizontal" />
		<p class="dt-empty__line">No field to group by — pick one in Layout options (Group by field).</p>
	</div>
	<div v-else class="dt-kanban-core-wrap">
		<p v-if="moveError" class="dt-kanban-core-error">{{ moveError }}</p>

		<div v-if="!layout.length || layout.every((lane) => !lane.columns.length)" class="dt-empty">
			<DtIcon name="inbox" />
			<p class="dt-empty__line">
				{{ state.items.loading.value ? 'Loading…' : `No ${groupField.field} values to build columns from yet` }}
			</p>
		</div>

		<div v-else class="dt-kanban-core-lanes" :class="{ 'is-saving': saving, 'is-laned': laned }">
			<!--
				One lane per row when `lane_by` is set; otherwise a single implicit lane with no header
				and no background band, so the historical single-strip picture is byte-identical for
				every ui-view that never asked for lanes.
			-->
			<section
				v-for="lane in layout"
				:key="lane.value"
				class="dt-kanban-core-lane"
				:class="{ 'is-ungrouped': lane.ungrouped }"
			>
				<header v-if="laned" class="dt-kanban-core-lane-header">
					<span class="dt-kanban-core-lane-label">{{ lane.label }}</span>
					<span
						v-if="laneField"
						class="dt-kanban-core-lane-count"
						:title="`${lane.columns.reduce((n, c) => n + c.records.length, 0)} record(s) in this lane`"
					>{{ lane.columns.reduce((n, c) => n + c.records.length, 0) }}</span>
				</header>

				<div class="dt-kanban-core">
					<div
						v-for="col in lane.columns"
						:key="col.value"
						class="dt-kanban-core-col"
						:class="{ 'is-drop': dropTarget === `${lane.value}:${col.value}`, 'is-ungrouped': col.ungrouped }"
						@dragover.prevent="dropTarget = `${lane.value}:${col.value}`"
						@dragleave="dropTarget === `${lane.value}:${col.value}` && (dropTarget = null)"
						@drop.prevent="onDrop(col)"
					>
						<!-- Header is pinned: it sits outside `.dt-kanban-core-cards`, which is the scroll box. -->
						<div class="dt-kanban-core-header">
							<span class="dt-kanban-core-label">{{ col.label }}</span>
							<span class="dt-kanban-core-count">{{ col.records.length }}</span>
							<button
								v-if="!col.ungrouped"
								type="button"
								class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm dt-kanban-core-add"
								:title="`New record with ${groupField.field} = ${col.value}${laneField && !lane.ungrouped && lane.value !== '__all__' ? ` and ${laneField.field} = ${lane.value}` : ''}`"
								@click="addTo(lane, col)"
							>
								<DtIcon name="add" />
							</button>
						</div>
						<div class="dt-kanban-core-cards">
							<template v-for="r in col.records" :key="state.pkOf(r)">
								<!-- Insertion gap. Only rendered while a drag is live AND the list is sorted by the
								     collection's own position_field — otherwise a drop here would write a position the
								     operator cannot see take effect. `.stop` so the column's coarse drop does not
								     also fire. -->
								<div
									v-if="canReorder && dragging"
									class="dt-kanban-core-slot"
									:class="{ 'is-over': dropSlot === state.pkOf(r) }"
									@dragover.prevent="dropSlot = state.pkOf(r)"
									@dragleave="dropSlot === state.pkOf(r) && (dropSlot = null)"
									@drop.prevent.stop="onDropAt(col, r)"
								></div>
								<div
									class="dt-card dt-card--interactive dt-kanban-core-card"
									:class="{ 'dt-tinted': !!state.tintOf(r) }"
									:style="state.tintOf(r)"
									:data-vscode-context="rowContext(state.collection, state.pkOf(r))"
									draggable="true"
									@dragstart="onDragStart(r)"
									@dragend="onDragEnd"
									@click="state.openRecord(r)"
								>
									<!-- `context="record"`: a card wants the whole value, wrapped — cell semantics would
									     nowrap-and-clip it at the column edge (see DisplayTemplate's header). -->
									<DisplayTemplate
										v-if="cardTemplate"
										:template="cardTemplate"
										:record="r"
										:fields="state.fields.fields.value"
										context="record"
									/>
									<template v-else>
										<div class="dt-kanban-core-title">{{ state.recordTitleOf(r) }}</div>
										<div class="dt-kanban-core-id">{{ state.pkOf(r) }}</div>
									</template>
									<!-- the source mark in the card's footer row, never over its content (cr-vscode-004) -->
									<footer v-if="state.sourceOf?.(r) || state.stubOf?.(r)" class="dt-card-foot">
										<SourceMark v-if="state.sourceOf?.(r)" class="dt-kanban-core-source" v-bind="state.sourceOf?.(r)!" />
					<StubNote v-if="state.stubOf?.(r)" v-bind="state.stubOf?.(r)!" :sources="state.sourceFacets?.value" />
									</footer>
								</div>
							</template>
							<!-- The gap after the last card: dropping here means "bottom", which is a different
							     write from "before X" and the only way to reach the end of a column. -->
							<div
								v-if="canReorder && dragging"
								class="dt-kanban-core-slot dt-kanban-core-slot--end"
								:class="{ 'is-over': dropSlot === '__end__' }"
								@dragover.prevent="dropSlot = '__end__'"
								@dragleave="dropSlot === '__end__' && (dropSlot = null)"
								@drop.prevent.stop="onDropAt(col, null)"
							></div>
						</div>
					</div>
				</div>
			</section>
		</div>

		<p v-if="hiddenCount" class="dt-kanban-core-hint">
			{{ hiddenCount }} record{{ hiddenCount === 1 ? '' : 's' }} with no {{ groupField.field }} hidden — enable “Show
			ungrouped” in Layout options to see {{ hiddenCount === 1 ? 'it' : 'them' }}.
		</p>
		<p v-if="laneHiddenCount" class="dt-kanban-core-hint">
			{{ laneHiddenCount }} record{{ laneHiddenCount === 1 ? '' : 's' }} with no {{ laneField!.field }} lane hidden — enable
			“Show ungrouped lane” in Layout options to see {{ laneHiddenCount === 1 ? 'it' : 'them' }}.
		</p>
	</div>
</template>

<style scoped>
/* Full-height board (operator 2026-07-29). The chain that makes it work: the List declares
   `fillsHeight` in the registry → BrowseView hands its wrapper the page's leftover height → this
   wrap fills it → the strip fills the wrap → each column is stretched to the strip's height → the
   column's CARD LIST is the only scroll box. Nothing here uses a viewport-relative height or a
   magic offset, so the page padding above and below the board stays whatever --dt-page-pad is. */
.dt-kanban-core-wrap { display: flex; flex-direction: column; min-height: 0; height: 100%; }
/* The lanes container is the vertical scroll box when the board is laned; without lanes it is a
   single implicit lane (`is-laned` off) whose only child is a full-height `.dt-kanban-core`, so
   `overflow-y: auto` sees nothing to scroll and the historical layout is byte-identical. */
.dt-kanban-core-lanes { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dt-kanban-core-lanes.is-laned { overflow-y: auto; row-gap: 12px; }
.dt-kanban-core-lanes.is-saving { opacity: 0.6; pointer-events: none; }
/* A LANE is one horizontal band. Without a lane axis, the section carries no chrome and its
   `.dt-kanban-core` fills the space — the single-strip look. With one, the band gets a subtle
   background so the lanes read as rows rather than a run-on strip; `flex-shrink: 0` keeps each
   band its own scroll unit, and `min-height: 0` on the inner strip lets it manage horizontal
   overflow independently. */
.dt-kanban-core-lane { display: flex; flex-direction: column; min-height: 0; }
.dt-kanban-core-lanes.is-laned > .dt-kanban-core-lane {
	flex: 0 0 auto;
	padding: 8px 12px 12px;
	background: var(--dt-bg-subtle);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
}
.dt-kanban-core-lanes.is-laned > .dt-kanban-core-lane.is-ungrouped { border-style: dashed; }
.dt-kanban-core-lane-header {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 2px 4px 8px;
	font-size: var(--dt-label);
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
}
.dt-kanban-core-lane-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-kanban-core-lane-count {
	margin-left: auto;
	padding: 0 8px;
	border-radius: 999px;
	border: 1px solid var(--dt-border-strong);
	background: var(--dt-bg);
	font-size: var(--dt-label);
	font-weight: 600;
}
/* `align-items: stretch` (the default, restored from `flex-start`) is what makes the columns
   equal-height instead of shrink-to-content. */
.dt-kanban-core { display: flex; align-items: stretch; gap: 16px; overflow-x: auto; flex: 1 1 auto; min-height: 0; }
/* When lanes are on, each band's column strip is a fixed-height row rather than the full page
   — the outer `.dt-kanban-core-lanes` scrolls vertically between bands, and the columns inside
   scroll their cards independently. `min-height` picks a number tall enough for 3–4 cards and
   the header pinned above them; a shorter number produces a strip that looks broken. */
.dt-kanban-core-lanes.is-laned .dt-kanban-core {
	flex: 0 0 auto;
	min-height: 260px;
}
/* `min-width: 0` is load-bearing, not defensive tidying: a flex item's automatic minimum size is
   its MIN-CONTENT width, so a card whose text can't be shrunk drags the whole column past its
   270px basis. The pre-template card got away without it because its title div carried
   `overflow: hidden` (which contributes no min-content) — the inline display template does not, and
   columns rendered ~700px wide until this line existed. Measured in the dev host, 2026-07-29. */
.dt-kanban-core-col { flex: 0 0 270px; min-width: 0; display: flex; flex-direction: column; min-height: 0; background: var(--dt-bg-subtle); border: 1px solid var(--dt-border); border-radius: var(--dt-radius); padding: 10px; transition: border-color 0.1s; }
.dt-kanban-core-col.is-drop { border-color: var(--dt-accent); }
/* Insertion gaps. Nearly invisible until hovered — they exist only during a drag, and a permanent
   4px band between every card would read as a layout bug rather than as a target. */
.dt-kanban-core-slot { height: 8px; margin: -2px 0; border-radius: 2px; }
.dt-kanban-core-slot--end { height: 24px; }
.dt-kanban-core-slot.is-over { background: var(--dt-accent); height: 3px; margin: 0.5rem 0; }
/* The ungrouped bucket is a real column but not a real value — a dashed edge says "dropping here
   clears the field" without needing a label to explain it. */
.dt-kanban-core-col.is-ungrouped { border-style: dashed; }
/* `flex: 0 0 auto` — the header never shrinks and never scrolls away. */
.dt-kanban-core-header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 2px 0 10px 4px; font-size: var(--dt-label); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dt-fg-subtle); }
.dt-kanban-core-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-kanban-core-count { margin-left: auto; padding: 0 8px; border-radius: 999px; border: 1px solid var(--dt-border-strong); background: var(--dt-bg); font-size: var(--dt-label); font-weight: 600; }
/* Always present (it is an affordance, not an easter egg), but quiet: a ghost icon button that
   comes up to full strength on column hover so it never competes with the page header's own
   accent-filled create action. */
.dt-kanban-core-add { flex: 0 0 auto; opacity: 0.5; transition: opacity 0.1s; }
.dt-kanban-core-col:hover .dt-kanban-core-add,
.dt-kanban-core-add:hover,
.dt-kanban-core-add:focus-visible { opacity: 1; }
/* THE scroll box: cards scroll inside the column, header pinned above (operator ask). `overflow-x:
   hidden` so a wide card can't produce a second horizontal scrollbar inside the strip's own. */
.dt-kanban-core-cards { flex: 1 1 auto; min-height: 24px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
/* The card's chrome (background/border/radius/padding/hover/`overflow-wrap: anywhere`) is the shared
   `.dt-card .dt-card--interactive` utility as of 2026-07-31 — the card grid wears the same one, so
   the two cards in this app are one surface. Two notes on what moved:
   - the hover shadow is now `var(--dt-shadow)`, which vscode.css sets to `none`; inside VS Code the
     hover is the border-color change alone, which is that theme's deliberate no-shadow posture (the
     hardcoded `0 2px 8px` this line used to carry was opting out of it by accident).
   - `flex: 0 0 auto` STAYS here: it is board-specific and load-bearing. In a column flex box with a
     CONSTRAINED height, items shrink to fit BEFORE the container's `overflow-y` ever scrolls — so
     cards silently lost their last line (measured 2026-07-29, "…before the Aug 10 workshop" clipped
     mid-word). Refusing to shrink is what turns the overflow into a scroll. The card grid's cards
     sit in a grid with no such constraint and need none of it. */
.dt-kanban-core-card { flex: 0 0 auto; position: relative; }
/* the footer row a card read from another root carries its mark in — in flow, last (cr-vscode-004) */
.dt-card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; padding-top: 6px; font-size: var(--dt-label); min-width: 0; }
/* wrap, never shrink — a mark and a stub note side by side otherwise drew over each other */
.dt-card-foot > * { flex-shrink: 0; max-width: 100%; overflow: hidden; }
.dt-kanban-core-title { overflow: hidden; text-overflow: ellipsis; }
.dt-kanban-core-id { margin-top: 4px; font-size: var(--dt-label); color: var(--dt-fg-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Error and hint sit OUTSIDE the scroll strip — `flex: 0 0 auto` so they never eat the board's
   height, and the board shrinks by exactly their height when they appear. */
.dt-kanban-core-error { flex: 0 0 auto; margin: 0 0 10px; color: var(--dt-danger); font-size: var(--dt-text); }
.dt-kanban-core-hint { flex: 0 0 auto; margin: 10px 0 0; color: var(--dt-fg-subtle); font-size: var(--dt-label); }
</style>
