/**
 * A kanban whose COLUMN field the edit form draws no control for moves no card between columns
 * (cr-vscode-009). Rendered, then driven through the handlers the browser would fire — `dragstart` on a
 * card, `dragover` and `drop` on a column, `drop` on an insertion gap — with every write read off the host
 * stub's `requests`.
 *
 * ⚠ ONE responder serves every case, the editable ones included. A write that never reaches the wire
 * because the harness could not answer `/presentation` would read as "nothing written" on a locked board;
 * the editable case's PATCH, through the same responder, is what proves the wire is live here.
 *
 * Fixture names are synthetic (`demo`, `c1`…), as every test in this repo.
 */
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { all, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { onHostRequest, requests, resetHost } from './host-stub';
import type { FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import ListKanban from '../../src/lists/ListKanban.vue';

const C = 'demo';

const STAGE = enumRow('stage', ['draft', 'review', 'live'], { editable: false, title: 'Stage' });
const STATUS = enumRow('status', ['todo', 'doing', 'done']);
const PHASE = enumRow('phase', ['one', 'two'], { editable: 'create' });
const BUCKET = enumRow('bucket', ['small', 'large'], { kind: 'derived', editable: false });
const TEAM_LOCKED = enumRow('team', ['alpha', 'bravo'], { editable: false });
const RANK = fieldRow('rank', { type: 'position' as FieldRow['type'] });
const FIELDS: FieldRow[] = [STAGE, STATUS, PHASE, BUCKET, TEAM_LOCKED, RANK];

const RECORDS: ItemRecord[] = [
	{ id: 'c1', stage: 'draft', status: 'todo', phase: 'one', bucket: 'small', team: 'alpha', rank: 'a' },
	{ id: 'c2', stage: 'draft', status: 'todo', phase: 'one', bucket: 'small', team: 'alpha', rank: 'b' },
	{ id: 'c3', stage: 'review', status: 'doing', phase: 'two', bucket: 'large', team: 'bravo', rank: 'c' },
	{ id: 'c4', stage: 'live', status: 'done', phase: 'two', bucket: 'large', team: 'bravo', rank: 'd' },
];

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [{ collection: C }], fields: { [C]: FIELDS }, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		const rec = path.match(/^\/collections\/demo\/records\/([^/?]+)$/);
		if (rec && (method === 'GET' || method === 'PATCH')) {
			const found = RECORDS.find((r) => r['id'] === rec[1]);
			const { id, ...fields } = found ?? { id: rec[1] };
			return { id, fields };
		}
		if (method === 'PATCH' && /^\/collections\/demo\/position\/[^/]+$/.test(path)) return { ok: true };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

afterEach(() => unmountAll());

interface Board {
	root: TestNode;
	created: Array<Record<string, unknown> | undefined>;
}

async function board(options: Record<string, unknown>, opts: { manualOrder?: boolean; records?: ItemRecord[] } = {}): Promise<Board> {
	const fields = ref(FIELDS) as Ref<FieldRow[]>;
	const created: Array<Record<string, unknown> | undefined> = [];
	const state = {
		collection: C,
		fields: { visibleFields: fields, fields },
		items: { items: ref(opts.records ?? RECORDS) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ kanban: options }) as Ref<Record<string, Record<string, unknown>>>,
		manualOrder: computed(() => opts.manualOrder === true),
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['id'] ?? ''),
		tintOf: () => undefined,
		openRecord: () => {},
		createRecord: (prefill?: Record<string, unknown>) => created.push(prefill),
	};
	const root = await render(ListKanban, { state });
	return { root, created };
}

/** A stand-in for the browser's DragEvent: counts `preventDefault` — the "a drop is allowed here" call. */
function dragEvent(): { preventDefault: () => void; stopPropagation: () => void; dataTransfer: null; prevented: number } {
	const ev = { prevented: 0, dataTransfer: null, preventDefault: () => void ev.prevented++, stopPropagation: () => {} };
	return ev;
}

const cards = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-kanban-core-card'));
const columns = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-kanban-core-col'));
const labelOf = (col: TestNode) => text(all(col, (n) => hasClass(n, 'dt-kanban-core-label'))[0]!).trim();
const columnNamed = (root: TestNode, label: string) => columns(root).find((c) => labelOf(c) === label)!;
const cardWithId = (root: TestNode, id: string) =>
	cards(root).find((c) => all(c, (n) => hasClass(n, 'dt-kanban-core-id')).some((n) => text(n).trim() === id))!;
const writes = () => requests.filter((r) => r.method === 'PATCH');
const recordWrites = () => writes().filter((r) => r.path.startsWith(`/collections/${C}/records/`));
const addButtons = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-kanban-core-add'));
const slots = (node: TestNode) => all(node, (n) => hasClass(n, 'dt-kanban-core-slot'));

async function dragTo(root: TestNode, id: string, label: string): Promise<{ over: ReturnType<typeof dragEvent> }> {
	(cardWithId(root, id).props['onDragstart'] as (e: unknown) => void)(dragEvent());
	await flush();
	const col = columnNamed(root, label);
	const over = dragEvent();
	(col.props['onDragover'] as (e: unknown) => void)(over);
	await flush();
	await (col.props['onDrop'] as (e: unknown) => Promise<void> | void)(dragEvent());
	await flush();
	return { over };
}

// ---- t2 — a locked column field ---------------------------------------------------------------------

test('t2: on a board by a locked field, no card is draggable and a drag to another column writes nothing', async () => {
	const { root } = await board({ lanes_by: 'stage' });
	assert.deepEqual(
		cards(root).map((c) => c.props['draggable']),
		['false', 'false', 'false', 'false'],
		'every card is draggable="false"',
	);
	const { over } = await dragTo(root, 'c1', 'review');
	assert.equal(over.prevented, 0, 'the locked column never says "a drop is allowed here"');
	assert.equal(columns(root).filter((c) => hasClass(c, 'is-drop')).length, 0, 'no column lights up as a drop target');
	assert.deepEqual(writes(), [], 'nothing was written');
});

test('t2: the drop handler is the guard — a dragstart that bubbled from a card (a text selection) still writes nothing', async () => {
	const { root } = await board({ lanes_by: 'stage' });
	(cardWithId(root, 'c3').props['onDragstart'] as (e: unknown) => void)(dragEvent());
	await flush();
	await (columnNamed(root, 'live').props['onDrop'] as (e: unknown) => Promise<void> | void)(dragEvent());
	await flush();
	assert.deepEqual(writes(), [], 'onDrop on a locked board writes nothing, draggable attribute or not');
});

test('t2: with no lanes_by, the inferred column field (the first with choices) is locked the same way', async () => {
	const { root } = await board({});
	assert.deepEqual(columns(root).map(labelOf), ['draft', 'review', 'live'], 'the board inferred stage');
	await dragTo(root, 'c1', 'live');
	assert.deepEqual(writes(), []);
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'false'));
});

// ---- t3 — an editable column field, unchanged -------------------------------------------------------

test('t3: on a board by an editable field, a drag to another column writes the target value, as before', async () => {
	const { root } = await board({ lanes_by: 'status' });
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'true'), 'every card is draggable="true"');
	const { over } = await dragTo(root, 'c1', 'done');
	assert.equal(over.prevented, 1, 'the column accepts the drop');
	assert.deepEqual(
		recordWrites().map((r) => ({ path: r.path, body: r.body })),
		[{ path: `/collections/${C}/records/c1`, body: { status: 'done' } }],
		'exactly one PATCH of the column field',
	);
});

// ---- t4 — the hover --------------------------------------------------------------------------------

test('t4: a locked card says why in its hover; an editable one says nothing', async () => {
	const locked = await board({ lanes_by: 'stage' });
	for (const card of cards(locked.root)) {
		assert.match(String(card.props['title'] ?? ''), /Stage is not editable here/);
		assert.ok(hasClass(card, 'is-locked'));
	}
	unmountAll();
	const editable = await board({ lanes_by: 'status' });
	for (const card of cards(editable.root)) {
		assert.equal(card.props['title'], undefined);
		assert.ok(!hasClass(card, 'is-locked'));
	}
});

// ---- t5 — the column + ----------------------------------------------------------------------------

test('t5: the column + is withheld on a locked or engine-held column field', async () => {
	for (const lanes_by of ['stage', 'bucket']) {
		const { root } = await board({ lanes_by });
		assert.equal(addButtons(root).length, 0, `no + on a board by ${lanes_by}`);
		unmountAll();
	}
});

test('t5: the + is kept on an editable and on a create-only column field', async () => {
	for (const [lanes_by, count] of [['status', 3], ['phase', 2]] as const) {
		const { root } = await board({ lanes_by });
		assert.equal(addButtons(root).length, count, `one + per column on a board by ${lanes_by}`);
		unmountAll();
	}
});

test('t5: on a board laned by a locked field, the + neither prefills nor names the lane', async () => {
	const { root, created } = await board({ lanes_by: 'status', group_by: 'team' });
	const plus = addButtons(root)[0]!;
	assert.doesNotMatch(String(plus.props['title'] ?? ''), /team/, 'the hover does not promise the lane value');
	(plus.props['onClick'] as () => void)();
	assert.deepEqual(created, [{ status: 'todo' }], 'the create carries the column value only');
});

// ---- t6 — manual ordering on a locked board -------------------------------------------------------

test('t6: a locked board with manual order reorders within the card’s own column only', async () => {
	const { root } = await board({ lanes_by: 'stage' }, { manualOrder: true });
	assert.ok(cards(root).every((c) => c.props['draggable'] === 'true'), 'cards drag, to reorder');
	(cardWithId(root, 'c2').props['onDragstart'] as (e: unknown) => void)(dragEvent());
	await flush();
	const own = columnNamed(root, 'draft');
	const others = columns(root).filter((c) => c !== own);
	assert.ok(slots(own).length > 0, 'the dragged card’s column offers its gaps');
	assert.equal(others.reduce((n, c) => n + slots(c).length, 0), 0, 'no other column offers a gap');

	await (slots(own)[0]!.props['onDrop'] as (e: unknown) => Promise<void> | void)(dragEvent());
	await flush();
	assert.deepEqual(recordWrites(), [], 'the column field is not written');
	assert.deepEqual(
		writes().map((r) => r.path),
		[`/collections/${C}/position/c2`],
		'the position alone is written',
	);

	requests.length = 0;
	(cardWithId(root, 'c2').props['onDragstart'] as (e: unknown) => void)(dragEvent());
	await flush();
	await (columnNamed(root, 'live').props['onDrop'] as (e: unknown) => Promise<void> | void)(dragEvent());
	await flush();
	assert.deepEqual(writes(), [], 'a drop on another column writes nothing');
});

// ---- t7 — create-only and engine-held column fields ------------------------------------------------

test('t7: a create-only or engine-held column field locks the drag the same way', async () => {
	for (const [lanes_by, target] of [['phase', 'two'], ['bucket', 'large']] as const) {
		const { root } = await board({ lanes_by });
		assert.ok(cards(root).every((c) => c.props['draggable'] === 'false'), `${lanes_by}: not draggable`);
		await dragTo(root, 'c1', target);
		assert.deepEqual(writes(), [], `${lanes_by}: nothing written`);
		unmountAll();
	}
});
