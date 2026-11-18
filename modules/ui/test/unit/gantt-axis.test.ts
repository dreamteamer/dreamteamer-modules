/**
 * THE GANTT AXIS, as a pure function. `(spans, today, fold) → columns`, with no Vue, no DOM and no
 * record in sight — which is the whole reason it left `ListGantt.vue`: the fold rule has more edge
 * cases than a rendered mount can reach cheaply, and every one of them is arithmetic.
 *
 * The rule under test, in the order it must run — each step reading only the ones before it:
 *
 *   1. BOUNDARIES  every span's start, every span's end, and today
 *   2. RAW SCALE   from the raw span: ≤ 60 days → day, ≤ 400 → week, else month
 *   3. THRESHOLD   120 wasted pixels at the RAW scale → 4 days · 18 days · 50 days
 *   4. FOLD        each maximal run with no boundary inside it, snapped INWARD to whole ticks,
 *                  folds when what remains is at or over the threshold
 *   5. FINAL SCALE from the LIVE day total — which may be finer than the raw scale
 *
 * ⚠ Step 3 reads the RAW scale, never the final one. Reading the final scale makes the whole thing
 * circular (threshold → folds → live days → scale → threshold), and the sibling rule is already in
 * this codebase: the scale is decided before any snapping, or the picture chooses its own scale.
 *
 * ⚠ These assertions are deliberately about PROPERTIES rather than magic column numbers — "the long
 * gap is folded", "the short one is not", "every drawn day maps inside the grid". A test that
 * hard-codes `grid-column: 41 / 68` passes for exactly one fixture and tells you nothing about why.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bandRuns, buildAxis, dayNumber, rangeLabel, DAY_PX, type Axis, type AxisSpan } from '../../src/lib/gantt-axis';

const day = (key: string): number => dayNumber(key);
const point = (key: string) => ({ start: day(key), end: day(key) });
const bar = (from: string, to: string) => ({ start: day(from), end: day(to) });

/** Is this day inside some fold? The question almost every assertion below is really asking. */
const folded = (axis: Axis, key: string): boolean =>
	axis.folds.some((f) => day(key) >= f.firstDay && day(key) <= f.lastDay);

/**
 * A year of twenty dated points — synthetic, and shaped like the case this feature exists for: one
 * lone point months ahead of everything else, a dense cluster, and four long stretches in which
 * nothing whatever happens. Every date is chosen here; none is copied from anywhere.
 */
const YEAR = [
	point('2030-01-03'),
	// the cluster — nothing between any two of these is long enough to fold
	point('2030-04-15'), point('2030-04-16'), point('2030-04-22'), point('2030-04-29'),
	point('2030-05-06'), point('2030-05-13'), point('2030-05-20'), point('2030-05-27'),
	// a 13-day hole, deliberately UNDER the 18-day week threshold
	point('2030-06-10'), point('2030-06-11'),
	// then three long stretches
	point('2030-08-05'), point('2030-08-12'), point('2030-08-19'),
	point('2030-10-07'), point('2030-10-14'),
	point('2030-11-25'), point('2030-12-02'), point('2030-12-09'), point('2030-12-16'),
];
/** A day with nothing near it, so `today` never perturbs a fixture that did not ask for it. */
const FAR = day('2035-01-01');

test('with folding off, the axis is exactly what it has always been — one uniform repeat()', () => {
	const axis = buildAxis(YEAR, { today: FAR, fold: false })!;
	assert.equal(axis.folds.length, 0, 'nothing folds');
	assert.match(axis.template, /^repeat\(\d+, var\(--dt-gantt-day\)\)$/, 'and the template is a single repeat');
	assert.equal(axis.columns, axis.days, 'one column per drawn day');
	// A year is a week-scale picture, and that rule is untouched by any of this.
	assert.equal(axis.scale, 'week');
});

test('a long run in which nothing starts or ends is folded; a short one is left as real time', () => {
	const axis = buildAxis(YEAR, { today: FAR })!;
	// The 102-day stretch between the lone January point and the April cluster is the case in point.
	assert.ok(folded(axis, '2030-02-20'), 'the middle of the long January–April gap is folded away');
	// The 13-day hole in June is under the 18-day threshold a week-scale chart carries.
	assert.ok(!folded(axis, '2030-06-04'), 'a 13-day hole is not long enough to fold');
	// Nor is anything inside the cluster, where the largest hole is seven days.
	assert.ok(!folded(axis, '2030-05-01'), 'and nothing inside the cluster folds');
	// The boundary days themselves are always live — a fold that swallowed a date would hide a record.
	for (const key of ['2030-01-03', '2030-04-15', '2030-08-05', '2030-12-16']) {
		assert.ok(!folded(axis, key), `${key} carries a record, so it stays live`);
	}
	assert.ok(axis.folds.length >= 3, `several stretches qualify (got ${axis.folds.length})`);
	assert.ok(axis.liveDays < axis.days, 'so the drawn width is less than the calendar it covers');
});

test('the threshold is 120px at the RAW scale — four days when the chart is drawn day by day', () => {
	// A 40-day picture: day scale, so the threshold is ceil(120 / 30) = 4 days.
	const short = buildAxis([point('2030-03-01'), point('2030-03-08'), point('2030-04-05')], { today: FAR })!;
	assert.equal(DAY_PX['day'], 30, 'the day column width the threshold is derived from');
	assert.ok(folded(short, '2030-03-20'), 'a 28-day hole in a day-scale chart folds');
	assert.ok(folded(short, '2030-03-04'), 'and so does a 6-day one, at four days');
});

test('a run containing today is never folded — the now-marker may not hide inside a fold', () => {
	const axis = buildAxis(YEAR, { today: day('2030-02-20') })!;
	assert.ok(!folded(axis, '2030-02-20'), 'today is a boundary like any start or end');
	// It splits the long gap rather than cancelling the fold: both halves are still long enough.
	assert.ok(folded(axis, '2030-01-25'), 'the stretch before today still folds');
	assert.ok(folded(axis, '2030-03-25'), 'and the stretch after it too');
});

test('once the dead time is gone the surviving live days choose the scale', () => {
	// A raw span of nine months — week scale on the old rule — but only a fortnight of it is live.
	// The whole point of the feature: the dense part becomes readable.
	const sparse = [point('2030-01-01'), bar('2030-10-01', '2030-10-12')];
	assert.equal(buildAxis(sparse, { today: FAR, fold: false })!.scale, 'week', 'unfolded, it is a week-scale year');
	assert.equal(buildAxis(sparse, { today: FAR })!.scale, 'day', 'folded, the live fortnight is drawn day by day');
});

test('a bar crossing a fold is continuous — its grid lines enclose the fold column', () => {
	// One long bar and one point: the bar's own interior is a run in which nothing changes, which is
	// exactly what the no-change rule is for.
	const axis = buildAxis([bar('2030-01-01', '2030-06-30'), point('2030-03-15')], { today: FAR })!;
	assert.ok(axis.folds.length >= 1, 'the bar’s interior folds');
	const startLine = axis.columnOf(day('2030-01-01'));
	const endLine = axis.columnOf(day('2030-06-30')) + 1;
	assert.ok(endLine > startLine, 'the bar still spans forwards');
	for (const fold of axis.folds) {
		assert.ok(fold.column >= startLine && fold.column < endLine, 'and it covers every fold it crosses');
	}
});

test('every drawn day maps to a column inside the grid, and live days never share one', () => {
	const axis = buildAxis(YEAR, { today: FAR })!;
	const seen = new Map<number, number>();
	for (let d = axis.origin; d < axis.origin + axis.days; d++) {
		const column = axis.columnOf(d);
		assert.ok(column >= 1 && column <= axis.columns, `day ${d} maps to ${column}, outside 1..${axis.columns}`);
		seen.set(column, (seen.get(column) ?? 0) + 1);
	}
	// A column shared by more than one day is a folded column, and there is one per fold.
	const shared = [...seen.values()].filter((n) => n > 1).length;
	assert.equal(shared, axis.folds.length, 'exactly the folds collapse many days onto one column');
});

test('the grid template describes the columns it claims to have', () => {
	const axis = buildAxis(YEAR, { today: FAR })!;
	const declared = [...axis.template.matchAll(/repeat\((\d+), var\(--dt-gantt-day\)\)|var\(--dt-gantt-fold\)/g)]
		.reduce((n, m) => n + (m[1] ? Number(m[1]) : 1), 0);
	assert.equal(declared, axis.columns, 'the template and the column count cannot disagree');
	// Ticks live inside live segments only, so none may straddle a fold.
	for (const tick of axis.ticks) {
		for (const fold of axis.folds) {
			assert.ok(tick.column + tick.columns <= fold.column || tick.column > fold.column, 'no tick straddles a fold');
		}
	}
});

test('expanding a fold opens its days without moving the scale', () => {
	const shut = buildAxis(YEAR, { today: FAR })!;
	const first = shut.folds[0]!;
	const open = buildAxis(YEAR, { today: FAR, expanded: new Set([first.key]) })!;
	assert.equal(open.scale, shut.scale, 'the scale is fixed by the automatic folds, not by what is open');
	assert.ok(open.columns > shut.columns, 'the opened run contributes its days');
	assert.equal(open.folds.length, shut.folds.length, 'and the fold keeps its seam, so it can be shut again');
	assert.equal(open.folds[0]!.expanded, true);
});

test('no placeable record means no axis at all', () => {
	assert.equal(buildAxis([], { today: FAR }), null);
});

/**
 * ⚠ A BAND'S EXTENT BAR IS AN ENVELOPE, NOT AN ACTIVITY — and that is the difference between it and
 * a record's bar. "A bar crossing a fold draws unbroken through it" is RIGHT for a record, which
 * genuinely occupies that time. It is WRONG for a lane's min-to-max rule, which occupies nothing:
 * drawn unbroken, a lane that worked for two months in 2024 and two in 2026 reads as thirty months
 * of continuous work, and it reads that way most strongly when the lane is COLLAPSED, which is the
 * state this layout opens in.
 *
 * Reported by the operator as the rows compressing more than the lane above them, which is exactly
 * what it looks like: the children show the seams, the parent hides them.
 *
 * `bandRuns` is the fix — the lane's OWN coverage, merged where its records touch and split wherever
 * the axis itself is broken. Two sources of discontinuity, no new threshold for either.
 */
test('a lane’s extent breaks where its own work stops, and again where the axis is folded', () => {
	// Two bursts a year apart. Nothing else on the chart, so the year between them folds.
	const burstA: AxisSpan[] = [bar('2030-01-06', '2030-01-20'), bar('2030-01-18', '2030-02-03')];
	const burstB: AxisSpan[] = [bar('2030-11-04', '2030-11-24')];
	const axis = buildAxis([...burstA, ...burstB], { today: FAR })!;
	assert.ok(axis.folds.length >= 1, 'the empty middle folds');

	const runs = bandRuns([...burstA, ...burstB]);
	assert.equal(runs.length, 2, `the lane ran twice, so it draws twice (got ${runs.length})`);
	// The two overlapping spans of the first burst are ONE run — a lane is not shredded by every
	// record boundary inside it.
	assert.equal(runs[0]!.start, day('2030-01-06'));
	assert.equal(runs[0]!.end, day('2030-02-03'));
	assert.equal(runs[1]!.start, day('2030-11-04'));
	assert.equal(runs[1]!.end, day('2030-11-24'));
	// And no run may straddle a fold, or the break would be decorative rather than real.
	for (const run of runs) {
		for (const fold of axis.folds) {
			assert.ok(run.end < fold.firstDay || run.start > fold.lastDay, 'a run stops at the seam');
		}
	}
	// Active days are what the lane actually held, not the envelope it spans.
	const active = runs.reduce((n, r) => n + (r.end - r.start + 1), 0);
	assert.equal(active, 29 + 21, 'active days, not the 323-day envelope');
});

test('a contiguous lane still draws as one run, and one long bar is not split by its own interior', () => {
	// A single bar whose middle folds: the RECORD keeps drawing through it (that is the whole point
	// of the no-change rule), and the lane made of that one record is one run of coverage.
	const one: AxisSpan[] = [bar('2030-01-01', '2030-12-31')];
	const axis = buildAxis(one, { today: FAR })!;
	const runs = bandRuns(one);
	assert.equal(runs.length, 1, 'the lane is occupied throughout, whatever the axis does to it');
	assert.equal(runs[0]!.start, day('2030-01-01'));
	assert.equal(runs[0]!.end, day('2030-12-31'));
});

test('bandRuns returns nothing for a lane with no placeable records', () => {
	assert.deepEqual(bandRuns([]), []);
});

test('a range label keeps the YEAR when its two ends are in different ones', () => {
	// The live 4-run lane rendered as `Sep 2 – Sep 30`, which reads as 28 days for a span of
	// thirteen months — undoing in words the honesty the segmented bar had just won.
	assert.equal(rangeLabel('2026-09-02', '2027-09-30'), 'Sep 2 ’26 – Sep 30 ’27');
	// Within one year the year is noise, so it stays off.
	assert.equal(rangeLabel('2030-03-09', '2030-05-10'), 'Mar 9 – May 10');
	// A single day is one date, not a range of one.
	assert.equal(rangeLabel('2030-03-09', '2030-03-09'), 'Mar 9');
});
