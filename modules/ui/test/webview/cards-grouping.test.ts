/**
 * A grouped CARDS grid: the same bands the table and the kanban draw, over a grid instead of rows.
 *
 * This exists because "the layouts share a derivation and a header component" is a claim about the
 * SOURCE, and the thing that actually matters is that all three draw a band. A shared helper that
 * two layouts call and the third quietly does not is exactly the drift the sharing was meant to
 * prevent, and only a render can tell the difference.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, text, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { views } from '../../src/registry/index';
import ListCards from '../../src/lists/ListCards.vue';

// The one view a card's subtitle field needs. Registered directly rather than by importing
// `register-defaults`, which reaches ListMap and therefore leaflet's png-referencing CSS.
views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});

// This tier has no DOM. `fileBases()` reads `window.__DT_FILE_BASES__`, which the host injects at
// runtime, so a sink is enough — the same shim the gantt tier installs, for the same reason.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const LANE: FieldRow = enumRow('lane', [
	{ label: 'Alpha', value: 'alpha', icon: 'rocket', description: 'the one that ships' },
	{ label: 'Bravo', value: 'bravo' },
]);

const NAME: FieldRow = fieldRow('name');

const RECORDS: ItemRecord[] = [
	{ id: '1', name: 'one', lane: 'alpha' },
	{ id: '2', name: 'two', lane: 'alpha' },
	{ id: '3', name: 'three', lane: 'bravo' },
];

function fakeState(options?: Record<string, unknown>, records: ItemRecord[] = RECORDS, collection = 'demo') {
	const fields = ref([NAME, LANE]) as Ref<FieldRow[]>;
	return {
		collection,
		columns: fields,
		fields: { visibleFields: fields, fields },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ cards: options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		imageField: computed(() => null),
		subtitleFields: computed(() => [] as FieldRow[]),
		selectedIds: computed(() => [] as string[]),
		hasActiveQuery: computed(() => false),
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		// what a record is called and its tint are the collection's display — none in this fixture
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id'] ?? ''),
		tintOf: () => undefined,
		openRecord: () => {},
		createRecord: () => {},
	};
}

const cards = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-cards-card'));
const headers = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-group-header'));
const bands = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-cards-band'));

test('ungrouped, the grid is the one grid it always was', async () => {
	const root = await render(ListCards, { state: fakeState() });
	assert.equal(headers(root).length, 0, 'no band header anywhere');
	assert.equal(cards(root).length, 3);
});

test('a group field makes one band per value, each with its own cards', async () => {
	const root = await render(ListCards, { state: fakeState({ group_by: 'lane' }) });
	assert.equal(bands(root).length, 2);
	const labels = headers(root).map((h) => text(find(h, (n) => hasClass(n, 'dt-group-header__label'))!));
	assert.deepEqual(labels, ['Alpha', 'Bravo']);
	assert.equal(cards(bands(root)[0]!).length, 2);
	assert.equal(cards(bands(root)[1]!).length, 1);
});

test('the band header carries the same decoration the table’s does', async () => {
	const root = await render(ListCards, { state: fakeState({ group_by: 'lane' }) });
	const alpha = headers(root)[0]!;
	assert.match(text(alpha), /the one that ships/);
	assert.ok(all(alpha, (n) => hasClass(n, 'codicon')).some((g) => String(g.props['class']).includes('codicon-rocket')));
});

test('a group_by naming a field the collection lacks degrades to one grid', async () => {
	const root = await render(ListCards, { state: fakeState({ group_by: 'not_a_field' }) });
	assert.equal(headers(root).length, 0);
	assert.equal(cards(root).length, 3);
});

test('value-less records are hidden until show_ungrouped_rows asks for them', async () => {
	const records = [...RECORDS, { id: '4', name: 'four', lane: '' }];
	const hidden = await render(ListCards, { state: fakeState({ group_by: 'lane' }, records) });
	assert.equal(cards(hidden).length, 3);

	const shown = await render(ListCards, { state: fakeState({ group_by: 'lane', show_ungrouped_rows: true }, records) });
	assert.equal(cards(shown).length, 4);
	assert.equal(bands(shown).length, 3);
});

// ── a file-codec collection is its own gallery ───────────────────────────────────────────────────

const images = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-card-image-img'));
const placeholders = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-card-image-placeholder'));

test('a record whose BYTES are the file draws itself, with no image field to point at', async () => {
	// `assets` and its kind hold records that ARE files. The picture is not in a field, so
	// the `image` option had nothing to name and the auto-pick found nothing — leaving the one collection
	// in the product whose entire purpose is being looked at rendered as a list of text.
	const w = globalThis.window as { __DT_FILE_BASES__?: unknown[] };
	w.__DT_FILE_BASES__ = [{ collection: 'pictures', path: 'data/pictures', suffix: 'asset', uri: 'vscode-webview://x/pictures' }];
	try {
		const records: ItemRecord[] = [
			{ id: 'avatars/cass', ext: 'png' },
			{ id: 'logos/acme', ext: 'svg' },
			// A file record that is NOT an image: drawing it as a broken <img> is worse than a placeholder.
			{ id: 'papers/spec', ext: 'pdf' },
		];
		const root = await render(ListCards, { state: fakeState(undefined, records, 'pictures') });
		const srcs = images(root).map((n) => String(n.props['src']));
		assert.deepEqual(srcs, [
			'vscode-webview://x/pictures/avatars/cass.asset.png',
			'vscode-webview://x/pictures/logos/acme.asset.svg',
		], 'the src is built from the id, the collection’s suffix and the record’s own ext');
		assert.equal(placeholders(root).length, 1, 'the pdf keeps its slot and draws nothing in it');
	} finally { delete w.__DT_FILE_BASES__; }
});

test('a collection that is NOT file-codec is untouched — no image slot appears', async () => {
	const root = await render(ListCards, { state: fakeState() });
	assert.equal(images(root).length, 0);
	assert.equal(placeholders(root).length, 0, 'an ordinary collection must not grow an empty image slot');
});
