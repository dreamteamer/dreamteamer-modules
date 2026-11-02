/**
 * A grouped GANTT: one bar per record on a shared time axis, rows carved into the same bands the
 * table and the cards draw — because grouping is ONE concept named for the axis, and a fourth
 * layout inventing a fourth answer is the thing that concept exists to prevent.
 *
 * The first nine tests are `table-grouping.test.ts`'s nine, re-asked of this layout. That is
 * deliberate duplication: the shared derivation is pinned once in tier 1, but "this layout actually
 * CONSUMES it" is a per-layout claim, and a gantt that computed perfect buckets and drew one flat
 * strip of bars would pass every pure test there is.
 *
 * Then the five that are the gantt's own: an ARRAY group value fans a record into one band per
 * value (the multi mode nothing else uses yet), a record with no start lands in the undated tail
 * rather than vanishing, an end before its start degrades to a marked point instead of a negative
 * bar, the time scale falls out of the span, and a colour-by field paints the bar with the choice's
 * own theme colour.
 *
 * ⚠ Never import `register-defaults` here — it reaches ListMap and therefore leaflet's CSS, whose
 * png urls this tier has no loader for. What a bar needs is registered inline, below.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { FieldChoice, FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow, referenceRow } from '../unit/field-rows';
import { views } from '../../src/registry/index';
import ListGantt from '../../src/lists/ListGantt.vue';

// The gantt renders no field values of its own (a bar is a title and a span), but GroupHeader and
// the shared chrome resolve through the same registry, so one text View keeps the mount honest.
views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});

// This tier has no DOM; a listener sink is enough — nothing here fires a focus event.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function enumField(name: string, choices: FieldChoice[], many = false): FieldRow {
	return enumRow(name, choices, many ? { many: true } : {});
}
const dateField = (name: string): FieldRow => fieldRow(name, { type: 'date' });
const plainField = (name: string): FieldRow => fieldRow(name);

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

const LANE = enumField('lane', [
	{ label: 'Alpha', value: 'alpha', icon: 'rocket', color: 'charts.blue', description: 'the one that ships' },
	{ label: 'Bravo', value: 'bravo' },
]);

const START = dateField('starts');
const END = dateField('ends');

const RECORDS: ItemRecord[] = [
	{ id: '1', name: 'one', lane: 'alpha', starts: '2026-03-02', ends: '2026-03-05' },
	{ id: '2', name: 'two', lane: 'alpha', starts: '2026-03-04', ends: '2026-03-06' },
	{ id: '3', name: 'three', lane: 'bravo', starts: '2026-03-03', ends: '2026-03-09' },
];

const FIELDS = [plainField('name'), LANE, START, END];

const bands = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-band'));
const headers = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-group-header'));
const rows = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-gantt-row'));
const bars = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-gantt-bar'));
const canvas = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-gantt-canvas'))!;
const labels = (root: TestNode) =>
	headers(root).map((h) => text(find(h, (n) => hasClass(n, 'dt-group-header__label'))!));

// `end` is passed on purpose: blank means "a point, not a bar" (the option's own placeholder),
// so a fixture that wants BARS has to name the end field, exactly as a view would.
// ⚠ `start_collapsed: false` AND `fold_gaps: false` are the harness DEFAULTS, not the product's, for
// the same reason on both axes. A grouped gantt opens with every lane shut and every dead stretch
// folded — that is the point of each, and each has its own dedicated file — but these tests are
// about BANDING. Left collapsed, every one of them would assert "zero rows"; left folding, the scale
// tests below would measure the folded picture instead of the span rule they were written for. A
// test that cares about either default says so explicitly.
//
// ⚠ In particular `the time scale falls out of the span` is now a claim about the UNFOLDED axis. Its
// 200-day fixture is ONE bar, so its own interior is a run in which nothing starts or ends, and with
// folding on the live picture is a fortnight drawn day by day. `test/unit/gantt-axis.test.ts` pins
// that behaviour; this pins the rule it is derived from.
const gantt = (options: Record<string, unknown> = {}, records: ItemRecord[] = RECORDS, fields: FieldRow[] = FIELDS) =>
	render(ListGantt, {
		state: fakeState({ fields, records, options: { end: 'ends', start_collapsed: false, fold_gaps: false, ...options } }),
	});

// ── the nine, re-asked of this layout ────────────────────────────────────────────────────────────

test('with no group_by the gantt is one unheaded band of bars', async () => {
	const root = await gantt();
	assert.equal(bands(root).length, 1, 'one band, the ungrouped invariant');
	assert.equal(headers(root).length, 0, 'and no band header anywhere');
	assert.equal(rows(root).length, 3);
	assert.equal(bars(root).length, 3, 'every record got a bar');
});

test('a group field makes one band per value, in the enum’s declared order', async () => {
	const root = await gantt({ group_by: 'lane' });
	assert.equal(bands(root).length, 2);
	assert.deepEqual(labels(root), ['Alpha', 'Bravo']);
});

test('each band holds its own rows, and the header counts them', async () => {
	const root = await gantt({ group_by: 'lane' });
	const [alpha, bravo] = bands(root);
	assert.equal(rows(alpha!).length, 2);
	assert.equal(rows(bravo!).length, 1);
	assert.match(text(headers(root)[0]!), /2/);
	assert.match(text(headers(root)[1]!), /1/);
});

test('the header carries the decoration the engine projected', async () => {
	const root = await gantt({ group_by: 'lane' });
	const alpha = headers(root)[0]!;
	assert.match(text(alpha), /the one that ships/, 'the description');
	assert.ok(
		all(alpha, (n) => hasClass(n, 'codicon')).some((g) => String(g.props['class']).includes('codicon-rocket')),
		'the glyph',
	);
});

test('an empty declared band is dropped by default — a band is not a drop target', async () => {
	const root = await gantt({ group_by: 'lane' }, [RECORDS[0]!]);
	assert.equal(bands(root).length, 1, 'Bravo is declared but holds nothing, so Bravo is not drawn');
	assert.deepEqual(labels(root), ['Alpha']);
});

test('show_empty_rows brings it back, count and all', async () => {
	const root = await gantt({ group_by: 'lane', show_empty_rows: true }, [RECORDS[0]!]);
	assert.equal(bands(root).length, 2);
	assert.match(text(headers(root)[1]!), /0/, 'and it says it is empty rather than looking broken');
});

test('records with no value are hidden until show_ungrouped_rows asks for them', async () => {
	const records = [...RECORDS, { id: '4', name: 'four', lane: '', starts: '2026-03-07' }];
	const hidden = await gantt({ group_by: 'lane' }, records);
	assert.equal(rows(hidden).length, 3, 'the value-less record is not drawn');

	const shown = await gantt({ group_by: 'lane', show_ungrouped_rows: true }, records);
	assert.equal(rows(shown).length, 4);
	assert.equal(bands(shown).length, 3);
});

test('a group_by naming a field the collection does not carry degrades to ungrouped', async () => {
	// A typo in a ui-view must never erase the picture — the same posture every other layout takes.
	const root = await gantt({ group_by: 'not_a_field' });
	assert.equal(bands(root).length, 1);
	assert.equal(rows(root).length, 3);
});

test('a band collapses, and collapsing hides its rows without losing the header', async () => {
	const root = await gantt({ group_by: 'lane' });
	const toggle = find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-group-toggle'));
	assert.ok(toggle, 'each band header has a collapse control');

	await (toggle.props['onClick'] as () => void)();
	await flush();

	assert.equal(headers(root).length, 2, 'both headers stay');
	assert.equal(rows(root).length, 1, 'only the collapsed band’s rows went');
});

// ── the gantt's own five ─────────────────────────────────────────────────────────────────────────

test('a record whose group field is an ARRAY appears in one band per value', async () => {
	// The single-value path would `String(['alpha','bravo'])` this into one band called `alpha,bravo`
	// — a band nobody declared, named after a join. `bucketize`'s multi mode is what the gantt asks
	// for, and this is the only layout that does today.
	const tags = enumField('tags', [{ label: 'Alpha', value: 'alpha' }, { label: 'Bravo', value: 'bravo' }], true);
	const records: ItemRecord[] = [
		{ id: '1', name: 'both', tags: ['alpha', 'bravo'], starts: '2026-03-02', ends: '2026-03-05' },
		{ id: '2', name: 'one', tags: ['bravo'], starts: '2026-03-03', ends: '2026-03-04' },
	];
	const root = await gantt({ group_by: 'tags' }, records, [plainField('name'), tags, START, END]);

	assert.deepEqual(labels(root), ['Alpha', 'Bravo']);
	const [alpha, bravo] = bands(root);
	assert.equal(rows(alpha!).length, 1);
	assert.equal(rows(bravo!).length, 2, 'the two-tag record is in this band too — the same record, twice');
	assert.equal(rows(root).length, 3, 'two records, three rows: a fan-out, not a duplicate fetch');
});

test('a record with no start is listed in the undated tail, with a count', async () => {
	// Dropping it silently is the failure mode: a gantt is the one layout where a record with no
	// date is invisible for a REASON, and the reason has to be on screen.
	const records = [...RECORDS, { id: '4', name: 'no dates yet' }, { id: '5', name: 'also undated' }];
	const root = await gantt({}, records);

	assert.equal(rows(root).length, 3, 'the undated records have no bar to draw');
	const tail = find(root, (n) => hasClass(n, 'dt-gantt-undated'));
	assert.ok(tail, 'the tail exists rather than the records vanishing');
	assert.match(text(tail), /2/, 'and it says how many');
	assert.match(text(tail), /no dates yet/, 'naming them, so they can be opened and fixed');
});

test('an end before its start renders as a marked point, not a negative bar', async () => {
	const records: ItemRecord[] = [{ id: '1', name: 'backwards', starts: '2026-03-10', ends: '2026-03-05' }];
	const root = await gantt({}, records);
	const bar = bars(root)[0]!;
	assert.ok(hasClass(bar, 'dt-gantt-bar--inverted'), 'the bar says the data is inverted');
	assert.match(String(bar.props['title'] ?? ''), /before/i, 'and the tooltip says why, in words');
});

test('the time scale falls out of the span — days for a short one, weeks for a long one', async () => {
	const short = await gantt({}, [{ id: '1', name: 'a', starts: '2026-03-02', ends: '2026-03-11' }]);
	assert.ok(hasClass(canvas(short), 'dt-gantt--day'), 'a 10-day span is drawn day by day');

	const long = await gantt({}, [{ id: '1', name: 'a', starts: '2026-03-02', ends: '2026-09-18' }]);
	assert.ok(hasClass(canvas(long), 'dt-gantt--week'), 'a 200-day span is drawn week by week');

	const years = await gantt({}, [{ id: '1', name: 'a', starts: '2026-03-02', ends: '2029-03-02' }]);
	assert.ok(hasClass(canvas(years), 'dt-gantt--month'), 'and anything longer, month by month');
});

test('color_by paints the bar with the choice’s own theme colour', async () => {
	const stream = enumField('stream', [
		{ label: 'Alpha', value: 'alpha', color: 'charts.blue' },
		{ label: 'Bravo', value: 'bravo' },
	]);
	const records: ItemRecord[] = [
		{ id: '1', name: 'one', stream: 'alpha', starts: '2026-03-02', ends: '2026-03-05' },
		{ id: '2', name: 'two', stream: 'bravo', starts: '2026-03-03', ends: '2026-03-06' },
	];
	const root = await gantt({ color_by: 'stream' }, records, [plainField('name'), stream, START, END]);

	const [first, second] = bars(root);
	const styleOf = (n: TestNode) => (n.props['style'] ?? {}) as Record<string, string>;
	// A theme colour ID, never a hex — a hex is authored against one theme and wrong in the other.
	assert.equal(styleOf(first!)['--dt-gantt-bar'], 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))');
	// The undecorated value still gets a stable colour, from the deterministic palette — and it is
	// not the same one, or colouring by that field would say nothing.
	assert.match(String(styleOf(second!)['--dt-gantt-bar'] ?? ''), /^var\(--vscode-charts-/);
	assert.notEqual(styleOf(second!)['--dt-gantt-bar'], styleOf(first!)['--dt-gantt-bar']);
});

// ── the label that rides in the timeline (2026-09-08) ────────────────────────────────────────────
// The gutter is sticky and 180px wide, so it truncates anything longer than about 24 characters while
// the chart beside it sits empty. The bar now carries the text too — INSIDE when it is wide enough to
// hold it, BESIDE it when it is not. The placement is the whole feature: a label that only rendered
// inside would be invisible on exactly the point-sized records that most need naming.

const barLabels = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-bar__label'));

test('a wide bar carries its label INSIDE, a point carries it BESIDE — neither is left unlabelled', async () => {
	const records: ItemRecord[] = [
		// 30px/day at this scale: 10 days is 300px, comfortably over the 72px threshold.
		{ id: '1', name: 'a genuinely long activity title that the gutter cannot show', starts: '2026-03-02', ends: '2026-03-11' },
		// A single day is 30px — under the threshold, so its label goes outside or it cannot be read.
		{ id: '2', name: 'one-day thing', starts: '2026-03-04', ends: '2026-03-04' },
	];
	const root = await gantt({}, records, [plainField('name'), START, END]);

	const [wide, point] = barLabels(root);
	assert.ok(wide && point, 'both bars are labelled — a point is not silently anonymous');
	assert.ok(hasClass(wide, 'is-inside'), 'a 10-day bar has room for its own text');
	assert.ok(hasClass(point, 'is-beside'), 'a 1-day bar does not, so the text sits next to it');
	assert.equal(text(wide), 'a genuinely long activity title that the gutter cannot show');
	assert.equal(text(point), 'one-day thing');
});

test('the bar label is the record title by default — the blank option really is automatic', async () => {
	const root = await gantt();
	assert.ok(barLabels(root).length, 'no option set, and every bar still says what it is');
});

test('bar_label overrides what the BAR says without touching what the gutter says', async () => {
	// The two are different questions: the gutter is the scanning column, the bar is the reading one.
	const records: ItemRecord[] = [
		{ id: '1', name: 'Ship the parser', owner: 'Dana', starts: '2026-03-02', ends: '2026-03-12' },
	];
	const root = await gantt({ bar_label: 'owner' }, records, [plainField('name'), plainField('owner'), START, END]);

	assert.equal(text(barLabels(root)[0]!), 'Dana', 'the bar says the named field');
	const gutter = find(root, (n) => hasClass(n, 'dt-gantt-gutter') && text(n) === 'Ship the parser');
	assert.ok(gutter, 'the gutter still says the title');
});

test('a bar_label that is empty on a record draws no label rather than an empty box', async () => {
	const records: ItemRecord[] = [{ id: '1', name: 'Ship it', owner: '', starts: '2026-03-02', ends: '2026-03-12' }];
	const root = await gantt({ bar_label: 'owner' }, records, [plainField('name'), plainField('owner'), START, END]);
	assert.equal(barLabels(root).length, 0, 'an empty value is nothing to say, not something to say emptily');
});

test('a lane carries its band colour as a rail variable, and an undecorated lane does not invent one', async () => {
	// The rail is the lane's only colour. A band that declared none stays neutral — a gantt already
	// spends its colour budget on the bars, and a second unrelated colour axis behind them is noise.
	const root = await gantt({ group_by: 'lane' });
	const laneStyles = bands(root).map((b) => (b.props['style'] ?? {}) as Record<string, string>);
	assert.ok(laneStyles.some((s) => String(s['--dt-lane-rail'] ?? '').startsWith('var(--vscode-')), 'a decorated band sets its rail');
	assert.ok(laneStyles.some((s) => s['--dt-lane-rail'] === undefined), 'an undecorated band sets nothing and inherits the neutral');
});

test('a grouped gantt marks its sections as lanes; an ungrouped one does not', async () => {
	const grouped = await gantt({ group_by: 'lane' });
	assert.ok(bands(grouped).every((b) => hasClass(b, 'is-lane')), 'grouped sections are lanes');
	const flat = await gantt();
	assert.ok(bands(flat).every((b) => !hasClass(b, 'is-lane')), 'one unheaded band is not a lane and gets no rail or rule');
});

// ── the templates, and the band's own bar (2026-09-08) ───────────────────────────────────────────
// Three asks, one wave: a display template for the BAR, a display template for the BAND, and a band
// header that says when its lane runs. The first two share their syntax and their Edit with the
// cards and the kanban — one template idea, configured one way.

const bandBar = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-gantt-band-bar'));
const bandBarLabels = (root: TestNode) =>
	all(root, (n) => hasClass(n, 'dt-gantt-band-bar__label')).map((n) => text(n));

test('a bar label template renders against the record, and beats bar_label', async () => {
	const root = await gantt({ template: '{{ name }} — {{ lane }}', bar_label: 'name' });
	assert.deepEqual(barLabels(root).map((n) => text(n)), ['one — alpha', 'two — alpha', 'three — bravo']);
});

test('a bar label template collapses whitespace so a multi-line template cannot break the bar', async () => {
	const root = await gantt({ template: '{{ name }}\n  {{ lane }}  ' });
	assert.deepEqual(barLabels(root).map((n) => text(n)), ['one alpha', 'two alpha', 'three bravo']);
});

test('a template that renders to nothing falls through — a sparse field is not a wall of nameless bars', async () => {
	// `{{ summary }}` over a collection where one record in ten carries a summary is a legitimate
	// template. Returning '' for the other nine drew bars with no name at all; the record's own title
	// is right there and is what every un-templated gantt already shows.
	const records: ItemRecord[] = [
		{ id: '1', name: 'one', summary: 'the week it landed', starts: '2026-03-02', ends: '2026-03-04' },
		{ id: '2', name: 'two', summary: '', starts: '2026-03-05', ends: '2026-03-07' },
	];
	const fields = [plainField('name'), plainField('summary'), START, END];
	const root = await gantt({ template: '{{ summary }}' }, records, fields);
	assert.deepEqual(barLabels(root).map((n) => text(n)), ['the week it landed', 'two']);
	// And the fall-through respects the tier below it, not just the title.
	const named = await gantt({ template: '{{ summary }}', bar_label: 'name' }, records, fields);
	assert.deepEqual(barLabels(named).map((n) => text(n)), ['the week it landed', 'two']);
});

test('with no template the bar keeps the named field, and with neither the record title', async () => {
	assert.deepEqual(barLabels(await gantt({ bar_label: 'lane' })).map((n) => text(n)), ['alpha', 'alpha', 'bravo']);
	assert.deepEqual(barLabels(await gantt()).map((n) => text(n)), ['one', 'two', 'three']);
});

test('each band draws its own bar: first start to last end, with the extent in words', async () => {
	const root = await gantt({ group_by: 'lane' });
	// alpha runs 03-02 → 03-06 (5 days), bravo 03-03 → 03-09 (7 days)
	assert.equal(bandBar(root).length, 2, 'one band bar per band');
	assert.deepEqual(bandBarLabels(root), ['Mar 2 – Mar 6 · 5 days', 'Mar 3 – Mar 9 · 7 days']);
});

test('a band of one single-day record reads as a day, not a range, and says "1 day"', async () => {
	const root = await gantt({ group_by: 'lane' }, [
		{ id: '1', name: 'one', lane: 'alpha', starts: '2026-03-02', ends: '2026-03-02' },
	]);
	assert.deepEqual(bandBarLabels(root), ['Mar 2 · 1 day']);
});

test('the band header is not a row — a three-record band counts three, not four', async () => {
	const root = await gantt({ group_by: 'lane' });
	assert.equal(rows(root).length, 3, 'headers must never be counted as records');
	assert.equal(all(root, (n) => hasClass(n, 'dt-gantt-band-row')).length, 2, 'and each band has one header row');
});

test('a collapsed band keeps its own bar — that is what makes collapsing useful', async () => {
	const root = await gantt({ group_by: 'lane' });
	const toggle = find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-group-toggle'))!;
	await (toggle.props['onClick'] as () => void)();
	await flush();
	assert.equal(rows(root).length, 1, 'alpha’s two rows went');
	assert.equal(bandBar(root).length, 2, 'both band bars stayed');
	assert.deepEqual(bandBarLabels(root), ['Mar 2 – Mar 6 · 5 days', 'Mar 3 – Mar 9 · 7 days']);
});

// ── a band grouped by a LIST OF REFERENCES ───────────────────────────────────────────────────────
// The "who was this work with" axis: `collaborators` on an activity is an array of references, so it
// exercises MULTI and the band-label resolution AT THE SAME TIME — the one combination nothing else
// in the product uses, and the one the operator found looking wrong. `idFor` cannot split such a
// value on the first slash (the collection is namespaced and the id carries one too), which is why
// the target comes from `/relations` and not from the string.

const refField = (name: string): FieldRow => referenceRow(name, true);

test('a band grouped by a list of REFERENCES resolves each name through the referenced record', async () => {
	// ⚠ `/relations` is NOT a host route: the adapter answers it from the cached `/presentation`
	// contract, so the relation has to be seeded THERE and both caches dropped — the adapter's and
	// the composable's. Stubbing `/relations` alone silently keeps the previous test's empty list,
	// and the band then falls back to the de-slugged path while looking exactly like a product bug.
	const { invalidateRelations } = await import('../../src/composables/fields');
	const { invalidateContract } = await import('../../src/api/adapter');
	invalidateRelations();
	invalidateContract();
	// The HOST's record shape — `{ id, fields }` — because that is what the adapter unwraps.
	const people: Record<string, { id: string; fields: Record<string, unknown> }> = {
		'run/ann': { id: 'run/ann', fields: { name: 'Ann Example' } },
		'run/bo': { id: 'run/bo', fields: { name: 'Bo Example' } },
	};
	onHostRequest((method, path) => {
		const relations = [{ collection: 'demo', field: 'crew', related_collection: 'ns/people', list: true }];
		if (path === '/presentation') return { collections: [], fields: {}, relations };
		if (path === '/info') return { name: 'scratch' };
		// ⚠ The HOST route, not the caller's: the adapter rewrites `/items/:c/:id` to
		// `/collections/:c/records/:id`, and the collection must arrive as ONE encoded segment. A stub
		// that matched `/collections/ns/records/people/…` would accept the very bug this pins — the
		// namespaced name cut at its first slash, fetching a nonexistent collection and resolving null.
		const hit = /^\/collections\/ns%2Fpeople\/records\/(.+)$/.exec(path);
		if (hit) return people[decodeURIComponent(hit[1]!)] ?? null;
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const records: ItemRecord[] = [
		{ id: '1', name: 'spec it', crew: ['ns/people/run/ann'], starts: '2026-03-02', ends: '2026-03-05' },
		{ id: '2', name: 'build it', crew: ['ns/people/run/ann', 'ns/people/run/bo'], starts: '2026-03-04', ends: '2026-03-08' },
	];
	const fields = [plainField('name'), refField('crew'), START, END];
	const root = await render(ListGantt, {
		state: fakeState({ fields, records, options: { end: 'ends', start_collapsed: false, fold_gaps: false, group_by: 'crew', group_title: '{{ name }}' } }),
	});
	// The chain is two dynamic imports and two host round-trips deep (relations, then a record each),
	// so a couple of microtask turns is not enough to say it failed.
	for (let i = 0; i < 12; i++) await flush();
	assert.deepEqual(labels(root), ['Ann Example', 'Bo Example'], 'the band says the person, not the 20 characters of path');
	// And MULTI still holds: the two-collaborator record is drawn in both bands.
	assert.deepEqual(bands(root).map((b) => rows(b).length), [2, 1]);
});

test('a band wears the FACE of the record it points at, and it beats the enum’s codicon', async () => {
	// A board of thirty collaborators is a wall of slugs. `GroupHeader` already renders an <img> when
	// its icon is a reference into a `codec: file` collection — what was missing was anyone feeding
	// it from the record the band points at.
	const { invalidateRelations } = await import('../../src/composables/fields');
	const { invalidateContract } = await import('../../src/api/adapter');
	invalidateRelations();
	invalidateContract();
	const people: Record<string, { id: string; fields: Record<string, unknown> }> = {
		'run/cass': { id: 'run/cass', fields: { name: 'Cass Example', avatar: 'assets/avatars/cass' } },
		'run/dev': { id: 'run/dev', fields: { name: 'Dev Example' } },
	};
	onHostRequest((method, path) => {
		const relations = [{ collection: 'demo', field: 'crew', related_collection: 'ns/people', list: true }];
		if (path === '/presentation') return { collections: [], fields: {}, relations };
		if (path === '/info') return { name: 'scratch' };
		const hit = /^\/collections\/ns%2Fpeople\/records\/(.+)$/.exec(path);
		if (hit) return people[decodeURIComponent(hit[1]!)] ?? null;
		// The asset record itself: `GroupHeader` needs its derived `ext` to build a src, because the
		// filename on disk is `<id>.<suffix>.<ext>` and only the record knows the last part.
		if (path.startsWith('/collections/assets/records/')) return { id: 'avatars/cass', fields: { ext: 'png' } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const records: ItemRecord[] = [
		{ id: '1', name: 'spec it', crew: ['ns/people/run/cass'], starts: '2026-03-02', ends: '2026-03-05' },
		{ id: '2', name: 'build it', crew: ['ns/people/run/dev'], starts: '2026-03-04', ends: '2026-03-08' },
	];
	// ⚠ The host INJECTS the file-codec collections; nothing in this repo may know a workspace's
	// collection is called `assets` (decision 268), so the fixture injects it the way panel.ts does.
	const w = globalThis.window as { __DT_FILE_BASES__?: unknown[] };
	w.__DT_FILE_BASES__ = [{ collection: 'assets', path: 'data/assets', suffix: 'asset', uri: 'vscode-webview://x/assets' }];
	const fields = [plainField('name'), refField('crew'), START, END];
	const root = await render(ListGantt, {
		state: fakeState({ fields, records, options: { end: 'ends', start_collapsed: false, fold_gaps: false, group_by: 'crew' } }),
	});
	for (let i = 0; i < 12; i++) await flush();
	delete w.__DT_FILE_BASES__;
	const imgs = all(root, (n) => hasClass(n, 'dt-group-header__img'));
	assert.equal(imgs.length, 1, 'the one collaborator with an avatar gets a face; the other does not get a blank');
	// ⚠ No template is set here ON PURPOSE. The fetch used to be skipped when nothing wanted a
	// rendered NAME, which silently took the picture with it.
	assert.deepEqual(labels(root), ['Cass', 'Dev'], 'and with no template the de-slugged name still stands');
});

// ── the two limits the review found: a colour axis that repeated, and a sentinel that was fetched ──

test('past the palette the colour axis STOPS rather than repeating, and says how many it dropped', async () => {
	// `i % pool.length` gave the seventh distinct value the same colour as the first — two unrelated
	// lanes rendered identically with nothing saying so. The palette is theme colour IDs and cannot
	// be lengthened (a hex is authored against one theme and wrong in the other), so the honest
	// answer is to colour what fits and name the remainder.
	const records: ItemRecord[] = Array.from({ length: 9 }, (_, i) => ({
		id: String(i + 1), name: `r${i}`, kind: `k${i}`, starts: '2026-03-02', ends: '2026-03-04',
	}));
	const fields = [plainField('name'), plainField('kind'), START, END];
	const root = await gantt({ color_by: 'kind' }, records, fields);
	const rails = all(root, (n) => hasClass(n, 'dt-gantt-bar'))
		.map((n) => String((n.props['style'] as Record<string, string> | undefined)?.['--dt-bar'] ?? ''))
		.filter(Boolean);
	const distinct = new Set(rails);
	assert.equal(distinct.size, rails.length, 'no two coloured bars may share a colour');
	assert.ok(rails.length <= 6, `the palette holds 6, so at most 6 bars are coloured (got ${rails.length})`);
	assert.match(text(root), /more values of kind than the palette has colours/);
});

test('the ungrouped sentinel is never fetched as a record id', async () => {
	// `bucketize` appends a bucket valued `__ungrouped__` when show_ungrouped_rows is on. Feeding it
	// to the band-label resolver fired a guaranteed-404 fetch for an id that cannot exist.
	const { invalidateRelations } = await import('../../src/composables/fields');
	const { invalidateContract } = await import('../../src/api/adapter');
	invalidateRelations();
	invalidateContract();
	const asked: string[] = [];
	onHostRequest((method, path) => {
		const relations = [{ collection: 'demo', field: 'crew', related_collection: 'ns/people', list: true }];
		if (path === '/presentation') return { collections: [], fields: {}, relations };
		if (path === '/info') return { name: 'scratch' };
		if (path.startsWith('/collections/')) { asked.push(path); return { id: 'run/x', fields: { name: 'Someone' } }; }
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const records: ItemRecord[] = [
		{ id: '1', name: 'with', crew: ['ns/people/run/x'], starts: '2026-03-02', ends: '2026-03-04' },
		{ id: '2', name: 'without', starts: '2026-03-03', ends: '2026-03-05' },
	];
	const fields = [plainField('name'), refField('crew'), START, END];
	await render(ListGantt, {
		state: fakeState({ fields, records, options: { end: 'ends', group_by: 'crew', show_ungrouped_rows: true, group_title: '{{ name }}' } }),
	});
	for (let i = 0; i < 12; i++) await flush();
	assert.ok(asked.length > 0, 'the real reference is still resolved');
	assert.ok(!asked.some((p) => p.includes('__ungrouped__')), `the sentinel must never be fetched — asked: ${asked.join(', ')}`);
});

test('a GROUPED gantt opens with every lane shut, and an ungrouped one does not', async () => {
	// ⚠ Default ON. Expanded, a chart of a few hundred records in twenty lanes opens as a wall in
	// which the shape of the year — which lane ran when, and for how long — is the one thing you
	// cannot see. Collapsed, each lane is one row carrying its extent bar and its summary.
	const shut = await render(ListGantt, {
		state: fakeState({ fields: FIELDS, records: RECORDS, options: { end: 'ends', group_by: 'lane' } }),
	});
	assert.equal(rows(shut).length, 0, 'no record rows are drawn');
	assert.equal(bands(shut).length, 2, 'but every band is still there, with its header');
	assert.equal(bandBar(shut).length, 2, 'and each keeps its extent bar — that is what makes the collapsed view worth reading');

	// An ungrouped chart has one unheaded band and no toggle, so collapsing it would hide every
	// record behind a control that is not drawn.
	const flat = await render(ListGantt, {
		state: fakeState({ fields: FIELDS, records: RECORDS, options: { end: 'ends' } }),
	});
	assert.equal(rows(flat).length, 3, 'an ungrouped gantt still shows its records');
});

test('a band SUMMARY renders from the record the band points at, beside its name', async () => {
	// ⚠ A UNIQUE ID, deliberately. `lib/record-cache` is a module-global Map with no reset hook, so a
	// key another test in this file already fetched comes back with THAT test's record — which is
	// correct behaviour for a cache and a real trap for a suite that reuses ids.
	const { invalidateRelations } = await import('../../src/composables/fields');
	const { invalidateContract } = await import('../../src/api/adapter');
	invalidateRelations();
	invalidateContract();
	onHostRequest((method, path) => {
		const relations = [{ collection: 'demo', field: 'crew', related_collection: 'ns/people', list: true }];
		if (path === '/presentation') return { collections: [], fields: {}, relations };
		if (path === '/info') return { name: 'scratch' };
		if (path.startsWith('/collections/')) return { id: 'run/summary-fx', fields: { name: 'Ann Example', status: 'building', activities_count: 12 } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const records: ItemRecord[] = [{ id: '1', name: 'spec it', crew: ['ns/people/run/summary-fx'], starts: '2026-03-02', ends: '2026-03-05' }];
	const fields = [plainField('name'), refField('crew'), START, END];
	const root = await render(ListGantt, {
		state: fakeState({ fields, records, options: { end: 'ends', group_by: 'crew', group_title: '{{ name }}', group_summary: '{{ status }} · {{ activities_count }} activities' } }),
	});
	for (let i = 0; i < 12; i++) await flush();
	assert.match(text(root), /building · 12 activities/, 'the summary is what makes a collapsed lane readable');
	assert.deepEqual(labels(root), ['Ann Example'], 'and the name is still the name');
});
