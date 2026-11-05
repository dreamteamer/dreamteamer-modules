/**
 * STUBS IN THE SOURCE VOCABULARY (cr-vscode-004 line 9, operator decision 6a): beside a row's mark —
 * the list cell, a card's footer row — and on the record page's source line, a record that shadows a
 * stub names it with that root's own mark and `stub · yields to <its root>`; a record that IS a stub
 * says `stub · yields to any non-stub of its id`. The cell gets the row through RenderView, which hands
 * it only to a View that declares `record`. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, text, type TestNode } from './render';
import type { FieldRow, ItemRecord, SourceEntry } from '../../webview/src/api/types';
import { sourceFieldRow } from '../../webview/src/lib/sources';
import { recordOrigin } from '../../webview/src/lib/record-origin';
import { fieldRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import RenderView from '../../webview/src/components/render/RenderView.vue';
import ViewSource from '../../webview/src/views/ViewSource.vue';
import PageHeader from '../../webview/src/components/PageHeader.vue';
import ListCards from '../../webview/src/lists/ListCards.vue';

views.register({ id: 'source', name: 'Source', types: [], component: ViewSource });
views.register({ id: 'text', name: 'Text', types: [], component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } } });
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const SOURCES: SourceEntry[] = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/contacts', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/contacts', installed: true, count: 1, via: 'layer', access: 'edit', note: 'project-a has no compiled contacts' },
];
const FIELD = sourceFieldRow('contacts', SOURCES);

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/contacts');
	await r.isReady();
	return r;
}
const items = (root: TestNode) => all(root, (n) => n.props['data-stub-root'] !== undefined);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

test('a list cell: the row\'s own mark (none — it is the workspace\'s), then the stub\'s root with ITS mark and "stub · yields to my-hq"', async () => {
	const record = { id: 'dana-oren', $source: 'my-hq', $stubs: ['project-a'] };
	const root = await render(RenderView, { field: FIELD, value: 'my-hq', record }, [await router()]);
	const stub = items(root);
	assert.equal(stub.length, 1, 'the cell says it — RenderView handed ViewSource the row');
	assert.equal(stub[0]!.props['data-stub-root'], 'project-a');
	assert.ok(find(stub[0]!, (n) => hasClass(n, 'dt-source-mark') && n.props['data-source'] === 'project-a'), 'named with project-a\'s own mark');
	assert.match(String(find(stub[0]!, (n) => hasClass(n, 'dt-source-mark__access'))!.props['class']), /codicon-edit/, 'and its glyph');
	assert.equal(squash(text(find(stub[0]!, (n) => hasClass(n, 'dt-stub-note__words'))!)), 'stub · yields to my-hq');
	assert.equal(all(root, (n) => hasClass(n, 'dt-source-mark') && n.props['data-source'] === 'my-hq').length, 0, 'an own row still draws no mark of its own');
});

test('a cell without the row (an older caller) draws exactly what it drew before', async () => {
	const root = await render(RenderView, { field: FIELD, value: 'my-hq' }, [await router()]);
	assert.equal(items(root).length, 0);
	assert.equal(squash(text(root)), '');
});

test('a row that IS a stub says so, with nothing to yield to here', async () => {
	const root = await render(ViewSource, { value: 'project-a', field: FIELD, options: FIELD.viewer_options, record: { id: 'sam-diaz', $source: 'project-a', stub: true } }, [await router()]);
	assert.ok(find(root, (n) => hasClass(n, 'dt-source-mark') && n.props['data-source'] === 'project-a'), 'its mark');
	assert.equal(squash(text(find(root, (n) => n.props['data-stub-self'] !== undefined)!)), 'stub · yields to any non-stub of its id');
});

test('a card\'s footer row carries the stub beside the mark — even for an own card, which otherwise wears none', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`unstubbed ${method} ${path}`);
	});
	const NAME: FieldRow = fieldRow('name');
	const fields = ref([NAME]) as Ref<FieldRow[]>;
	const records: ItemRecord[] = [{ id: 'dana-oren', name: 'Dana Oren', $source: 'my-hq', $stubs: ['project-a'] }];
	const state = {
		collection: 'contacts', columns: fields, fields: { visibleFields: fields, fields },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ cards: {} }), imageField: computed(() => null), subtitleFields: computed(() => [] as FieldRow[]),
		selectedIds: computed(() => [] as string[]), hasActiveQuery: computed(() => false),
		pkOf: (r: ItemRecord) => String(r['id']), recordTitleOf: (r: ItemRecord) => String(r['name']), tintOf: () => undefined,
		sourceOf: () => null, stubOf: (r: ItemRecord) => ({ stubs: r['$stubs'] as string[], self: false, winner: r['$source'] as string }),
		sourceFacets: ref(SOURCES), openRecord: () => {}, createRecord: () => {},
	};
	const root = await render(ListCards, { state });
	const foot = find(root, (n) => hasClass(n, 'dt-card-foot'));
	assert.ok(foot, 'an own card that shadows a stub has a footer row');
	assert.equal(items(foot!)[0]?.props['data-stub-root'], 'project-a');
	assert.equal(squash(text(find(foot!, (n) => hasClass(n, 'dt-stub-note__words'))!)), 'stub · yields to my-hq');
});

test('the record page\'s source line names the stub after the mark and the class word', async () => {
	const origin = { ...recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: '.' })!, access: 'write' as const, via: 'own' as const, stub: { stubs: ['project-a'], self: false, winner: 'my-hq' }, stubSources: SOURCES };
	const root = await render(PageHeader, { icon: 'person', title: 'Dana Oren', commit: null, origin }, [await router()]);
	const line = find(root, (n) => hasClass(n, 'dt-page-commit__origin'))!;
	assert.equal(items(line)[0]?.props['data-stub-root'], 'project-a');
	assert.match(squash(text(line)), /my-hq.*project-a.*stub · yields to my-hq/);
});

// review finding stub-memo-rederived-on-host: a stubs-only id names the later roots' stubs it shadows
test('a stub that answers, while another root also holds a stub of its id: its own words first, then that root as "also a stub"', async () => {
	const root = await render(ViewSource, { value: 'my-hq', field: FIELD, options: FIELD.viewer_options, record: { id: 'sam-diaz', $source: 'my-hq', stub: true, $stubs: ['project-a'] } }, [await router()]);
	const note = find(root, (n) => n.props['data-stub-note'] !== undefined)!;
	assert.equal(squash(text(note.children[0] as TestNode)), 'stub · yields to any non-stub of its id', 'its own words first');
	assert.equal(items(root)[0]?.props['data-stub-root'], 'project-a');
	assert.equal(squash(text(find(items(root)[0]!, (n) => hasClass(n, 'dt-stub-note__words'))!)), 'also a stub');
});
