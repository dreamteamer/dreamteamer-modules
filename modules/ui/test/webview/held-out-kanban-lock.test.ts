// Held-out h1–h6 for cr-vscode-009 — the input classes the plan review held out of the builder's sight
// (rnd/tests cr-vscode-009-h1…h6), written at the test stage and committed afterwards so a later gate can
// re-run them: `npm test -- --only=/held-out-kanban-lock.test`. Against 0.24.26's ListKanban.vue, h1–h5
// fail and h6 (the editable board's ungrouped column clearing to null) passes — a regression guard.
// Fixture names are synthetic.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { all, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { onHostRequest, requests, resetHost } from './host-stub';
import type { FieldRow, ItemRecord, SourceEntry } from '../../webview/src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { sourceFieldRow } from '../../webview/src/lib/sources';
import ListKanban from '../../webview/src/lists/ListKanban.vue';

const C = 'demo';
const LOCK = enumRow('gate', ['one', 'two', 'three'], { editable: false, title: 'Gate' });
const OPEN = enumRow('state', ['a', 'b', 'c']);
const BAND = enumRow('band', ['x', 'y', 'z']);
const POS = fieldRow('rank', { type: 'position' as FieldRow['type'] });
const SOURCES: SourceEntry[] = [
	{ name: 'home', kind: 'own', repo: '.', path: 'data/demo', installed: true, count: 2 },
	{ name: 'layer-a', kind: 'layer', repo: 'git_modules/layer-a', path: 'git_modules/layer-a/data/demo', installed: true, count: 1 },
];
const SRC = sourceFieldRow(C, SOURCES);
let FIELDS: FieldRow[] = [LOCK, OPEN, BAND, POS];
let RECORDS: ItemRecord[] = [];

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [{ collection: C }], fields: { [C]: FIELDS }, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		const rec = path.match(/^\/collections\/demo\/records\/([^/?]+)$/);
		if (rec && (method === 'GET' || method === 'PATCH')) {
			const { id, ...fields } = RECORDS.find((r) => r['id'] === rec[1]) ?? { id: rec[1] };
			return { id, fields };
		}
		if (method === 'PATCH' && /^\/collections\/demo\/position\/[^/]+$/.test(path)) return { ok: true };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});
afterEach(() => unmountAll());

async function board(options: Record<string, unknown>, records: ItemRecord[], fields: FieldRow[], manualOrder = false) {
	FIELDS = fields;
	RECORDS = records;
	const f = ref(fields) as Ref<FieldRow[]>;
	const created: unknown[] = [];
	const state = {
		collection: C,
		fields: { visibleFields: f, fields: f },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ kanban: options }) as Ref<Record<string, Record<string, unknown>>>,
		manualOrder: computed(() => manualOrder),
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['id'] ?? ''),
		tintOf: () => undefined,
		openRecord: () => {},
		createRecord: (p?: unknown) => created.push(p),
	};
	return { root: await render(ListKanban, { state }), created };
}
const ev = () => {
	const e = { n: 0, dataTransfer: null, preventDefault: () => void e.n++, stopPropagation: () => {} };
	return e;
};
const cards = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-kanban-core-card'));
const cols = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-kanban-core-col'));
const label = (c: TestNode) => text(all(c, (x) => hasClass(x, 'dt-kanban-core-label'))[0]!).trim();
const bands = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-kanban-core-lane'));
const cardIn = (n: TestNode, id: string) => cards(n).find((c) => all(c, (x) => hasClass(x, 'dt-kanban-core-id')).some((x) => text(x).trim() === id))!;
const patches = () => requests.filter((r) => r.method === 'PATCH');
const adds = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-kanban-core-add'));
const call = (n: TestNode, k: string, e: unknown = ev()) => (n.props[k] as (e: unknown) => unknown)(e);

test('h1: a laned board whose column field is locked accepts a drop in no column of any band', async () => {
	const recs = [
		{ id: 'r1', gate: 'one', band: 'x' },
		{ id: 'r2', gate: 'two', band: 'y' },
		{ id: 'r3', gate: 'three', band: 'z' },
	];
	const { root } = await board({ lanes_by: 'gate', group_by: 'band' }, recs, [LOCK, BAND]);
	assert.ok(cards(root).length === 3 && cards(root).every((c) => c.props['draggable'] === 'false'));
	const [b1, b2] = bands(root);
	const targets = [cols(b1!).find((c) => label(c) === 'two')!, cols(b2!).find((c) => label(c) === 'one')!, cols(b2!).find((c) => label(c) === 'two')!];
	for (const t of targets) {
		call(cardIn(root, 'r1'), 'onDragstart');
		await flush();
		const over = ev();
		call(t, 'onDragover', over);
		await flush();
		assert.equal(over.n, 0, 'preventDefault never called');
		assert.equal(cols(root).filter((c) => hasClass(c, 'is-drop')).length, 0, 'no column lit');
		await call(t, 'onDrop');
		await flush();
	}
	assert.deepEqual(patches(), []);
});

test('h2: the ungrouped column on a locked board does not clear the field on a drop', async () => {
	const recs = [{ id: 'r1', gate: 'one' }, { id: 'r2' }];
	const { root } = await board({ lanes_by: 'gate', show_ungrouped_columns: true }, recs, [LOCK]);
	const ung = cols(root).find((c) => hasClass(c, 'is-ungrouped'));
	assert.ok(ung, 'the ungrouped column is drawn');
	assert.equal(adds(ung!).length, 0, 'no + on it');
	call(cardIn(root, 'r1'), 'onDragstart');
	await flush();
	const over = ev();
	call(ung!, 'onDragover', over);
	assert.equal(over.n, 0);
	await call(ung!, 'onDrop');
	await flush();
	assert.deepEqual(patches(), []);
});

test('h3: position field present but manual order off: no draggable card, no gap, plain reason', async () => {
	const recs = [{ id: 'r1', gate: 'one', rank: 'a' }, { id: 'r2', gate: 'two', rank: 'b' }];
	const { root } = await board({ lanes_by: 'gate' }, recs, [LOCK, POS], false);
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'false'));
	assert.ok(cards(root).every((c) => c.props['title'] === 'Gate is not editable here, so this card cannot be moved to another column.'));
	call(cardIn(root, 'r1'), 'onDragstart');
	await flush();
	assert.equal(all(root, (x) => hasClass(x, 'dt-kanban-core-slot')).length, 0);
	await call(cols(root).find((c) => label(c) === 'two')!, 'onDrop');
	await flush();
	assert.deepEqual(patches(), []);
});

test('h4: $source as lanes_by is locked — no drag write, no +', async () => {
	const recs = [{ id: 'r1', $source: 'home' }, { id: 'r2', $source: 'layer-a' }];
	const { root } = await board({ lanes_by: '$source' }, recs as ItemRecord[], [SRC]);
	assert.ok(cards(root).length === 2);
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'false'));
	assert.ok(cards(root).every((c) => /Source/.test(String(c.props['title'])) && /not editable here/.test(String(c.props['title']))));
	assert.equal(adds(root).length, 0);
	call(cardIn(root, 'r1'), 'onDragstart');
	await flush();
	await call(cols(root).find((c) => label(c) === 'layer-a')!, 'onDrop');
	await flush();
	assert.deepEqual(patches(), []);
});

test('h5: a locked column field with an editable lane field withholds the + in every band', async () => {
	const recs = [{ id: 'r1', gate: 'one', band: 'x' }, { id: 'r2', gate: 'two', band: 'y' }];
	const { root, created } = await board({ lanes_by: 'gate', group_by: 'band' }, recs, [LOCK, BAND]);
	assert.ok(bands(root).length >= 2);
	assert.equal(adds(root).length, 0);
	assert.deepEqual(created, []);
});

test('h6: on an editable board the ungrouped column still clears the field to null', async () => {
	const recs = [{ id: 'r1', state: 'a' }, { id: 'r2' }];
	const { root } = await board({ lanes_by: 'state', show_ungrouped_columns: true }, recs, [OPEN]);
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'true'));
	const ung = cols(root).find((c) => hasClass(c, 'is-ungrouped'))!;
	assert.equal(adds(ung).length, 0);
	call(cardIn(root, 'r1'), 'onDragstart');
	await flush();
	const over = ev();
	call(ung, 'onDragover', over);
	assert.equal(over.n, 1);
	await call(ung, 'onDrop');
	await flush();
	assert.deepEqual(
		patches().map((r) => ({ path: r.path, body: r.body })),
		[{ path: '/collections/demo/records/r1', body: { state: null } }],
	);
});
