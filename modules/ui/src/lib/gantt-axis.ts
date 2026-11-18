/**
 * THE GANTT AXIS — `(spans, today, fold) → columns`, and nothing else. No Vue, no DOM, no record:
 * `ListGantt.vue` hands over two day numbers per bar and gets back a grid.
 *
 * ── WHY THE AXIS IS NOT UNIFORM ANY MORE ─────────────────────────────────────────────────────────
 * The layout rests on ONE string shared by the header and every row, which is what guarantees the
 * ticks can never drift from the bars beneath them. That guarantee is kept; the string simply stops
 * being a single `repeat()`. The axis is an ordered list of SEGMENTS:
 *
 *   · a LIVE segment contributes one column per day, exactly as it always did
 *   · a FOLD contributes exactly ONE narrow column — `var(--dt-gantt-fold)` — swallowing a run of
 *     days in which nothing happens, and when the reader opens it, its days follow that one column
 *
 * so a bar is placed by `grid-column: columnOf(start) / columnOf(end) + 1` rather than by
 * `span <days>`: past a fold, a span count is no longer a day count.
 *
 * ── WHAT FOLDS ───────────────────────────────────────────────────────────────────────────────────
 * A run of days in which NO BAR STARTS, NO BAR ENDS and TODAY DOES NOT FALL. "Nothing changes",
 * not "nothing is drawn" — deliberately the stronger of the two readings, because the interior of
 * one long-running bar is also a period in which nothing changes, and under the weaker rule a chart
 * holding a single multi-year record could never shrink at all. A bar crossing a fold draws
 * UNBROKEN through it, which is what makes the stronger rule safe.
 *
 * ⚠ TODAY IS A BOUNDARY. A fold containing today would hide the now-marker, and "where am I" is
 * never the thing to hide.
 *
 * ── THE ORDER, AND THE LOOP IT CUTS ──────────────────────────────────────────────────────────────
 * The threshold wants to be in PIXELS, because wasted screen is the whole complaint. Pixels come
 * from the scale; the scale now comes from the live days; the live days come from the folds; the
 * folds come from the threshold. That is a circle, so the order is FIXED and each step reads only
 * the steps before it:
 *
 *   1. BOUNDARIES   every span's start, every span's end, and today
 *   2. RAW SCALE    from the raw span, by the rule this file has always had
 *   3. THRESHOLD    `FOLD_MIN_PX` at the RAW scale → 4 days · 18 days · 50 days
 *   4. FOLD         every run with no boundary inside it, snapped INWARD to whole ticks, that is
 *                   still at or over the threshold
 *   5. FINAL SCALE  from the LIVE day total — which may be FINER than the raw scale, and that is
 *                   where most of the value is: a year with a fortnight of real activity in it
 *                   becomes a fortnight drawn day by day instead of a year of empty weeks
 *
 * ⚠ STEP 3 READS THE RAW SCALE, NEVER THE FINAL ONE. Reading the final scale closes the circle. The
 * sibling rule is older than this file: the scale is decided on the RAW span, BEFORE any snapping,
 * because snapping a 59-day span out to whole months and then re-reading the width would let the
 * picture choose its own scale.
 *
 * ⚠ SNAPPING IS INWARD, and that is what makes a padding constant unnecessary. A fold covers only
 * WHOLE ticks, so the partial week or month carrying a boundary stays live — a bar is never flush
 * against a seam, no tick ever straddles a fold, and a fold can only ever shrink, never eat a live
 * day.
 *
 * ── DATES ARE DAY NUMBERS ────────────────────────────────────────────────────────────────────────
 * A record carries `2026-03-02` or `2026-03-02T09:00:00+03:00`. `new Date('2026-03-02')` is UTC
 * midnight and lands on the 1st anywhere west of Greenwich, and two offset-carrying date-times do
 * not string-compare in time order. So every value is reduced to its `slice(0, 10)` day key and
 * then to an integer through `Date.UTC`, which is offset-free by construction.
 */

export type Scale = 'day' | 'week' | 'month';

export const MS_DAY = 86_400_000;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The width of one DAY column at each scale. The bar-label fit test reads it too. */
export const DAY_PX: Record<Scale, number> = { day: 30, week: 7, month: 2.4 };

/**
 * How much dead screen a run has to waste before it is worth folding — the ONE invented number in
 * this file, and deliberately expressed in pixels rather than days: 14 days of nothing is half the
 * width of a day-scale chart and a rounding error on a three-year one, so a day threshold would
 * either shred the long picture or do nothing for the short one. Evaluated at the RAW scale (step 3
 * above), which is what keeps it from being circular. At 250 it would fold only the two longest
 * stretches of a typical year-long plan; 120 also takes the month-sized ones.
 */
const FOLD_MIN_PX = 120;

/** `2026-03-02T09:00:00+03:00` → `2026-03-02`, and anything that is not a date at all → null. */
export function dayKeyOf(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 10) return null;
	const key = value.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** Whole days since the epoch, through `Date.UTC` — the offset-free integer everything else uses. */
export function dayNumber(key: string): number {
	return Math.round(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / MS_DAY);
}

/** A `Date` positioned so the getUTC* accessors read back the day this number names. */
export const dateOf = (day: number): Date => new Date(day * MS_DAY);

/** Today, as a day number, offset-free like everything else here. */
export function todayNumber(now: Date = new Date()): number {
	return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_DAY);
}

/** ISO-8601 week number. Thursday decides the year, which is the whole of the rule — a week label
 *  that disagrees with the reader's own calendar is worse than no label. */
export function isoWeek(day: number): number {
	const d = dateOf(day);
	const thursday = new Date(d.getTime() + ((3 - ((d.getUTCDay() + 6) % 7)) * MS_DAY));
	const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
	return Math.floor((thursday.getTime() - jan1) / MS_DAY / 7) + 1;
}

// ── unit edges, per scale ────────────────────────────────────────────────────────────────────────
// A "unit" is what one header tick covers: a day, an ISO week (Monday–Sunday), or a calendar month.
const mondayOf = (day: number): number => day - ((dateOf(day).getUTCDay() + 6) % 7);
const sundayOf = (day: number): number => day + (6 - ((dateOf(day).getUTCDay() + 6) % 7));
const monthStartOf = (day: number): number => {
	const d = dateOf(day);
	return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_DAY);
};
const monthEndOf = (day: number): number => {
	const d = dateOf(day);
	return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / MS_DAY);
};

/** The first day of the unit containing this one. */
function unitStart(day: number, scale: Scale): number {
	return scale === 'day' ? day : scale === 'week' ? mondayOf(day) : monthStartOf(day);
}
/** The last day of the unit containing this one. */
function unitEnd(day: number, scale: Scale): number {
	return scale === 'day' ? day : scale === 'week' ? sundayOf(day) : monthEndOf(day);
}
/** The first day of the first WHOLE unit at or after this day — inward snapping, lower edge. */
function unitStartAtOrAfter(day: number, scale: Scale): number {
	const start = unitStart(day, scale);
	return start === day ? day : unitEnd(day, scale) + 1;
}
/** The last day of the last WHOLE unit at or before this day — inward snapping, upper edge. */
function unitEndAtOrBefore(day: number, scale: Scale): number {
	const end = unitEnd(day, scale);
	return end === day ? day : unitStart(day, scale) - 1;
}

/** The scale a span of this many days is drawn at. Untouched since the layout shipped. */
export function scaleFor(days: number): Scale {
	return days <= 60 ? 'day' : days <= 400 ? 'week' : 'month';
}

// ── the shapes ───────────────────────────────────────────────────────────────────────────────────

/** All the axis needs of a record: where its bar begins and ends, as day numbers. */
export interface AxisSpan {
	start: number;
	/** Inclusive last day. Equals `start` for a point. */
	end: number;
}

export interface Tick {
	key: string;
	label: string;
	/** 1-based grid column of the tick's first day, and how many columns it covers. */
	column: number;
	columns: number;
}

export interface Fold {
	/** Stable across renders — the run's first day. What the reader's expanded set holds. */
	key: string;
	/** `W42…W52` at week scale, `Jan 3…Feb 18` at day, `Feb ’26…Nov ’26` at month. */
	label: string;
	title: string;
	firstDay: number;
	lastDay: number;
	days: number;
	/** The fold's own single narrow column. When expanded, its days follow from `column + 1`. */
	column: number;
	expanded: boolean;
}

interface Segment {
	kind: 'live' | 'fold';
	firstDay: number;
	lastDay: number;
	column: number;
	columns: number;
}

export interface Axis {
	scale: Scale;
	/** Day number of the first drawn day. */
	origin: number;
	/** Drawn days — live AND folded. The calendar the picture covers. */
	days: number;
	/** Days that actually get a column of their own. The width the picture spends. */
	liveDays: number;
	/** Total grid columns, folds included. */
	columns: number;
	/** The one `grid-template-columns` string, shared by the header and every row. */
	template: string;
	ticks: Tick[];
	folds: Fold[];
	/** The 1-based grid column a day sits in. Total: every day maps somewhere. */
	columnOf(day: number): number;
	/** A day's left offset as a CSS `calc()`, for anything positioned rather than placed. */
	offsetOf(day: number): string;
}

export interface AxisOptions {
	/** Today, as a day number. A boundary, so it can never hide inside a fold. */
	today?: number;
	/** `false` restores the uniform axis this layout had before folding existed. */
	fold?: boolean;
	/** Folds the reader has opened, by `Fold.key`. Never changes the scale — see `buildAxis`. */
	expanded?: ReadonlySet<string>;
}

/**
 * ⚠ THE SCALE IS FIXED BY THE AUTOMATIC FOLDS AND NEVER MOVES WHEN THE READER OPENS OR SHUTS ONE.
 * Without that, every click re-scales the chart under the cursor. Its consequence is deliberate:
 * the reader opens and shuts the runs the rule found, and cannot fold a run it did not.
 */
export function buildAxis(spans: readonly AxisSpan[], options: AxisOptions = {}): Axis | null {
	if (!spans.length) return null;

	let first = spans[0]!.start;
	let last = spans[0]!.end;
	for (const span of spans) {
		if (span.start < first) first = span.start;
		if (span.end > last) last = span.end;
	}

	// 1 · boundaries, and 2 · the raw scale.
	const raw = last - first + 1;
	const rawScale = scaleFor(raw);
	const marks = new Set<number>();
	for (const span of spans) {
		marks.add(span.start);
		marks.add(span.end);
	}
	const today = options.today;
	if (today !== undefined && today >= first && today <= last) marks.add(today);

	// 3 · the threshold, at the RAW scale. 4 · the runs that clear it, snapped inward.
	const threshold = Math.ceil(FOLD_MIN_PX / DAY_PX[rawScale]);
	const runs: Array<{ firstDay: number; lastDay: number }> = [];
	if (options.fold !== false) {
		const ordered = [...marks].sort((a, b) => a - b);
		for (let i = 0; i < ordered.length - 1; i++) {
			const from = unitStartAtOrAfter(ordered[i]! + 1, rawScale);
			const to = unitEndAtOrBefore(ordered[i + 1]! - 1, rawScale);
			if (to >= from && to - from + 1 >= threshold) runs.push({ firstDay: from, lastDay: to });
		}
	}

	// 5 · the final scale, from the live days — and ONLY from the automatic runs, so a click cannot
	// move it. The outer edges are snapped after the fact, exactly as they always were.
	let foldedDays = 0;
	for (const run of runs) foldedDays += run.lastDay - run.firstDay + 1;
	const scale = scaleFor(raw - foldedDays);
	const origin = unitStart(first, scale);
	const end = unitEnd(last, scale);

	// ── segments ───────────────────────────────────────────────────────────────────────────────────
	const segments: Segment[] = [];
	const folds: Fold[] = [];
	let column = 1;
	let liveDays = 0;
	const live = (firstDay: number, lastDay: number): void => {
		const columns = lastDay - firstDay + 1;
		if (columns <= 0) return;
		segments.push({ kind: 'live', firstDay, lastDay, column, columns });
		column += columns;
		liveDays += columns;
	};
	let cursor = origin;
	for (const run of runs) {
		live(cursor, run.firstDay - 1);
		const key = String(run.firstDay);
		const expanded = options.expanded?.has(key) ?? false;
		const days = run.lastDay - run.firstDay + 1;
		segments.push({ kind: 'fold', firstDay: run.firstDay, lastDay: run.lastDay, column, columns: 1 });
		folds.push({
			key,
			label: foldLabel(run.firstDay, run.lastDay, scale),
			title: expanded
				? `${days} ${days === 1 ? 'day' : 'days'} shown — click to fold`
				: `${days} ${days === 1 ? 'day' : 'days'} hidden — click to show`,
			firstDay: run.firstDay,
			lastDay: run.lastDay,
			days,
			column,
			expanded,
		});
		column += 1;
		// An opened run keeps its seam AND gets its days, so it can always be shut again.
		if (expanded) live(run.firstDay, run.lastDay);
		cursor = run.lastDay + 1;
	}
	live(cursor, end);

	const columns = column - 1;
	const template = segments
		.map((s) => (s.kind === 'live' ? `repeat(${s.columns}, var(--dt-gantt-day))` : 'var(--dt-gantt-fold)'))
		.join(' ');

	// Ticks are generated PER LIVE SEGMENT and clipped to it, so none can straddle a fold. A partial
	// first or last tick is honest — it says the week is cut, which it is.
	const ticks: Tick[] = [];
	for (const segment of segments) {
		if (segment.kind !== 'live') continue;
		let day = segment.firstDay;
		while (day <= segment.lastDay) {
			const stop = Math.min(unitEnd(day, scale), segment.lastDay);
			ticks.push({
				key: String(day),
				label: tickLabel(day, scale, day === segment.firstDay),
				column: segment.column + (day - segment.firstDay),
				columns: stop - day + 1,
			});
			day = stop + 1;
		}
	}

	return {
		scale,
		origin,
		days: end - origin + 1,
		liveDays,
		columns,
		template,
		ticks,
		folds,
		columnOf(day: number): number {
			if (day <= origin) return 1;
			if (day >= end) return columns;
			let at = 1;
			for (const segment of segments) {
				if (day < segment.firstDay) break;
				if (day <= segment.lastDay) {
					// An expanded fold's seam segment is followed by its live one; the live column is the
					// answer, so a collapsed fold returns here and an expanded one falls through.
					if (segment.kind === 'live') return segment.column + (day - segment.firstDay);
					if (!folds.find((f) => f.key === String(segment.firstDay))?.expanded) return segment.column;
				}
				at = segment.column + segment.columns;
			}
			return Math.min(at, columns);
		},
		offsetOf(day: number): string {
			let liveBefore = 0;
			let foldsBefore = 0;
			for (const segment of segments) {
				if (day < segment.firstDay) break;
				if (day <= segment.lastDay) {
					if (segment.kind === 'live') {
						liveBefore += day - segment.firstDay;
						break;
					}
					// A collapsed fold has nowhere finer to point than its own seam.
					if (!folds.find((f) => f.key === String(segment.firstDay))?.expanded) break;
					foldsBefore += 1;
					continue;
				}
				if (segment.kind === 'live') liveBefore += segment.columns;
				else foldsBefore += 1;
			}
			return `calc(var(--dt-gantt-gutter) + ${liveBefore} * var(--dt-gantt-day) + ${foldsBefore} * var(--dt-gantt-fold))`;
		},
	};
}

/**
 * A LANE'S OWN COVERAGE, as the runs it should actually be drawn as — the fix for the one place
 * where "a bar crossing a fold draws unbroken through it" is the WRONG rule.
 *
 * ⚠ A RECORD'S bar and a BAND'S bar mean different things. A record genuinely occupies the time it
 * spans, so drawing it through a fold is honest. A band's bar is an ENVELOPE, min start to max end,
 * and it occupies nothing: drawn unbroken, a lane that worked two months in 2024 and two in 2026
 * reads as thirty months of continuous work — and it reads that way most strongly when the lane is
 * COLLAPSED, which is the state this layout opens in. The operator reported it as the rows
 * compressing more than the lane above them, which is exactly how it looks: the children show the
 * seams and the parent hides them.
 *
 * The rule is one step: merge the lane's spans wherever they touch or overlap. **No splitting at
 * folds is needed, and that is not an omission** — a fold is a run in which nothing starts and
 * nothing ends, so if a lane has coverage either side of one but not inside it, there is an end
 * before it and a start after it, and the lane's own merge already shows the gap in the same place.
 * A fold can only sit INSIDE a merged run when some record really does span it, and there unbroken
 * is right. So the two sources of discontinuity — the lane's own idle time and the axis's fold —
 * coincide by construction, and neither needs a threshold of its own.
 */
export function bandRuns(spans: readonly AxisSpan[]): Array<{ start: number; end: number }> {
	const ordered = spans
		.map((s) => ({ start: s.start, end: Math.max(s.start, s.end) }))
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const runs: Array<{ start: number; end: number }> = [];
	for (const span of ordered) {
		const last = runs[runs.length - 1];
		// `+ 1` so two records that merely ABUT are one run — a lane is not shredded by every record
		// boundary inside it.
		if (last && span.start <= last.end + 1) {
			if (span.end > last.end) last.end = span.end;
			continue;
		}
		runs.push({ ...span });
	}
	return runs;
}

/**
 * `Mar 9 – May 10`, or `Sep 2 ’26 – Sep 30 ’27` when the ends fall in different years.
 *
 * ⚠ THE YEAR IS NOT OPTIONAL ACROSS A YEAR BOUNDARY. Without it a lane running September 2026 to
 * September 2027 labelled itself `Sep 2 – Sep 30` — twenty-eight days, read plainly — which is the
 * same overstatement the unbroken envelope bar made, in words, and words are what a COLLAPSED lane
 * is read by. Two-digit and curly, matching the month tick and the month fold label, because three
 * spellings of a year in one header is its own kind of noise.
 */
export function rangeLabel(startKey: string, endKey: string): string {
	const pretty = (key: string, withYear: boolean): string => {
		const d = dateOf(dayNumber(key));
		const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
		return withYear ? `${base} ’${String(d.getUTCFullYear()).slice(2)}` : base;
	};
	if (startKey === endKey) return pretty(startKey, false);
	const withYear = startKey.slice(0, 4) !== endKey.slice(0, 4);
	return `${pretty(startKey, withYear)} – ${pretty(endKey, withYear)}`;
}

/** What a header tick says. The month name rides the 1st AND the first column of every live segment,
 *  so a bar can be read without scrolling back — or, now, without opening a fold — to place it. */
function tickLabel(day: number, scale: Scale, segmentStart: boolean): string {
	const d = dateOf(day);
	if (scale === 'week') return `W${isoWeek(day)}`;
	if (scale === 'month') return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
	const date = d.getUTCDate();
	return date === 1 || segmentStart ? `${MONTHS[d.getUTCMonth()]} ${date}` : String(date);
}

/** What a FOLD says, in the vocabulary of the scale around it — `W42…W52`, never a day count, because
 *  the reader is looking for where in their own calendar the missing time was. */
function foldLabel(firstDay: number, lastDay: number, scale: Scale): string {
	if (scale === 'week') return `W${isoWeek(firstDay)}…W${isoWeek(lastDay)}`;
	const a = dateOf(firstDay);
	const b = dateOf(lastDay);
	if (scale === 'month') {
		return `${MONTHS[a.getUTCMonth()]} ’${String(a.getUTCFullYear()).slice(2)}…${MONTHS[b.getUTCMonth()]} ’${String(b.getUTCFullYear()).slice(2)}`;
	}
	return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}…${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
}
