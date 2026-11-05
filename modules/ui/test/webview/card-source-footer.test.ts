/**
 * THE CARD'S SOURCE MARK SITS IN ITS FOOTER ROW (cr-vscode-004, line 7). The operator: "cards overlay on
 * top right source is hiding key info from card" — the mark was absolutely positioned at top 6 / right
 * 8 px, over the title and the cover. It now sits in a `footer.dt-card-foot`, the card's LAST child, in
 * flow after the cover, the title and the fields — so at any card width it is below them, never over
 * them. This tier has no layout, so the proof is structural (the footer is last, the mark is in it) and
 * tier 1's `card-mark-css.test.ts` pins that no card stylesheet positions a mark out of flow; the pixels
 * at the default 200 px column are the dev-host walk's screenshot. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import ListCards from '../../webview/src/lists/ListCards.vue';
import ListKanban from '../../webview/src/lists/ListKanban.vue';

views.register({ id: 'text', name: 'Text', types: [], component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } } });
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const NAME: FieldRow = fieldRow('name');
const OWNER: FieldRow = fieldRow('owner');
const COVER: FieldRow = fieldRow('cover');
const STATUS: FieldRow = enumRow('status', [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }]);
const RECORDS: ItemRecord[] = [
	{ id: 'kickoff', name: 'Kickoff with Northwind', owner: 'Dana Oren', cover: 'images/kickoff.png', status: 'todo', $source: 'project-a' },
	{ id: 'brief', name: 'Write the brief', owner: 'Sam Diaz', cover: 'images/brief.png', status: 'done', $source: 'my-hq' },
];
const markOf = (r: ItemRecord) => (r['$source'] === 'project-a' ? { name: 'project-a', record: null, access: 'write' as const, via: 'layer' as const } : null);

function fakeState(layout: 'cards' | 'kanban') {
	const fields = ref([NAME, OWNER, COVER, STATUS]) as Ref<FieldRow[]>;
	return {
		collection: 'tasks',
		columns: fields,
		fields: { visibleFields: fields, fields },
		items: { items: ref(RECORDS) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ [layout]: layout === 'kanban' ? { lanes_by: 'status' } : {} }) as Ref<Record<string, Record<string, unknown>>>,
		imageField: computed(() => COVER),
		subtitleFields: computed(() => [OWNER]),
		selectedIds: computed(() => [] as string[]),
		hasActiveQuery: computed(() => false),
		manualOrder: computed(() => false),
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? ''),
		tintOf: () => undefined,
		sourceOf: markOf,
		openRecord: () => {},
		createRecord: () => {},
	};
}

const elements = (n: TestNode) => n.children.filter((c): c is TestNode => typeof c !== 'string' && !c.tag.startsWith('#'));
const indexOf = (card: TestNode, pred: (n: TestNode) => boolean) => elements(card).findIndex((c) => pred(c) || !!find(c, pred));

test('a card from another root: the mark is in the footer row, the card\'s LAST child — after the cover, the title and the first field', async () => {
	const root = await render(ListCards, { state: fakeState('cards') });
	const cards = all(root, (n) => hasClass(n, 'dt-cards-card'));
	assert.equal(cards.length, 2);
	const card = cards[0]!;
	const kids = elements(card);
	const foot = kids[kids.length - 1]!;
	assert.equal(foot.tag, 'footer');
	assert.ok(hasClass(foot, 'dt-card-foot'));
	assert.ok(find(foot, (n) => hasClass(n, 'dt-source-mark')), 'the mark is inside the footer');
	assert.equal(all(card, (n) => hasClass(n, 'dt-source-mark')).length, 1, 'and nowhere else on the card');
	const cover = indexOf(card, (n) => hasClass(n, 'dt-card-image'));
	const title = indexOf(card, (n) => hasClass(n, 'dt-card-title'));
	const field = indexOf(card, (n) => hasClass(n, 'dt-card-field'));
	assert.ok(cover >= 0 && title >= 0 && field >= 0, 'the card has a cover, a title and a field');
	assert.ok(cover < kids.length - 1 && title < kids.length - 1 && field < kids.length - 1, 'every one of them comes before the footer');
	assert.match(String(find(foot, (n) => hasClass(n, 'dt-source-mark__access'))?.props['class']), /codicon-edit/, 'and the mark carries its glyph');
});

test('an own card wears no footer at all — rule 1, unchanged', async () => {
	const root = await render(ListCards, { state: fakeState('cards') });
	const own = all(root, (n) => hasClass(n, 'dt-cards-card'))[1]!;
	assert.equal(find(own, (n) => hasClass(n, 'dt-card-foot')), null);
});

test('a kanban card: the same footer row, last, after the title', async () => {
	const root = await render(ListKanban, { state: fakeState('kanban') });
	const cards = all(root, (n) => hasClass(n, 'dt-kanban-core-card'));
	const card = cards.find((c) => !!find(c, (n) => hasClass(n, 'dt-source-mark')))!;
	assert.ok(card, 'the layer\'s card');
	const kids = elements(card);
	assert.ok(hasClass(kids[kids.length - 1]!, 'dt-card-foot'), 'the footer is the card\'s last child');
	assert.ok(indexOf(card, (n) => hasClass(n, 'dt-kanban-core-title')) < kids.length - 1);
});
