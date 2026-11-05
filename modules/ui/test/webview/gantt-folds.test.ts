/**
 * FOLDING DEAD TIME, as the reader meets it. `test/unit/gantt-axis.test.ts` pins the arithmetic —
 * which runs fold, at what threshold, and what the scale does about it. This file asks the separate
 * question a pure test cannot: does the LAYOUT actually consume it? A gantt that computed four
 * perfect folds and drew a uniform grid would pass every assertion in tier 1.
 *
 * Three claims, and the third is the one that would go wrong silently: the header track and every
 * row track must carry the SAME `grid-template-columns`, because that identity is the only thing
 * making a tick land over the bar it names. A fold is a column of a different width in the middle of
 * that string, so a stale `repeat()` anywhere would slide every bar past its own date with nothing
 * on screen saying so.
 *
 * ⚠ Never import `register-defaults` here — it reaches ListMap and therefore leaflet's CSS, whose
 * png urls this tier has no loader for. What a bar needs is registered inline, below.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { FieldChoice, FieldRow, ItemRecord } from '../../webview/src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import ListGantt from '../../webview/src/lists/ListGantt.vue';

views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const dateField = (name: string): FieldRow => fieldRow(name, { type: 'date' });
const enumField = (name: string, choices: FieldChoice[]): FieldRow => enumRow(name, choices);
const plainField = (name: string): FieldRow => fieldRow(name);
const FIELDS = [plainField('name'), dateField('due')];

/**
 * A year of milestones — synthetic, and shaped like the case this exists for: one lone point months
 * ahead of the rest, a cluster, and long stretches in which nothing happens at all. `due` is both
 * ends, so every record is a POINT, which is the shape that suffers most from an empty axis.
 */
const YEAR: ItemRecord[] = [
	'2030-01-03',
	'2030-04-15', '2030-04-16', '2030-04-22', '2030-04-29',
	'2030-05-06', '2030-05-13', '2030-05-20', '2030-05-27',
	'2030-06-10', '2030-06-11',
	'2030-08-05', '2030-08-12', '2030-08-19',
	'2030-10-07', '2030-10-14',
	'2030-11-25', '2030-12-02', '2030-12-09', '2030-12-16',
].map((due, i) => ({ id: String(i + 1), name: `m${i + 1}`, due }));

const gantt = (options: Record<string, unknown> = {}, records: ItemRecord[] = YEAR) =>
	render(ListGantt, {
		state: fakeState({ fields: FIELDS, records, options: { start: 'due', end: 'due', ...options } }),
	});

/** Only what ListGantt actually reaches for — the composable itself drags a router and the host. */
function fakeState(init: { fields: FieldRow[]; records: ItemRecord[]; options?: Record<string, unknown> }) {
	const fields = ref(init.fields) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		columns: fields,
		fields: { visibleFields: fields, fields },
		items: {
			items: ref(init.records) as Ref<ItemRecord[]>,
			loading: ref(false),
			reload: async () => {},
			setSort: () => {},
		},
		listOptions: ref({ gantt: init.options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		// the colour axis as browse-state answers it: the view's `color_by` (no collection display here)
		colorBy: computed(() => (typeof init.options?.['color_by'] === 'string' ? (init.options['color_by'] as string) : null)),
		selectedIds: computed(() => [] as string[]),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

const foldCells = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-fold'));
const strips = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-fold-strip'));
const tracks = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-track'));
const canvas = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-gantt-canvas'))!;
const templateOf = (n: TestNode) => String(((n.props['style'] ?? {}) as Record<string, string>)['gridTemplateColumns'] ?? '');

test('a long dead stretch becomes one narrow column that names its range and its cost', async () => {
	const root = await gantt();
	const cells = foldCells(root);
	assert.ok(cells.length >= 3, `several stretches fold (got ${cells.length})`);

	// The label speaks the scale's vocabulary — ISO weeks on a year-long chart — not a day count.
	const labels = cells.map((c) => text(c));
	assert.ok(labels.every((l) => /^W\d+…W\d+$/.test(l.trim())), `every fold names its weeks, got ${JSON.stringify(labels)}`);
	// And the cost is on the cell itself, so the reader knows what opening it will spend.
	assert.ok(
		cells.every((c) => /\d+ days hidden — click to show/.test(String(c.props['title'] ?? ''))),
		'and says how many days it is hiding',
	);
	// One inert full-height strip per fold, so the discontinuity is visible where the bars are.
	assert.equal(strips(root).length, cells.length, 'each fold gets its strip down the canvas');
});

test('folding is what makes the picture narrower than the calendar it covers', async () => {
	const folded = await gantt();
	const flat = await gantt({ fold_gaps: false });
	const columns = (root: TestNode) =>
		(templateOf(tracks(root)[0]!).match(/repeat\((\d+),/g) ?? []).reduce((n, m) => n + Number(m.slice(7, -1)), 0);

	assert.ok(columns(folded) < columns(flat), 'the folded axis spends fewer day columns');
	assert.equal(foldCells(flat).length, 0, 'and with fold_gaps off there is no fold at all');
	assert.match(templateOf(tracks(flat)[0]!), /^repeat\(\d+, var\(--dt-gantt-day\)\)$/, 'just the uniform grid it always had');
});

test('the header track and every row track are the same grid, fold columns included', async () => {
	const root = await gantt();
	const all = tracks(root).map(templateOf);
	assert.ok(all.length > 1, 'there is a header track and at least one row track');
	assert.ok(all[0]!.includes('var(--dt-gantt-fold)'), 'the template carries the fold columns');
	for (const template of all) {
		assert.equal(template, all[0], 'a track that disagrees slides every bar past its own date');
	}
});

test('clicking a fold opens its days and leaves the scale exactly where it was', async () => {
	const root = await gantt();
	const scaleBefore = hasClass(canvas(root), 'dt-gantt--week');
	assert.ok(scaleBefore, 'a year of milestones is a week-scale picture');
	const before = templateOf(tracks(root)[0]!);

	const cell = foldCells(root)[0]!;
	(cell.props['onClick'] as (e: unknown) => void)({});
	await flush();

	const after = templateOf(tracks(root)[0]!);
	assert.notEqual(after, before, 'the opened run contributed its days');
	assert.ok(hasClass(canvas(root), 'dt-gantt--week'), '⚠ and the scale did NOT move under the click');
	// The seam survives, or the reader could never shut it again.
	const open = foldCells(root).filter((c) => hasClass(c, 'is-open'));
	assert.equal(open.length, 1, 'the opened fold keeps its seam, marked open');
	assert.match(String(open[0]!.props['title'] ?? ''), /days shown — click to fold/);
});

/**
 * ⚠ THE PARENT MUST SHOW WHAT THE CHILDREN SHOW. `gantt-axis.test.ts` pins `bandRuns` as
 * arithmetic; this asks the only question it cannot — does the LANE actually draw as several
 * segments? A layout that computed perfect runs and rendered one envelope bar would pass every pure
 * assertion and still tell the operator that a lane which ran twice ran continuously, which is the
 * defect he reported.
 */
test('a lane that stopped and restarted draws one bar per run, not one envelope', async () => {
	const lane = enumField('lane', [{ label: 'Alpha', value: 'alpha' }, { label: 'Bravo', value: 'bravo' }]);
	const fields = [plainField('name'), lane, dateField('starts'), dateField('ends')];
	// Alpha works twice, ten months apart. Bravo works once, inside Alpha's first burst — so the
	// empty middle carries no boundary at all and folds.
	const records: ItemRecord[] = [
		{ id: '1', name: 'a1', lane: 'alpha', starts: '2030-01-06', ends: '2030-01-20' },
		{ id: '2', name: 'a2', lane: 'alpha', starts: '2030-01-18', ends: '2030-02-03' },
		{ id: '3', name: 'a3', lane: 'alpha', starts: '2030-11-04', ends: '2030-11-24' },
		{ id: '4', name: 'b1', lane: 'bravo', starts: '2030-01-10', ends: '2030-01-28' },
	];
	const root = await render(ListGantt, {
		state: fakeState({
			fields,
			records,
			options: { start: 'starts', end: 'ends', group_by: 'lane', start_collapsed: false },
		}),
	});

	const laneOf = (name: string) =>
		all(root, (n) => hasClass(n, 'dt-gantt-band')).find((b) =>
			text(find(b, (n) => hasClass(n, 'dt-group-header__label'))!).toLowerCase().includes(name),
		)!;
	const barsIn = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-gantt-band-bar'));

	const alpha = laneOf('alpha');
	assert.equal(barsIn(alpha).length, 2, 'Alpha ran twice, so its lane bar is drawn twice');
	// The two abutting records of the first burst are ONE segment, not two.
	assert.equal(barsIn(laneOf('bravo')).length, 1, 'Bravo ran once');

	// And the words agree with the picture — active days, never the envelope.
	const label = text(find(alpha, (n) => hasClass(n, 'dt-gantt-band-bar__label'))!);
	assert.match(label, /2 runs/, `the label says it ran twice, got ${JSON.stringify(label)}`);
	assert.match(label, /50 days active/, 'and counts the days it HELD (29 + 21), not the 323-day envelope');
});
