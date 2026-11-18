<!--
	Gantt browse List: one horizontal bar per record, from a start date to an end date, on a shared
	time axis — with the rows carved into the SAME bands the table, the cards and the kanban draw
	(`lib/grouping.ts`, `components/browse/GroupHeader.vue`). Grouping is one concept named for the
	axis; a fourth layout with a fourth answer is exactly what that concept exists to prevent.

	Zero new dependencies: a CSS grid whose columns are days, and nothing else. No chart library, no
	canvas, no measured layout — a bar is a grid item spanning `grid-column: <day> / span <days>`,
	which is why a window resize costs nothing and the header ticks can never drift out of alignment
	with the bars beneath them.

	⚠ THE AXIS ITSELF LIVES IN `lib/gantt-axis.ts` — day-number maths, the automatic scale, and the
	FOLDING of runs in which nothing starts or ends. It is a pure function of two day numbers per
	bar, it has no Vue and no record in it, and its own header carries the whole argument: why the
	grid stopped being a uniform `repeat()`, why the threshold is read at the RAW scale, and why
	snapping inward removes the need for a padding constant. Read that before changing any of this.

	THREE THINGS WORTH KNOWING BEFORE CHANGING WHAT IS LEFT:

	· A BAR IS PLACED BY GRID LINES, `columnOf(start) / columnOf(end) + 1`, and never by `span n`:
	  past a fold a span count is no longer a day count. A bar crossing a fold covers the fold's own
	  column, which is what draws it unbroken through the time nobody needed to see.

	· A RECORD WITH NO START IS NOT DROPPED. It is listed in the undated tail beneath the chart, with
	  a count. This is the one layout where a record can be invisible for a legitimate reason, and an
	  invisible record with no explanation reads as data loss.

	· AN END BEFORE ITS START IS DRAWN, NOT HIDDEN. It becomes a point at the start carrying
	  `dt-gantt-bar--inverted` and a tooltip saying so — the picture is how you find the typo.

	The colour axis is optional (`color_by`, the view's option else the collection's own
	`display.record.color_by`): a value's own enum colour when the engine projected one, otherwise a stable slot from a small `--vscode-charts-*` palette. Theme colour
	ids, never hex — a hex is authored against one theme and wrong in the other.
-->
<script setup lang="ts">
import { themeColor } from '../lib/collection-display';
import { computed, ref, watchEffect } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import type { FieldRow, ItemRecord } from '../api/types';
import { bucketize, declaredChoicesOf, type Bucket } from '../lib/grouping';
import {
	bandRuns,
	buildAxis,
	rangeLabel,
	dateOf,
	dayKeyOf,
	dayNumber,
	DAY_PX,
	MONTHS,
	todayNumber,
	type AxisSpan,
} from '../lib/gantt-axis';
import { labelFor, useGroupLabels } from '../lib/group-label';
import { tryRenderDisplay } from '../lib/template';
import { titleOf } from '../lib/record-title';
import { rowContext } from '../lib/vscode-context';
import GroupHeader from '../components/browse/GroupHeader.vue';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{ state: BrowseState }>();

// Same posture as every other built-in List: BrowseView also hands over the module prop set
// (collection/query/options), which this one ignores, so keep it off the root element.
defineOptions({ inheritAttrs: false });

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['gantt'] ?? {});

function namedField(key: string): FieldRow | null {
	const named = options.value[key];
	if (typeof named !== 'string' || !named.length) return null;
	return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? null;
}

// ── the two ends of a bar ────────────────────────────────────────────────────────────────────────
// `start` blank really IS automatic — first `date`, then `timestamp`, the same fallback the
// calendar makes, so a collection with any date at all draws something. `end` blank is NOT:
// it means every record is a point. Inferring an end would invent durations nobody authored.
const startField = computed<FieldRow | null>(() => {
	const named = namedField('start');
	if (named) return named;
	const fields = props.state.fields.visibleFields.value;
	return fields.find((f) => f.type === 'date') ?? fields.find((f) => f.type === 'datetime') ?? null;
});
const endField = computed<FieldRow | null>(() => namedField('end'));

interface Span {
	record: ItemRecord;
	title: string;
	startKey: string;
	endKey: string | null;
	start: number;
	/** Inclusive last day of the bar. Equals `start` for a point AND for an inverted pair. */
	end: number;
	inverted: boolean;
}

/** Records that can be placed, in the order the server returned them. */
const spans = computed<Span[]>(() => {
	const sf = startField.value;
	if (!sf) return [];
	const ef = endField.value;
	const out: Span[] = [];
	for (const record of props.state.items.items.value) {
		const startKey = dayKeyOf(record[sf.field]);
		if (!startKey) continue;
		const endKey = ef ? dayKeyOf(record[ef.field]) : null;
		const start = dayNumber(startKey);
		const end = endKey ? dayNumber(endKey) : start;
		const inverted = end < start;
		out.push({
			record,
			title: titleOf(record) || String(record['id'] ?? ''),
			startKey,
			endKey,
			start,
			end: inverted ? start : end,
			inverted,
		});
	}
	return out;
});

const spanOf = computed<Map<ItemRecord, Span>>(() => new Map(spans.value.map((s) => [s.record, s])));

/** Everything the chart cannot place — kept, counted and named, never quietly dropped. */
const undated = computed<ItemRecord[]>(() => {
	const placed = spanOf.value;
	return props.state.items.items.value.filter((r) => !placed.has(r));
});

// ── the axis ─────────────────────────────────────────────────────────────────────────────────────
// All of it — scale, ticks, folds, and the day → column map — comes out of `lib/gantt-axis.ts`. The
// only thing this file decides is WHICH runs the reader has opened.

// ⚠ FOLDS START FOLDED, and that is the DEFAULT rather than an opt-in — the same argument the band
// collapse below makes, one axis over. A year-long plan spends most of its width on months in which
// nothing starts and nothing ends, and the shape of the year is the one thing that width hides.
// `fold_gaps: false` restores the uniform axis per view.
//
// No introduced-once guard is needed here (unlike `collapsed`): the default is the EMPTY set, so a
// changing record set re-derives the folds and reopens nothing behind the reader's back. A run the
// reader opened keeps its key for as long as the run still begins on the same day.
const foldGaps = computed<boolean>(() => options.value['fold_gaps'] !== false);
const expanded = ref(new Set<string>());
function toggleFold(key: string): void {
	const next = new Set(expanded.value);
	if (!next.delete(key)) next.add(key);
	expanded.value = next;
}

const today = todayNumber();

const axis = computed(() =>
	buildAxis(spans.value as readonly AxisSpan[], {
		today,
		fold: foldGaps.value,
		expanded: expanded.value,
	}),
);

/** One string, shared by the header and every row, so the two grids are the same grid by definition.
 *  It is no longer a single `repeat()` — a fold contributes one narrow column of its own. */
const gridTemplate = computed(() => axis.value?.template ?? 'var(--dt-gantt-day)');

/** Today's own offset, absent when it falls outside the drawn window (the common case for a finished
 *  project, and drawing a marker off the edge would be a lie about the scroll). It can never land
 *  inside a fold: today is a boundary, so the axis never folds a run containing it. */
const todayOffset = computed<string | null>(() => {
	const a = axis.value;
	if (!a) return null;
	return today >= a.origin && today < a.origin + a.days ? a.offsetOf(today) : null;
});

/** A fold's own left offset, for the full-height strip. One absolutely-placed element per fold over
 *  the whole canvas rather than one cell per fold PER ROW — four elements instead of four hundred,
 *  and the same mechanism the today marker already uses. */
const foldOffset = (firstDay: number): string => axis.value!.offsetOf(firstDay);

// ── colour ───────────────────────────────────────────────────────────────────────────────────────
// Theme colour IDS, resolved to `var(--vscode-…)` exactly as GroupHeader does it. A colour the
// field's enum map declares always wins; everything else takes a slot from this palette, assigned in a
// stable order (declared choices first, then the values the data carries) and skipping any colour a
// declared choice already claimed — so two values never collide while there are colours left.
const PALETTE = ['charts.blue', 'charts.green', 'charts.orange', 'charts.purple', 'charts.red', 'charts.yellow'];

// The browse state's `colorBy`: this view's `color_by` option, else the collection's own
// `display.record.color_by` — the same field that tints a table row and a card.
const colorField = computed<FieldRow | null>(() => {
	const name = props.state.colorBy.value;
	return name ? (props.state.fields.visibleFields.value.find((f) => f.field === name) ?? null) : null;
});

const colorMap = computed<Map<string, string>>(() => {
	const map = new Map<string, string>();
	const field = colorField.value;
	if (!field) return map;

	const claimed = new Set<string>();
	const choices = declaredChoicesOf(field);
	for (const choice of choices) {
		const declared = choice.color ?? choice.background;
		if (declared) {
			map.set(choice.value, declared);
			claimed.add(declared);
		}
	}
	const free = PALETTE.filter((c) => !claimed.has(c));
	const pool = free.length ? free : PALETTE;

	const pending: string[] = [];
	const consider = (value: string): void => {
		if (!value || map.has(value) || pending.includes(value)) return;
		pending.push(value);
	};
	for (const choice of choices) consider(choice.value);
	for (const record of props.state.items.items.value) {
		const raw = record[field.field];
		for (const value of Array.isArray(raw) ? raw : [raw]) {
			if (value !== null && value !== undefined && value !== '') consider(String(value));
		}
	}
	// ⚠ PAST THE PALETTE, STOP COLOURING RATHER THAN REPEAT. `i % pool.length` gave the seventh
	// distinct value the SAME colour as the first — two unrelated lanes rendered identically, with
	// nothing saying so. A colour axis that repeats is not a colour axis; it is a lie that looks
	// like one, and on a field with any real cardinality it is the normal case rather than the edge.
	//
	// The palette is theme colour IDS, never hex (a hex is authored against one theme and wrong in
	// the other), so it cannot simply be made longer. So the values that fit are coloured and the
	// rest are left NEUTRAL — one shared no-colour, which honestly means "not individually
	// coloured", and `uncoloured` below lets the view say how many.
	pending.slice(0, pool.length).forEach((value, i) => map.set(value, pool[i]!));
	return map;
});

/** How many distinct values the palette could not give a colour of their own. 0 is the normal case;
 *  anything else is worth telling the reader, because those bars are all the same neutral. */
const uncoloured = computed<number>(() => {
	const field = colorField.value;
	if (!field) return 0;
	const seen = new Set<string>();
	for (const record of props.state.items.items.value) {
		const raw = record[field.field];
		for (const value of Array.isArray(raw) ? raw : [raw]) {
			if (value !== null && value !== undefined && value !== '') seen.add(String(value));
		}
	}
	for (const choice of declaredChoicesOf(field)) if (choice.value) seen.add(choice.value);
	return Math.max(0, seen.size - colorMap.value.size);
});

function barStyle(span: Span): Record<string, string> {
	const a = axis.value!;
	// ⚠ GRID LINES, not `span <days>`. Past a fold the two disagree, and a bar sized by a day count
	// would run off the end of the grid by however many days the folds swallowed.
	const style: Record<string, string> = {
		gridColumn: `${a.columnOf(span.start)} / ${a.columnOf(span.end) + 1}`,
	};
	const field = colorField.value;
	if (field) {
		const raw = span.record[field.field];
		const value = Array.isArray(raw) ? raw.find((v) => v !== null && v !== undefined && v !== '') : raw;
		const id = value === null || value === undefined || value === '' ? null : colorMap.value.get(String(value));
		if (id) style['--dt-gantt-bar'] = themeColor(id);
	}
	return style;
}

// ── the label that rides in the timeline ─────────────────────────────────────────────────────────
// The gutter is sticky and 180px, which makes it a good SCANNING column and a bad reading one — a
// title longer than about 24 characters is an ellipsis there, and the chart beside it is mostly
// empty. So the text is drawn again in the timeline, where the room is: INSIDE the bar when the bar
// is wide enough to hold it, immediately to its right when it is not.
//
// ⚠ The two are not redundant. The gutter answers "which rows are these" at a glance and never
// scrolls away; the bar label answers "what is this one" without a tooltip. A point-sized bar has no
// interior at all, so a label that only ever rendered inside would be invisible on exactly the
// records that need it most.
/** Roughly the narrowest bar that can hold readable text plus its own padding. */
const LABEL_FITS_PX = 72;

const labelField = computed<FieldRow | null>(() => namedField('bar_label'));

/** The view's own bar template. Named `template` to match the cards and the kanban, where the same
 *  option means the same thing — configuring one board should teach the other. */
const barTemplate = computed<string | null>(() => {
	const t = options.value['template'];
	return typeof t === 'string' && t.trim().length ? t : null;
});

/**
 * What the bar says, in three tiers: the view's `template` rendered against the record · a single
 * named `bar_label` · the record's own title.
 *
 * ⚠ Plain text, not markdown, and that is not an oversight. `components/render/DisplayTemplate.vue`
 * renders a template as markdown with each token through its own View, which is right for a CARD —
 * a block of prose with a status chip in it. A bar label is ONE LINE inside a 16px rounded
 * rectangle that may be three pixels wide; a chip, an image or a `<p>` there is not a smaller card,
 * it is a broken bar. So this path takes the same syntax and the same parser (`lib/template.ts`,
 * the only `{{ … }}` parser) and stringifies — one syntax, two renderings, chosen by what the
 * surface can physically hold.
 */
function barLabel(span: Span): string {
	const template = barTemplate.value;
	// ⚠ A TEMPLATE THAT RENDERS TO NOTHING IS A MISS, NOT A LABEL — the same rule `labelFor` learned
	// about an empty fallback. `{{ summary }}` over a collection where a tenth of the records carry
	// a summary is a legitimate template, and returning '' for the other nine tenths draws a wall of
	// nameless bars instead of falling through to the name the record already has.
	if (template) {
		const rendered = (tryRenderDisplay(template, span.record) ?? '').replace(/\s+/g, ' ').trim();
		if (rendered) return rendered;
	}
	const field = labelField.value;
	if (!field) return span.title;
	const raw = span.record[field.field];
	const value = Array.isArray(raw) ? raw.filter((v) => v !== null && v !== undefined && v !== '').join(' · ') : raw;
	return value === null || value === undefined || value === '' ? '' : String(value);
}

/** Inside the bar, or beside it? A width question, answered off the same day width the grid uses —
 *  and off the bar's LIVE columns, because a bar whose middle is folded away is drawn narrow however
 *  many days it nominally covers. */
function labelInside(span: Span): boolean {
	const a = axis.value;
	if (!a) return false;
	const columns = a.columnOf(span.end) + 1 - a.columnOf(span.start);
	return columns * DAY_PX[a.scale] >= LABEL_FITS_PX;
}

function barTitle(span: Span): string {
	if (span.inverted) {
		return `${span.title} — ${span.endKey} is before ${span.startKey}, so it is drawn as a point at the start`;
	}
	return span.endKey && span.endKey !== span.startKey
		? `${span.title} — ${span.startKey} → ${span.endKey}`
		: `${span.title} — ${span.startKey}`;
}

// ── bands ────────────────────────────────────────────────────────────────────────────────────────
// The shared derivation, with ONE difference from the table's: `multi`. A group field holding a list
// fans the record into one band per value, which is what a tags-shaped axis means — and the reason
// `valuesOf` exists rather than `valueOf` learning to split.
const groupField = computed(() => {
	const named = options.value['group_by'];
	if (typeof named !== 'string' || !named.length) return null;
	return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? null;
});
const showUngrouped = computed(() => options.value['show_ungrouped_rows'] === true);
const showEmpty = computed(() => options.value['show_empty_rows'] === true);
const grouped = computed(() => groupField.value !== null);

const bands = computed<Bucket[]>(() => {
	// Only PLACEABLE records are banded — an undated record has no row to sit in, and putting it in
	// a band would make the band's count disagree with the rows under it.
	const records = spans.value.map((s) => s.record);
	if (!groupField.value) return [{ value: '', label: '', records }];
	return bucketize(groupField.value, records, {
		showUngrouped: showUngrouped.value,
		showEmpty: showEmpty.value,
		multi: true,
	});
});

// ── what a band is CALLED ────────────────────────────────────────────────────────────────────────
// A band grouped by a reference took its name from the de-slugged last segment of a workspace path.
// The referenced record has a real name, and a relation CELL one row below already shows it —
// `lib/group-label.ts` is that same resolution (same relations list, same record cache, same
// template), so the two can never disagree. The de-slugged name is what shows until the fetch lands.
const groupTemplate = computed<string | null>(() => {
	const t = options.value['group_title'];
	return typeof t === 'string' && t.trim().length ? t : null;
});
const groupIconField = computed<string | null>(() => {
	const f = options.value['group_icon'];
	return typeof f === 'string' && f.trim().length ? f.trim() : null;
});
const groupSummaryTemplate = computed<string | null>(() => {
	const t = options.value['group_summary'];
	return typeof t === 'string' && t.trim().length ? t : null;
});
const { labels: groupLabels, icons: groupIcons, summaries: groupSummaries, resolve: resolveGroupLabels } = useGroupLabels({
	values: () => bands.value.map((b) => b.value),
	field: () => groupField.value,
	template: () => groupTemplate.value,
	collection: () => props.state.collection,
	iconField: () => groupIconField.value,
	summaryTemplate: () => groupSummaryTemplate.value,
});
watchEffect(resolveGroupLabels);
const bandLabel = (band: Bucket): string => labelFor(band.value, band.label, groupLabels.value);
/** The band's picture: the referenced record's own, else whatever the enum declared. A resolved face
 *  WINS over a declared codicon — a glyph standing in for a person is what the face replaces. */
const bandIcon = (band: Bucket): string | undefined => groupIcons.value[band.value] ?? band.icon;
/** What the band SAYS about itself, beside its name. Falls back to the enum's own `description`,
 *  which is the same idea authored in the schema instead of in the view. */
const bandSummary = (band: Bucket): string | undefined => groupSummaries.value[band.value] ?? band.description;

// ── what a band SPANS, and where it STOPS ────────────────────────────────────────────────────────
// The band's own bar: drawn on the same grid as the rows beneath it, answering the one question a
// grouped chart could not previously answer without reading every row — "when does this lane run,
// and for how long" — and it stays legible when the lane is COLLAPSED, which is what makes
// collapsing useful rather than merely tidy.
//
// ⚠ ONE SEGMENT PER RUN, NOT ONE BAR PER LANE. A lane's bar is an ENVELOPE and occupies nothing, so
// unlike a record's bar it may NOT be drawn through the time the lane was idle: a lane that ran for
// two months in 2024 and two in 2026 drew as thirty months of continuous work, and the operator saw
// it as the rows compressing more than the lane above them. `lib/gantt-axis.ts`'s `bandRuns` carries
// why merging the lane's own spans is the whole rule and why no extra fold-splitting is needed.
interface BandShape {
	/** What the lane actually held, as the segments to draw. */
	runs: Array<{ start: number; end: number }>;
	/** The envelope, for the label only — never for a bar. */
	start: number;
	end: number;
	startKey: string;
	endKey: string;
	/** Days the lane HELD, which is not the envelope unless it ran once. */
	activeDays: number;
}
const bandShapes = computed<Map<string, BandShape>>(() => {
	const map = new Map<string, BandShape>();
	const placed = spanOf.value;
	for (const band of bands.value) {
		const own: AxisSpan[] = [];
		let start = Infinity;
		let end = -Infinity;
		let startKey = '';
		let endKey = '';
		for (const record of band.records) {
			const span = placed.get(record);
			if (!span) continue;
			own.push({ start: span.start, end: span.end });
			if (span.start < start) { start = span.start; startKey = span.startKey; }
			if (span.end > end) { end = span.end; endKey = span.endKey ?? span.startKey; }
		}
		if (!own.length) continue;
		const runs = bandRuns(own);
		map.set(band.value, {
			runs,
			start,
			end,
			startKey,
			endKey,
			activeDays: runs.reduce((n, r) => n + (r.end - r.start + 1), 0),
		});
	}
	return map;
});

function runStyle(run: { start: number; end: number }): Record<string, string> {
	const a = axis.value!;
	return { gridColumn: `${a.columnOf(run.start)} / ${a.columnOf(run.end) + 1}` };
}

/**
 * `Mar 9 – May 10 · 63 days`, and for a lane that stopped and started again
 * `Mar 9 – Dec 2 · 2 runs · 84 active days`.
 *
 * ⚠ The day count is ACTIVE days, never the envelope. Saying "268 days" of a lane that held four
 * weeks of work is the same lie the unbroken bar told, in words — and the words outlive the picture,
 * because this is the line a collapsed lane is read by.
 */
function bandRange(band: Bucket): string {
	const shape = bandShapes.value.get(band.value);
	if (!shape) return '';
	const range = rangeLabel(shape.startKey, shape.endKey);
	const days = `${shape.activeDays} ${shape.activeDays === 1 ? 'day' : 'days'}`;
	return shape.runs.length > 1 ? `${range} · ${shape.runs.length} runs · ${days} active` : `${range} · ${days}`;
}

// Ephemeral, like every other layout's: a saved view reopening with bands shut would read as
// missing data, which is the failure a collapse control exists to prevent.
// ⚠ A GROUPED GANTT STARTS COLLAPSED, and that is the DEFAULT rather than an opt-in. Expanded, a
// chart of 437 activities in 18 lanes opens as a four-thousand-pixel wall in which the shape of the
// year — which lane ran when, and for how long — is the one thing you cannot see. Collapsed, every
// lane is one row carrying its own extent bar and its own summary, the whole year fits on a screen,
// and opening a lane is one click. `start_collapsed: false` restores the old behaviour per view.
//
// It only applies to a GROUPED chart: an ungrouped one has a single unheaded band with no toggle,
// and collapsing it would hide every record behind a control that is not drawn.
const startCollapsed = computed<boolean>(() => options.value['start_collapsed'] !== false);
const collapsed = ref(new Set<string>());
/** Bands already offered to the reader, so the initial collapse happens ONCE per band rather than
 *  snapping a lane shut again every time the record set changes under it. */
const introduced = new Set<string>();
watchEffect(() => {
	if (!grouped.value || !startCollapsed.value) return;
	const fresh = bands.value.map((b) => b.value).filter((v) => !introduced.has(v));
	if (!fresh.length) return;
	for (const v of fresh) introduced.add(v);
	const next = new Set(collapsed.value);
	for (const v of fresh) next.add(v);
	collapsed.value = next;
});
function toggleBand(value: string): void {
	const next = new Set(collapsed.value);
	if (!next.delete(value)) next.add(value);
	collapsed.value = next;
}
</script>

<template>
	<div class="dt-gantt">
		<!-- Stale-while-revalidate, same as the table and the cards: the tall block is FIRST load only,
		     so filtering never shifts the layout. -->
		<div v-if="state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="loading" />
			<p class="dt-empty__line">Loading…</p>
		</div>
		<div v-else-if="!state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="inbox" />
			<p class="dt-empty__line">{{ state.hasActiveQuery.value ? 'No records match your search/filters' : 'No records yet' }}</p>
			<button v-if="!state.hasActiveQuery.value && !state.items.unavailable?.value" type="button" class="dt-btn dt-btn--sm" @click="state.createRecord()">Create record</button>
		</div>
		<p v-else-if="!startField" class="dt-empty">
			no date field to lay records out on — set one in Layout options (start field)
		</p>

		<template v-else>
			<div v-if="axis" class="dt-gantt-scroll">
				<div class="dt-gantt-canvas" :class="`dt-gantt--${axis.scale}`">
					<div class="dt-gantt-head">
						<div class="dt-gantt-gutter dt-gantt-head-gutter">
							{{ startField.field }}<template v-if="endField"> → {{ endField.field }}</template>
						</div>
						<div class="dt-gantt-track" :style="{ gridTemplateColumns: gridTemplate }">
							<div
								v-for="tick in axis.ticks"
								:key="tick.key"
								class="dt-gantt-tick"
								:style="{ gridColumn: `${tick.column} / span ${tick.columns}` }"
							>
								{{ tick.label }}
							</div>
							<!-- THE FOLD'S HEADER CELL, and the only clickable part of it: the strip below is
							     `pointer-events: none` so it can never steal a click meant for a bar. The label
							     speaks the scale's own vocabulary (`W42…W52`) rather than a day count, because
							     the reader is looking for where in their calendar the missing time went. -->
							<button
								v-for="fold in axis.folds"
								:key="fold.key"
								type="button"
								class="dt-gantt-fold"
								:class="{ 'is-open': fold.expanded }"
								:style="{ gridColumn: String(fold.column) }"
								:title="fold.title"
								:aria-expanded="fold.expanded"
								@click="toggleFold(fold.key)"
							>
								<DtIcon :name="fold.expanded ? 'chevron-left' : 'chevron-right'" />
								<span class="dt-gantt-fold__label">{{ fold.label }}</span>
							</button>
						</div>
					</div>

					<!-- One full-height strip per fold, absolutely placed against the canvas exactly as the
					     today marker is — so the break in time is visible where the BARS are and not only in
					     the header, at four elements rather than four per row. -->
					<div
						v-for="fold in axis.folds"
						:key="`strip/${fold.key}`"
						class="dt-gantt-fold-strip"
						:class="{ 'is-open': fold.expanded }"
						:style="{ left: foldOffset(fold.firstDay) }"
						aria-hidden="true"
					></div>

					<!-- One marker for the whole chart, positioned off the SAME day width the grid tracks
					     use, so it lands on the column it names. -->
					<div v-if="todayOffset" class="dt-gantt-today" :style="{ left: todayOffset }" aria-hidden="true"></div>

					<section
						v-for="band in bands"
						:key="band.value"
						class="dt-gantt-band"
						:class="{ 'is-lane': grouped, 'is-collapsed': collapsed.has(band.value) }"
						:style="band.color || band.background ? { '--dt-lane-rail': themeColor((band.color || band.background)!) } : undefined"
					>
						<!-- THE BAND HEADER IS A ROW, not a caption above one. It is laid out gutter + track on
						     the same grid as the records beneath, so the band's own bar lands under the same
						     ticks its rows do — a caption cannot say "this lane runs March to May", and a bar
						     on a different grid would say it wrongly. -->
						<div v-if="grouped" class="dt-gantt-band-row">
							<div class="dt-gantt-gutter dt-gantt-band-header">
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
									:label="bandLabel(band)"
									:count="band.records.length"
									:description="bandSummary(band)"
									:icon="bandIcon(band)"
									:color="band.color"
									:background="band.background"
								/>
							</div>
							<div class="dt-gantt-track" :style="{ gridTemplateColumns: gridTemplate }">
								<!-- ONE SEGMENT PER RUN. The label rides the FIRST one only: it names the lane as a
								     whole, and repeating it over every burst would say the same thing three times
								     across a chart whose whole purpose is to show that they are separate. -->
								<div
									v-for="(run, i) in bandShapes.get(band.value)?.runs ?? []"
									:key="`${band.value}/run/${run.start}`"
									class="dt-gantt-band-bar"
									:style="runStyle(run)"
									:title="`${bandLabel(band)} — ${bandRange(band)}`"
								>
									<span v-if="i === 0" class="dt-gantt-band-bar__label">{{ bandRange(band) }}</span>
								</div>
							</div>
						</div>
						<div
							v-for="record in collapsed.has(band.value) ? [] : band.records"
							:key="`${band.value}/${state.pkOf(record)}`"
							class="dt-gantt-row"
							:data-vscode-context="rowContext(state.collection, state.pkOf(record))"
							@click="state.openRecord(record)"
						>
							<div class="dt-gantt-gutter" :title="spanOf.get(record)?.title">{{ spanOf.get(record)?.title || '—' }}</div>
							<div class="dt-gantt-track" :style="{ gridTemplateColumns: gridTemplate }">
								<div
									class="dt-gantt-bar"
									:class="{
										'dt-gantt-bar--point': spanOf.get(record)!.start === spanOf.get(record)!.end,
										'dt-gantt-bar--inverted': spanOf.get(record)!.inverted,
										'dt-gantt-bar--labelled': labelInside(spanOf.get(record)!),
									}"
									:style="barStyle(spanOf.get(record)!)"
									:title="barTitle(spanOf.get(record)!)"
								>
									<span
										v-if="barLabel(spanOf.get(record)!)"
										class="dt-gantt-bar__label"
										:class="labelInside(spanOf.get(record)!) ? 'is-inside' : 'is-beside'"
									>{{ barLabel(spanOf.get(record)!) }}</span>
								</div>
							</div>
						</div>
					</section>
				</div>
			</div>

			<!-- Same discipline as the undated tail below: a limit the reader cannot see is a limit
			     that misleads. The palette is theme colour IDs and cannot be lengthened, so past it
			     the bars go neutral and this says how many. -->
			<div v-if="uncoloured" class="dt-gantt-undated">
				<span class="dt-gantt-undated-label">
					{{ uncoloured }} more value{{ uncoloured > 1 ? 's' : '' }} of
					{{ colorField?.field }} than the palette has colours — {{ uncoloured > 1 ? 'those bars share' : 'that bar keeps' }} the neutral
				</span>
			</div>

			<!-- Never a silent drop: this is the one layout where a record legitimately has nowhere to
			     be drawn, and an invisible record with no explanation reads as data loss. -->
			<div v-if="undated.length" class="dt-gantt-undated">
				<span class="dt-gantt-undated-label">
					{{ undated.length }} undated — no {{ startField.field }} to place {{ undated.length > 1 ? 'them' : 'it' }} on
				</span>
				<span
					v-for="record in undated"
					:key="state.pkOf(record)"
					class="dt-gantt-chip"
					:data-vscode-context="rowContext(state.collection, state.pkOf(record))"
					@click="state.openRecord(record)"
				>
					{{ titleOf(record) || state.pkOf(record) }}
				</span>
			</div>
		</template>
	</div>
</template>

<style scoped>
/* The List declares `fillsHeight`, so BrowseView hands this the page's leftover height and the PAGE
   stops scrolling — which is what makes the horizontal scroll live inside the chart rather than
   dragging the whole browse sideways. */
.dt-gantt {
	display: flex;
	flex-direction: column;
	min-height: 0;
	gap: 10px;
}
.dt-gantt-scroll {
	overflow: auto;
	flex: 1;
	min-height: 0;
}
.dt-gantt-canvas {
	position: relative;
	width: max-content;
	min-width: 100%;
	--dt-gantt-gutter: 180px;
}
/* The one number that changes with the scale. Everything else — bars, ticks, the today marker — is
   expressed in it, so the three pictures cannot disagree about where a day is. */
.dt-gantt--day {
	--dt-gantt-day: 30px;
}
.dt-gantt--week {
	--dt-gantt-day: 7px;
}
.dt-gantt--month {
	--dt-gantt-day: 2.4px;
}
/* A FOLD is one column of this width whatever the scale — it stands for time that was removed, so
   sizing it off the day width would make it pretend to be a duration. Sized to hold the widest
   label the scale can produce (`W39…W52`, `Jan 3…Feb 18`) plus its chevron WITHOUT an ellipsis: a
   fold whose own range is truncated is the one label in the picture that cannot be recovered by
   looking somewhere else. Four of them still cost less than one folded fortnight. */
.dt-gantt-canvas {
	--dt-gantt-fold: 84px;
}

.dt-gantt-head,
.dt-gantt-row {
	display: flex;
	align-items: stretch;
}
.dt-gantt-head {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--dt-bg);
	box-shadow: inset 0 -1px 0 var(--dt-border-strong);
}
.dt-gantt-gutter {
	flex: 0 0 var(--dt-gantt-gutter);
	width: var(--dt-gantt-gutter);
	position: sticky;
	left: 0;
	z-index: 1;
	background: var(--dt-bg);
	padding: 4px 10px 4px 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: var(--dt-text);
}
.dt-gantt-head-gutter {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	text-transform: uppercase;
	letter-spacing: 0.02em;
}
.dt-gantt-track {
	display: grid;
	flex: 0 0 auto;
	align-items: center;
	/* Was 24px. A bar now carries text at --dt-label, and 24px left the descenders touching the row
	   beneath — which is what made a grouped chart read as one dense block rather than lanes. */
	min-height: 28px;
}
/* ⚠ `grid-row: 1` ON BOTH THE TICKS AND THE FOLDS, and it is load-bearing rather than tidy. The
   folds are rendered AFTER the ticks in the DOM but sit at columns BETWEEN them, and grid
   auto-placement never walks backwards: without an explicit row it drops each fold into a new row
   under the ticks, which doubles the header's height and puts the range label a row below the week
   it belongs to. Measured in the Extension Development Host — every instrument was green. */
.dt-gantt-tick,
.dt-gantt-fold {
	grid-row: 1;
}
.dt-gantt-tick {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	padding: 4px 0;
	border-left: 1px solid var(--dt-border);
	overflow: hidden;
	text-overflow: clip;
	white-space: nowrap;
	text-align: center;
}

.dt-gantt-row {
	cursor: pointer;
}
.dt-gantt-row:hover {
	background: var(--dt-bg-hover, var(--dt-bg-subtle));
}
.dt-gantt-row:hover .dt-gantt-gutter {
	background: var(--dt-bg-hover, var(--dt-bg-subtle));
}
/* `--dt-gantt-bar` is set per record when a colour axis is chosen; unset, every bar is the accent,
   which is the picture an uncoloured gantt has. */
.dt-gantt-bar {
	position: relative;
	height: 16px;
	border-radius: 3px;
	background: var(--dt-gantt-bar, var(--dt-accent));
	min-width: 3px;
	display: flex;
	align-items: center;
}
.dt-gantt-bar--point {
	border-radius: 999px;
}
/* THE LABEL IN THE TIMELINE. Two placements, one element — see the script for why a point-sized bar
   must be able to speak. */
.dt-gantt-bar__label {
	font-size: var(--dt-label);
	line-height: 1;
	white-space: nowrap;
	pointer-events: none;
}
/* INSIDE: clipped by the bar, because a label escaping its own bar would sit over the next month and
   read as belonging to it. The colour is fixed white-on-fill rather than a theme foreground — the
   fill is a chart colour in both themes, so a theme-following text colour is unreadable in one. */
.dt-gantt-bar__label.is-inside {
	padding: 0 6px;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--vscode-editor-background, #fff);
	font-weight: 500;
}
/* BESIDE: drawn INLINE FROM THE BAR'S START — the text begins on the day the record begins and runs
   right over the empty track, so a week-wide bar at month zoom (17px) still reads as "this week: the
   sentence". It used to hang off the bar's END, which put the words a bar-width away from the date
   they describe and, on a point bar, on the wrong day. Absolutely placed so it does not stretch the
   grid column it starts in and cannot push the day it names out from under its tick; a translucent
   backing on the row's own colour keeps it legible where it crosses the bar's fill. */
.dt-gantt-bar__label.is-beside {
	position: absolute;
	left: 0;
	padding: 0 4px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--vscode-editor-background, #fff) 72%, transparent);
	color: var(--dt-fg-subtle);
	max-width: 60ch;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dt-gantt-row:hover .dt-gantt-bar__label.is-beside {
	color: var(--dt-fg);
}
/* An inverted bar is an outline, so white-on-fill would vanish. */
.dt-gantt-bar--inverted .dt-gantt-bar__label.is-inside {
	color: var(--dt-danger);
}
/* An inverted pair is DRAWN, not hidden — the picture is how the typo gets found. Outlined rather
   than filled so it reads as "something is wrong here" without needing a legend. */
.dt-gantt-bar--inverted {
	background: transparent;
	border: 1px dashed var(--dt-danger);
}

/* ── LANES ──────────────────────────────────────────────────────────────────────────────────────
   A grouped gantt is read lane by lane, so a lane has to be a THING with edges rather than a header
   that happens to precede some rows. Three devices, no more: a rail, a ground under the header, and
   a rule between lanes.

   ⚠ The rail lives on the ROW GUTTER, not on the section. The canvas is `width: max-content` inside
   a horizontal scroller, so anything absolutely positioned against the section scrolls away to the
   left the moment you look at August. The gutter is already `position: sticky; left: 0` — hanging
   the rail off it is the only placement that stays put, and it costs no element.

   ⚠ No `overflow: hidden` anywhere on a lane, however tempting for rounding the corners: it makes
   the element a scroll container and silently kills `position: sticky` on the gutter inside it. */
.dt-gantt-band.is-lane {
	--dt-lane-rail: var(--dt-border-strong);
	padding-bottom: var(--dt-space-2);
}
.dt-gantt-band.is-lane + .dt-gantt-band.is-lane {
	margin-top: var(--dt-space-3);
	border-top: 1px solid var(--dt-border);
	padding-top: var(--dt-space-2);
}
/* A collapsed lane is a header and nothing else — the bottom padding would read as an empty row. */
.dt-gantt-band.is-lane.is-collapsed {
	padding-bottom: 0;
}
.dt-gantt-band-header {
	display: flex;
	align-items: center;
	gap: 2px;
	/* The gutter rules already make it sticky, opaque and exactly one gutter wide — inheriting them
	   is what keeps the header aligned with the rows when the chart is scrolled sideways. It only
	   adds the flex row for the toggle, and drops the gutter's right padding so a long lane name has
	   the full width. */
	padding-right: 0;
}
/* Laid out like a row and deliberately NOT one: `dt-gantt-row` means "a record" to every reader of
   this DOM, tests included, and a header wearing that class makes a three-record band count four. */
.dt-gantt-band-row {
	display: flex;
	align-items: stretch;
	cursor: default;
	margin-bottom: var(--dt-space-1);
}
/* THE BAND'S OWN BAR. Deliberately not a second bar: a thin capped rule, so it reads as the EXTENT
   of the lane rather than as one more record in it. Its label sits after the rule, in the empty
   track, where nothing else is drawn. */
.dt-gantt-band-bar {
	position: relative;
	height: 3px;
	border-radius: 999px;
	background: var(--dt-lane-rail, var(--dt-border-strong));
	min-width: 2px;
}
.dt-gantt-band-bar::before,
.dt-gantt-band-bar::after {
	content: '';
	position: absolute;
	top: -3px;
	width: 2px;
	height: 9px;
	border-radius: 1px;
	background: inherit;
}
.dt-gantt-band-bar::before {
	left: 0;
}
.dt-gantt-band-bar::after {
	right: 0;
}
/* Absolutely placed for the same reason the beside-label is: a span in the flow would stretch the
   grid column it starts in and push the day it names out from under its own tick. */
.dt-gantt-band-bar__label {
	position: absolute;
	left: 0;
	top: 8px;
	white-space: nowrap;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	pointer-events: none;
}
/* The rail: one continuous 2px line down the lane, in the band's own colour when it declared one
   and a neutral when it did not. Deliberately NOT a per-lane palette — a gantt already spends its
   colour budget on the bars, and a second unrelated colour axis behind them is noise. */
.dt-gantt-band.is-lane .dt-gantt-row .dt-gantt-gutter {
	border-left: 2px solid var(--dt-lane-rail);
	padding-left: var(--dt-space-3);
}
.dt-gantt-band.is-lane .dt-gantt-band-header {
	border-left: 2px solid var(--dt-lane-rail);
}
.dt-group-toggle {
	display: flex;
	align-items: center;
	background: none;
	border: 0;
	padding: 4px 2px;
	cursor: pointer;
	color: var(--dt-fg-subtle);
}
.dt-group-toggle:hover {
	color: var(--dt-fg);
}

/* ── FOLDS ──────────────────────────────────────────────────────────────────────────────────────
   Two elements per fold: a BUTTON in the header, which is what you click, and a STRIP down the
   canvas, which is what tells you the axis is discontinuous where the bars are. The strip is inert
   — a fold sits under bars that cross it, and a click there belongs to the bar. */
.dt-gantt-fold {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 1px;
	padding: 4px 0;
	border: 0;
	border-left: 1px dashed var(--dt-border-strong);
	border-right: 1px dashed var(--dt-border-strong);
	background: color-mix(in srgb, var(--dt-fg-subtle) 10%, transparent);
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	line-height: 1;
	cursor: pointer;
	overflow: hidden;
	white-space: nowrap;
}
.dt-gantt-fold:hover {
	color: var(--dt-fg);
	background: var(--dt-bg-hover, var(--dt-bg-subtle));
}
.dt-gantt-fold__label {
	overflow: hidden;
	text-overflow: ellipsis;
}
/* Open, the cell is just the seam that shuts it again — its days are drawn to the right of it, so a
   range label there would name time the reader can already see. */
.dt-gantt-fold.is-open .dt-gantt-fold__label {
	display: none;
}
/* ⚠ A SEAM, NOT A PANEL. The first cut filled this with `--dt-bg-subtle`, which in a dark theme is
   a solid column two shades off the ground running the whole height of the chart — it out-shouted
   every bar on screen and clipped the band labels behind it. The break in time only has to be
   NOTICEABLE where the bars are; the header cell is what names it. So: a whisper of tint and two
   dashed rules, and `z-index: 0` keeps it under the sticky header and behind every bar. */
.dt-gantt-fold-strip {
	position: absolute;
	top: 0;
	bottom: 0;
	width: var(--dt-gantt-fold);
	background: color-mix(in srgb, var(--dt-fg-subtle) 7%, transparent);
	border-left: 1px dashed var(--dt-border);
	border-right: 1px dashed var(--dt-border);
	pointer-events: none;
	z-index: 0;
}
/* Open, the strip marks only the seam — the days to its right are drawn, so tinting them would say
   they were still missing. */
.dt-gantt-fold-strip.is-open {
	background: none;
	border-right: 0;
}

.dt-gantt-today {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 0;
	border-left: 1px solid var(--dt-accent);
	pointer-events: none;
	z-index: 1;
}

.dt-gantt-undated {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	padding-top: 6px;
	border-top: 1px solid var(--dt-border);
}
.dt-gantt-undated-label {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-gantt-chip {
	background: var(--dt-bg-subtle);
	border: 1px solid var(--dt-border);
	border-radius: 4px;
	padding: 2px 6px;
	font-size: var(--dt-label);
	cursor: pointer;
	max-width: 220px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-gantt-chip:hover {
	border-color: var(--dt-accent);
}
</style>
