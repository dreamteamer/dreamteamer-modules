<!--
	Tabular browse layout: a thin renderer over `composables/browse-state.ts`'s `BrowseState`
	(phase E). Pre-E, this component owned ALL browse state directly (fields/items/search/filter/
	columns/sort/pagination) — that state moved up into `useBrowseState`, owned once by
	ContentBrowse, so a table ↔ cards layout toggle (ListCards is the other renderer over the
	exact same `BrowseState`) never re-fetches or re-derives anything, and the toolbar/footer/
	filter-builder markup that used to live here moved up to ContentBrowse alongside it (a single
	toolbar has to sit above whichever layout is mounted, not duplicate itself inside each one).

	Refetch-on-focus (spec §2.6: agents keep editing the same files outside the browser) still
	lives here rather than in the composable — it's a per-mounted-view concern (ListCards has its
	own copy), not shared state.

	Browse-restyle (BROWSE wave): `.dt-table` styling now comes entirely from the frozen shared
	`base.css` utility (48px rows, sortable header arrows, `.is-selected` accent-subtle highlight,
	`.dt-table__checkbox-col`) — no more locally-scoped colors/spacing duplicating it. Adds the
	checkbox column (batch selection, `state.selectedIds`/`toggleSelect`/`toggleSelectAllVisible`
	from browse-state.ts) and `.dt-empty` for the loading/empty states, per the spec browse
	conventions. That selection also rides along in each row's `data-vscode-context`, so the native
	row menu's Copy Path / Copy Relative Path act on every selected record, not just the one clicked.

	Fixed frame (2026-08-08, operator: header incl. columns and the footer pager static, the
	vertical scroll area only the data rows). The List declares `fillsHeight` in the registry, so
	BrowseView hands `.dt-table-scroll` the page's leftover height and the PAGE stops scrolling
	vertically; `<thead th>` is `position: sticky` against that box. One scroll box, not two stacked
	tables: a split header/body table needs its column widths synchronised by hand (or a `<colgroup>`
	fixed layout), and this table's widths are content-derived. It also keeps the horizontal axis
	shared — scrolling right moves the header with the rows, which is what "horizontal scroll stays
	global" asks for. Everything is flex/percentage, nothing measured in JS, so a window resize just
	relays out.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { FieldRow } from '../api/types';
import type { BrowseState } from '../composables/browse-state';
import { labelOf } from '../lib/format-title';
import { DUPLICATES_FIELD } from '../lib/sources';
import { bucketize, type Bucket } from '../lib/grouping';
import { rowContext } from '../lib/vscode-context';
import { fileBases } from '../lib/file-record';
import { computedReason, isReferenceField } from '../lib/field-row';
import { initialsOf } from '../lib/initials';
import { resolveRowSize, tableDensityClass } from '../lib/row-size';
import RenderView from './render/RenderView.vue';
import GroupHeader from './browse/GroupHeader.vue';
import DtIcon from './DtIcon.vue';
import NoteMark from './NoteMark.vue';
import { notesOfRow } from '../lib/next-notes';

const props = defineProps<{ state: BrowseState }>();

// Registered as the built-in `table` List (spec §8). BrowseView renders it via the lists registry
// and also passes the module-List prop set (collection/query/options); this built-in
// only consumes `state`, so drop attr inheritance to keep the ignored props off the root element.
defineOptions({ inheritAttrs: false });

/** Bundle-layered core: `$bundle` names the dependency bundle that supplied the record
 * (`''` = local). Non-empty values get a small chip next to the first column's value. */
function bundleOf(record: Record<string, unknown>): string {
	const value = record['$bundle'];
	return typeof value === 'string' ? value : '';
}

function onFocus(): void {
	void props.state.items.reload();
}
onMounted(() => window.addEventListener('focus', onFocus));
onUnmounted(() => window.removeEventListener('focus', onFocus));

// ---- grouping (0.12.0) ------------------------------------------------------------------------
/**
 * A field's `width` (descriptor v2 §3.4.2) is a LIST column hint in characters: the column is at
 * least that wide, and still grows with its content — the table's widths are content-derived, and
 * a hint that clipped a long value would hide data to honour a guess.
 */
function columnStyle(field: FieldRow): Record<string, string> | undefined {
	return typeof field.width === 'number' && field.width > 0 ? { minWidth: `${field.width}ch` } : undefined;
}

// The Monday shape: one `<tbody>` per value, each with a header row carrying the glyph, the label
// and a count, and its own rows beneath. `<tbody>` is not a styling trick here — a table may have
// many of them, which is exactly what a band IS, so the bands need no wrapper and the columns stay
// aligned across all of them for free.
const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['table'] ?? {});

/** Only ever resolved from the option, never inferred. An empty option, or a named field this
 *  collection does not carry, both mean "not grouped" — a typo in a ui-view must not erase the
 *  table, the same posture the kanban already takes for its own axes. */
const groupField = computed(() => {
	const named = options.value['group_by'];
	if (typeof named !== 'string' || !named.length) return null;
	return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? null;
});

// Not gated on `ungroupedAllowed` the way the kanban gates its own: that gate exists because a
// kanban column is a DROP TARGET and a required field cannot be cleared, so offering the column
// would be a lie. A table band accepts nothing, so the only question is whether to show the records.
const showUngrouped = computed(() => options.value['show_ungrouped_rows'] === true);
// Empty BANDS are hidden unless asked for — a band is not a drop target, so an empty one is only
// distance between the reader and the work (operator, 2026-09-07).
const showEmpty = computed(() => options.value['show_empty_rows'] === true);

/**
 * The bands to render. With no group field this is ONE implicit band holding every record, drawn
 * with no header — byte-identical to the table that existed before grouping, which is the property
 * every ungrouped view depends on.
 */
const bands = computed<Bucket[]>(() => {
	const records = props.state.items.items.value;
	if (!groupField.value) return [{ value: '', label: '', records }];
	return bucketize(groupField.value, records, { showUngrouped: showUngrouped.value, showEmpty: showEmpty.value });
});

const grouped = computed(() => groupField.value !== null);

// ---- row density (`row_size`) ----------------------------------------------------------------
// Resolved from the table's option slice alone — toolbar over view over collection is already how
// that slice is built — and handed to the stylesheet as ONE class. Every number a density changes
// is a CSS rule under that class, below; nothing here measures anything.
const rowSize = computed(() => resolveRowSize(options.value));
const densityClass = computed(() => tableDensityClass(rowSize.value));

/** The column that names the record (`state.titleField`, off the collection's `record_title`) —
 *  weighted in the comfortable density so a row reads picture · name · details. */
const titleField = computed<string | null>(() => props.state.titleField?.value ?? null);

/**
 * Is the LEADING column a reference to a `codec: file` collection — a picture, by the host's
 * injected list and never by a collection's name (decision 268)? Only then does an EMPTY value in
 * the comfortable density draw an initials disc instead of the dash: the title is already in the
 * row, so it costs nothing, and a contacts list with a hole where a face should be reads as broken.
 */
const leadIsPicture = computed(() => {
	const lead = props.state.columns.value[0];
	if (!lead || !isReferenceField(lead)) return false;
	const target = props.state.fields.relationTargets?.value?.get(lead.field);
	return !!target && fileBases().some((base) => base.collection === target);
});

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** An id MORE THAN ONE root holds (`$duplicates`, host `duplicateIds`): the first-named root's copy is
 *  the one read, the rest are `check`'s violation — said on the row, naming both, rather than left
 *  for the operator to find when a write to it is refused. */
function duplicateNote(record: Record<string, unknown>): string {
	const roots = record[DUPLICATES_FIELD];
	if (!Array.isArray(roots) || roots.length < 2) return '';
	return `held by both ${roots.join(' and ')} — ${roots[0]}'s copy is the one read; dreamteamer check names the files`;
}

/** Draw initials in this cell rather than its View: comfortable · leading picture column · no value. */
function showInitials(index: number, value: unknown): boolean {
	return rowSize.value === 'comfortable' && index === 0 && leadIsPicture.value && isEmpty(value);
}

// Collapse is per-band and deliberately EPHEMERAL — it lives as long as the mounted table and is not
// persisted into the view. A saved view that reopened with three bands shut would read as missing
// data, which is the failure a collapse control is supposed to prevent.
const collapsed = ref(new Set<string>());
function toggleBand(value: string): void {
	const next = new Set(collapsed.value);
	if (!next.delete(value)) next.add(value);
	collapsed.value = next;
}
</script>

<template>
	<div class="dt-table-scroll">
		<table class="dt-table" :class="densityClass">
			<thead>
				<tr>
					<th class="dt-table__checkbox-col">
						<input type="checkbox" class="dt-checkbox" :checked="state.allVisibleSelected.value" aria-label="Select all" @change="state.toggleSelectAllVisible" />
					</th>
					<th
						v-for="field in state.columns.value"
						:key="field.field"
						class="dt-th"
						:class="{ 'dt-computed': computedReason(field, { create: false }) !== null }"
						:title="field.description || computedReason(field, { create: false }) || undefined"
						:style="columnStyle(field)"
						@click="state.items.setSort(field.field)"
					>
						<!-- the engine-resolved title (an authored `title`, else the title-cased name) — a
     `$source` column has no name worth title-casing -->
<span class="dt-th-label">{{ labelOf(field) }}</span>
						<DtIcon v-if="state.sortIndicator(field.field)"  class="dt-th-sort-icon" :name="state.sortIndicator(field.field) === 'asc' ? 'arrow-up' : 'arrow-down'" />
					</th>
				</tr>
			</thead>
			<!-- Stale-while-revalidate: current rows stay put during a refetch (the pager shows the
			     activity — BrowseView's footer spinner); the tall .dt-empty loading block renders on
			     FIRST load only, so filtering/sorting/paging never shifts the layout. -->
			<!-- Loading and empty are NOT per band: they are statements about the whole result set, and
			     repeating "No records yet" under six headers would read as six problems. -->
			<tbody v-if="state.items.loading.value && !state.items.items.value.length">
				<tr>
					<td :colspan="state.columns.value.length + 1">
						<div class="dt-empty">
							<DtIcon name="loading" />
							<p class="dt-empty__line">Loading…</p>
						</div>
					</td>
				</tr>
			</tbody>
			<tbody v-else-if="!state.items.loading.value && !state.items.items.value.length">
				<tr>
					<td :colspan="state.columns.value.length + 1">
						<div class="dt-empty">
							<DtIcon name="inbox" />
							<p class="dt-empty__line">{{ state.hasActiveQuery.value ? 'No records match your search/filters' : 'No records yet' }}</p>
							<button v-if="!state.hasActiveQuery.value && !state.items.unavailable?.value" type="button" class="dt-btn dt-btn--sm" @click="state.createRecord()">Create record</button>
						</div>
					</td>
				</tr>
			</tbody>
			<!-- ONE tbody per band. Ungrouped, `bands` is a single implicit band with no header, so
			     this loop renders exactly the table that existed before grouping. -->
			<tbody
				v-for="band in bands"
				v-else
				:key="band.value"
				:class="{ 'is-revalidating': state.items.loading.value && state.items.items.value.length }"
			>
				<tr v-if="grouped" class="dt-group-row">
					<td :colspan="state.columns.value.length + 1" class="dt-group-cell">
						<div class="dt-group-band">
							<button
								type="button"
								class="dt-group-toggle"
								:aria-expanded="!collapsed.has(band.value)"
								:title="collapsed.has(band.value) ? 'Expand' : 'Collapse'"
								@click="toggleBand(band.value)"
							>
								<DtIcon :name="collapsed.has(band.value) ? 'chevron-right' : 'chevron-down'" />
							</button>
							<GroupHeader
								:label="band.label"
								:count="band.records.length"
								:description="band.description"
								:icon="band.icon"
								:color="band.color"
								:background="band.background"
							/>
						</div>
					</td>
				</tr>
				<tr
					v-for="record in collapsed.has(band.value) ? [] : band.records"
					:key="state.pkOf(record)"
					class="dt-row"
					:class="{ 'is-selected': state.isSelected(state.pkOf(record)), 'dt-tinted': !!state.tintOf(record) }"
					:style="state.tintOf(record)"
					:data-vscode-context="rowContext(state.collection, state.pkOf(record), state.selectedIds.value)"
					@click="state.openRecord(record)"
				>
					<td class="dt-table__checkbox-col" @click.stop>
						<input type="checkbox" class="dt-checkbox" :checked="state.isSelected(state.pkOf(record))" @change="state.toggleSelect(state.pkOf(record))" />
					</td>
					<!-- `dt-td--lead` is the row's FIRST column (where a picture leads, the picture) and
					     `dt-td--title` the column that names the record — both inert until the comfortable
					     density's rules read them. -->
					<td
						v-for="(field, index) in state.columns.value"
						:key="field.field"
						:class="{ 'dt-td--lead': index === 0, 'dt-td--title': field.field === titleField }"
					>
						<span class="dt-cell">
							<span
								v-if="showInitials(index, record[field.field])"
								class="dt-avatar-fallback"
								:title="state.recordTitleOf(record)"
								aria-hidden="true"
							>{{ initialsOf(state.recordTitleOf(record)) }}</span>
							<RenderView v-else :field="field" :value="record[field.field]" :record="record" />
							<span v-if="index === 0 && duplicateNote(record)" class="dt-dup-badge" :title="duplicateNote(record)" role="img" aria-label="duplicate id">
								<DtIcon name="warning" />
							</span>
							<NoteMark v-if="index === 0 && notesOfRow(record).length" :notes="notesOfRow(record)" />
							<span v-if="index === 0 && bundleOf(record)" class="dt-bundle-chip" :title="`Supplied by the '${bundleOf(record)}' bundle`">
								{{ bundleOf(record) }}
							</span>
						</span>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
/* A band header spans the whole table and sticks under the column header, so scrolling a long band
   keeps its name in view — the same reason `thead th` is sticky. `top` is the header's height. */
.dt-group-row td {
	padding: 0;
	background: var(--dt-bg);
	position: sticky;
	top: 34px;
	z-index: 1;
}
.dt-group-band {
	display: flex;
	align-items: center;
	gap: 2px;
}
.dt-group-toggle {
	display: flex;
	align-items: center;
	background: none;
	border: 0;
	padding: 4px 2px 4px 8px;
	cursor: pointer;
	color: var(--dt-fg-subtle);
}
.dt-group-toggle:hover {
	color: var(--dt-fg);
}

/* The scroll box. `flex: 1; min-height: 0` comes from BrowseView's `.dt-browse-list--fill > *`
   (the fillsHeight chain), so this is only responsible for scrolling — both axes, one box, so the
   header travels with the rows horizontally while staying put vertically. */
.dt-table-scroll {
	overflow: auto;
}

/* Sticky against `.dt-table-scroll`, NOT against the page — which is exactly why this List had to
   declare `fillsHeight`. `border-collapse: collapse` (base.css) drops the cell's own border once
   it's sticky, since the collapsed border belongs to the table's grid rather than to the <th>; an
   inset shadow paints in the same place and does travel with the header. The background has to be
   opaque or rows scroll through it — base.css leaves thead transparent. */
.dt-table thead th {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--dt-bg);
	border-bottom: none;
	box-shadow: inset 0 -1px 0 var(--dt-border-strong);
}

.dt-th {
	cursor: pointer;
	user-select: none;
}

.dt-th-label {
	vertical-align: middle;
}

.dt-th-sort-icon {
	/* the global .codicon rule sizes it — this had been a hardcoded 14px that
	   the token sweep turned into text size, leaving one 13px glyph among 16px ones */
	font-size: var(--dt-icon);
	vertical-align: middle;
	margin-left: 2px;
}

.dt-row {
	cursor: pointer;
}

/* Every cell's content sits on the row's vertical centre, in every density. A table cell is middle
   by the UA sheet, but only while nothing inside it is taller than the line — a picture, a wrapped
   list — so it is stated here where the densities below rely on it. */
.dt-table tbody td {
	vertical-align: middle;
}

.dt-cell {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 100%;
}

/* ---- row density (`row_size`) ----
   One class on the table, every number under it. `--dt-row-height` is the token base.css sizes a
   row by, so a density is a re-declaration of that token at table scope: cozy restates the default
   (today's 30px) and is therefore byte-identical to the table before the option existed. */
.dt-table--compact {
	--dt-row-height: 26px;
}
.dt-table--cozy {
	--dt-row-height: 30px;
}
.dt-table--comfortable {
	--dt-row-height: 64px;
}

/* Compact: one line per row, however long a value runs — the density exists to fit more rows on a
   screen, and a wrapped cell would hand that back. A picture is capped at 20px so it never grows the
   row past the token. */
.dt-table--compact .dt-cell {
	display: flex;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dt-table--compact .dt-cell :deep(.dt-display-file),
.dt-table--compact .dt-cell :deep(.dt-display-image) {
	height: 20px;
	max-height: 20px;
}

/* Comfortable: a contacts list. A leading picture is a 48px box — a circle when the picture is
   square-ish (`dt-display-file--square`, decided by the image's own natural size on load), a rounded
   box that keeps a wordmark's aspect otherwise — the title column carries the weight, every other
   column steps back to the description colour, and a picture anywhere else is capped at 32px so
   nothing grows the row past its 64px. */
.dt-table--comfortable .dt-td--lead .dt-cell :deep(.dt-display-file),
.dt-table--comfortable .dt-td--lead .dt-cell :deep(.dt-display-image) {
	width: 48px;
	height: 48px;
	max-width: 48px;
	object-fit: contain;
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	vertical-align: middle;
}
.dt-table--comfortable .dt-td--lead .dt-cell :deep(.dt-display-file--square),
.dt-table--comfortable .dt-td--lead .dt-cell :deep(.dt-display-image--square) {
	object-fit: cover;
	border-radius: 50%;
}
.dt-table--comfortable td:not(.dt-td--lead) .dt-cell :deep(.dt-display-file),
.dt-table--comfortable td:not(.dt-td--lead) .dt-cell :deep(.dt-display-image) {
	height: 32px;
	max-height: 32px;
}
.dt-table--comfortable .dt-td--title .dt-cell {
	font-weight: 600;
}
.dt-table--comfortable td:not(.dt-td--title):not(.dt-td--lead) {
	color: var(--dt-fg-subtle);
}

/* A leading picture that is missing, in the comfortable density: the record's initials on a disc,
   so the column keeps its rhythm. Only drawn when the column IS a picture column (see
   `leadIsPicture`); any other empty cell keeps its dash. */
.dt-avatar-fallback {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 48px;
	height: 48px;
	flex-shrink: 0;
	border-radius: 50%;
	border: 1px solid var(--dt-border);
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
	font-size: 15px;
	font-weight: 600;
	letter-spacing: 0.02em;
	user-select: none;
}

.dt-dup-badge {
	flex-shrink: 0;
	display: inline-flex;
	color: var(--dt-warning);
}
.dt-dup-badge .codicon {
	font-size: var(--dt-icon);
}

.dt-bundle-chip {
	flex-shrink: 0;
	padding: 0 6px;
	border-radius: 999px;
	border: 1px solid color-mix(in srgb, var(--dt-accent) 30%, transparent);
	background: color-mix(in srgb, var(--dt-accent) 10%, transparent);
	color: var(--dt-accent);
	font-size: var(--dt-label);
	line-height: 16px;
	white-space: nowrap;
}

tbody.is-revalidating {
	opacity: 0.55;
	transition: opacity 0.15s ease 0.15s; /* small delay so fast refetches never visibly flicker */
	pointer-events: none;
}
</style>
