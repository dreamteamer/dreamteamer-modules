/**
 * THE SOURCE CHIP (cr-vscode-004, line 1): a list narrowed by the Sources picker shows ONE `Source is
 * <names>` chip in the chips row under the collection name, drawn and removed like any other rule, and
 * the filter badge counts it — the chips row and the picker read the same rule, so they cannot
 * disagree. Also line 2's second half: a layer's nav row opens the list with `?filter=` naming
 * `$source is <layer>` (`src/nav.ts` layerRoute, pinned in record-layers), and that is now ON SCREEN.
 *
 * The real BrowseView over the host stub; the list itself is a stub List (this proves the header and the
 * chips, not a table). Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import { refreshCollections } from '../../webview/src/composables/collections';
import { lists } from '../../webview/src/registry/index';
import { fieldRow } from '../unit/field-rows';
import BrowseView from '../../webview/src/components/BrowseView.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
lists.register({ id: 'table', name: 'Table', component: { render: () => null } });

const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit', note: 'project-b has no compiled tasks' },
];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };

async function mount(url: string): Promise<TestNode> {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { name: 'my-hq', modules: [] };
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return { records: [], total: 0, sources: SOURCES };
		if (path.startsWith('/commit')) return []; // the commit button's dry run: nothing pending
		return {};
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(url);
	await r.isReady();
	const root = await render(BrowseView, { collection: 'tasks' }, [r]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}

// the filter a layer's nav row opens the list with — `src/nav.ts` layerRoute's exact group
const layerRow = (layer: string) => `/content/tasks?filter=${encodeURIComponent(JSON.stringify({ logic: '_and', rules: [{ field: '$source', operator: '_eq', value: layer }] }))}`;

const chips = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-chip') && n.parent !== null && hasClass(n.parent, 'dt-browse-chips'));
const sourceChip = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-chip--source'));
const badge = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-browse-filter-badge'));
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const press = async (n: TestNode) => {
	(n.props['onClick'] as () => void)();
	for (let i = 0; i < 5; i++) await flush();
};
const pickerRow = (root: TestNode, name: string) => find(root, (n) => hasClass(n, 'dt-source-picker__row') && n.props['data-source'] === name)!;
const pickerLabel = (root: TestNode) => squash(text(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!));

test('opened from a layer\'s nav row: the chips row says "Source is project-a", and the badge counts it', async () => {
	const root = await mount(layerRow('project-a'));
	const chip = sourceChip(root);
	assert.ok(chip, 'a Source chip under the collection name');
	assert.equal(squash(text(chip!)), 'Source is project-a');
	assert.equal(chip!.props['data-source-chip'], 'project-a');
	assert.equal(chips(root).length, 1, 'one rule, one chip');
	assert.equal(text(badge(root)!).trim(), '1', 'the filter badge counts the source rule like any rule');
	assert.match(pickerLabel(root), /project-a/, 'and the picker shows the same selection');
});

test('a second pick in the picker: STILL one chip, now naming both — the badge still 1', async () => {
	const root = await mount(layerRow('project-a'));
	await press(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!);
	await press(pickerRow(root, 'my-hq'));
	assert.equal(chips(root).length, 1);
	assert.equal(squash(text(sourceChip(root)!)), 'Source is project-a · my-hq');
	assert.equal(text(badge(root)!).trim(), '1');
	assert.match(pickerLabel(root), /2 sources/, 'the picker and the chip agree');
});

test('the chip\'s × removes the rule: no chip, no badge, and the picker reads All sources', async () => {
	const root = await mount(layerRow('project-a'));
	await press(find(sourceChip(root)!, (n) => hasClass(n, 'dt-chip__remove'))!);
	assert.equal(sourceChip(root), null);
	assert.equal(badge(root), null);
	assert.equal(pickerLabel(root), 'All sources');
});

test('a click on the chip\'s words opens the picker — the picker is the chip\'s editor', async () => {
	const root = await mount(layerRow('project-b'));
	assert.equal(find(root, (n) => hasClass(n, 'dt-source-picker__panel')), null, 'closed to begin with');
	await press(find(sourceChip(root)!, (n) => hasClass(n, 'dt-chip__edit'))!);
	assert.ok(find(root, (n) => hasClass(n, 'dt-source-picker__panel')), 'the chip opened the picker');
	assert.equal(pickerRow(root, 'project-b').props['aria-selected'], true, 'with the chip\'s source ticked');
});

test('the picker lists each source with its count AND its writability (line 4)', async () => {
	const root = await mount('/content/tasks');
	await press(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!);
	const words = (name: string) => squash(text(find(pickerRow(root, name), (n) => hasClass(n, 'dt-source-picker__access'))!));
	const count = (name: string) => text(find(pickerRow(root, name), (n) => hasClass(n, 'dt-source-picker__count'))!).trim();
	assert.deepEqual(['my-hq', 'project-a', 'project-b'].map((n) => [words(n), count(n)]), [['this workspace · writes', '2'], ['record layer · writes', '1'], ['record layer · edits only', '3']]);
	assert.equal(sourceChip(root), null, 'an un-narrowed list draws no Source chip');
});
