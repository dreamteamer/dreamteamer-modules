/**
 * THE ROW'S NOTE MARK (cr-vscode-005, acceptance 1): a record an extension says something about — a
 * session holding it, in core's words — carries one glyph on its row, whose tooltip is that sentence,
 * verbatim (`$notes[].text`, what `dt next` prints between `● <ref> — ` and ` (<by>)`). In the table's
 * first cell, a card's footer row and a kanban card's footer row; a row with no `$notes` draws none.
 * One glyph whatever the sentence says (design D3): held, lapsed and stage-done are told apart by the
 * words, never by parsing them here. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import { markTitle, notesOfRow } from '../../webview/src/lib/next-notes';
import DataTable from '../../webview/src/components/DataTable.vue';
import ListCards from '../../webview/src/lists/ListCards.vue';
import ListKanban from '../../webview/src/lists/ListKanban.vue';

views.register({ id: 'text', name: 'Text', types: [], component: { props: ['value', 'field', 'options'], render(this: { value: unknown }) { return String(this.value ?? ''); } } });
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const HELD = 'in session by agents/builder since 2026-11-01T10:00:00+02:00 (sessions/2026/11/2026-11-01--cr-a)';
const LAPSED = 'was in session by a test session — no heartbeat since 2026-11-01T09:00:00+02:00, so the claim has lapsed (sessions/2026/11/2026-11-01--cr-a-2)';
const note = (text: string) => ({ id: 'cr-a', text, by: '@dreamteamer/core', refs: [] });

const NAME: FieldRow = fieldRow('name');
const STATUS: FieldRow = enumRow('status', [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }]);
const RECORDS: ItemRecord[] = [
	{ id: 'cr-a', name: 'Change A', status: 'todo', $notes: [note(HELD), note(LAPSED)] },
	{ id: 'cr-b', name: 'Change B', status: 'done' },
];

function fakeState(layout: 'table' | 'cards' | 'kanban') {
	const fields = ref([NAME, STATUS]) as Ref<FieldRow[]>;
	return {
		collection: 'rnd/change-requests',
		columns: fields,
		fields: { visibleFields: fields, fields, relationTargets: ref(new Map()) },
		items: { items: ref(RECORDS) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {}, setSort: () => {} },
		listOptions: ref({ [layout]: layout === 'kanban' ? { lanes_by: 'status' } : {} }) as Ref<Record<string, Record<string, unknown>>>,
		imageField: computed(() => null),
		subtitleFields: computed(() => []),
		selectedIds: computed(() => new Set<string>()),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		manualOrder: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? ''),
		titleField: ref('name'),
		tintOf: () => undefined,
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

const marks = (n: TestNode) => all(n, (x) => x.props['data-next-notes'] !== undefined);

test('the lib: a row\'s notes, and the tooltip is each sentence verbatim, one per line', () => {
	assert.deepEqual(notesOfRow(RECORDS[1]!), []);
	assert.equal(notesOfRow(RECORDS[0]!).length, 2);
	assert.equal(markTitle(notesOfRow(RECORDS[0]!)), `${HELD}\n${LAPSED}`);
});

test('the table: one mark in the held row\'s first cell, titled with the sentences; none on the other row', async () => {
	const root = await render(DataTable, { state: fakeState('table') });
	const rows = all(root, (n) => n.tag === 'tr' && hasClass(n, 'dt-row'));
	assert.equal(rows.length, 2);
	const [held, free] = rows;
	const m = marks(held!);
	assert.equal(m.length, 1);
	assert.equal(m[0]!.props['title'], `${HELD}\n${LAPSED}`);
	const firstCell = all(held!, (n) => n.tag === 'td' && !hasClass(n, 'dt-table__checkbox-col'))[0]!;
	assert.ok(find(firstCell, (x) => x.props['data-next-notes'] !== undefined), 'in the first cell');
	assert.equal(marks(free!).length, 0);
});

test('a card: the mark in its footer row — a footer drawn for a note alone; none on the other card', async () => {
	const root = await render(ListCards, { state: fakeState('cards') });
	const cards = all(root, (n) => hasClass(n, 'dt-cards-card'));
	assert.equal(cards.length, 2);
	const foot = find(cards[0]!, (n) => hasClass(n, 'dt-card-foot'));
	assert.ok(foot, 'an own record with a note gets a footer');
	assert.equal(marks(foot!).length, 1);
	assert.equal(marks(foot!)[0]!.props['title'], `${HELD}\n${LAPSED}`);
	assert.equal(marks(cards[1]!).length, 0);
	assert.equal(find(cards[1]!, (n) => hasClass(n, 'dt-card-foot')), null, 'and no empty footer');
});

test('a kanban card: the same mark in its footer row; none on the other card', async () => {
	const root = await render(ListKanban, { state: fakeState('kanban') });
	const cards = all(root, (n) => hasClass(n, 'dt-kanban-core-card'));
	assert.equal(cards.length, 2);
	const held = cards.filter((c) => marks(c).length === 1);
	assert.equal(held.length, 1);
	assert.equal(marks(held[0]!)[0]!.props['title'], `${HELD}\n${LAPSED}`);
	assert.ok(find(held[0]!, (n) => hasClass(n, 'dt-card-foot') && marks(n).length === 1), 'inside the footer');
});
