// Held-out h6 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h6) — written by the plan
// review, never read by the builder. `fit` is opt-in: every OTHER SourceMark caller renders as at c140ed9 —
// a list cell ($source View), the record page's source line (PageHeader), a Sources picker row and the
// create form's Saves-to line keep their native `title` (markTitle) and never carry `dt-source-mark--fit`.
// A regression guard: it PASSES at c140ed9 and must still pass on the branch.
// Synthetic names only. Run: npm test -- --only=held-out-new-record-menu-h6
import assert from 'node:assert/strict';
import test from 'node:test';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { all, find, flush, hasClass, render, type TestNode } from './render';
import type { SourceEntry } from '../../src/api/types';
import { markTitle, sourceFieldRow } from '../../src/lib/sources';
import { recordOrigin } from '../../src/lib/record-origin';
import SourceMark from '../../src/components/SourceMark.vue';
import ViewSource from '../../src/views/ViewSource.vue';
import PageHeader from '../../src/components/PageHeader.vue';
import SourcePicker from '../../src/components/browse/SourcePicker.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1386, innerHeight: 800 };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as Record<string, unknown>)['Element'] ??= class {};
(globalThis as Record<string, unknown>)['HTMLElement'] ??= class {};

const SOURCES: SourceEntry[] = [
	{ name: 'hq-sample', kind: 'own', repo: '.', path: 'data/notes', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'layer-edit', kind: 'layer', repo: 'git_modules/layer-edit', path: 'git_modules/layer-edit/data/notes', installed: true, count: 1, via: 'layer', access: 'edit', note: 'layer-edit has no compiled notes' },
	{ name: 'pkg-read', kind: 'module', repo: '.', path: 'node_modules/@sample/pkg-read', installed: true, count: 3, via: 'package', access: 'read', note: 'pkg-read is an installed package' },
];

async function router(at = '/content/notes') {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(at);
	await r.isReady();
	return r;
}
const marks = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-source-mark'));
const unchanged = (m: TestNode, name: string, entry: { via?: SourceEntry['via']; access?: SourceEntry['access']; note?: string; record?: string | null }, where: string) => {
	assert.ok(!hasClass(m, 'dt-source-mark--fit'), `${where}: no fit class`);
	assert.equal(m.props['title'], markTitle(name, entry), `${where}: the native title is still markTitle`);
};

test('h6: SourceMark with no fit prop is the 0.24.27 mark — title kept, no fit class', async () => {
	const root = await render(SourceMark, { name: 'layer-edit', access: 'edit', via: 'layer', note: 'layer-edit has no compiled notes' }, [await router()]);
	unchanged(marks(root)[0]!, 'layer-edit', { via: 'layer', access: 'edit', note: 'layer-edit has no compiled notes' }, 'bare SourceMark');
});

test('h6: a list cell (the $source View) keeps its title and no fit', async () => {
	const field = sourceFieldRow('notes', SOURCES);
	for (const s of SOURCES.slice(1)) {
		const root = await render(ViewSource, { value: s.name, field, options: field.viewer_options }, [await router()]);
		const m = marks(root);
		assert.equal(m.length, 1, `${s.name}: one mark in the cell`);
		assert.ok(!hasClass(m[0]!, 'dt-source-mark--fit'), `${s.name}: no fit class in a cell`);
		assert.ok(String(m[0]!.props['title'] ?? '').startsWith(`${s.name} — `), `${s.name}: the cell's mark keeps its native title`);
	}
});

test('h6: the record page\'s source line keeps its title and no fit', async () => {
	const origin = { ...recordOrigin({ $source: 'pkg-read', '$source-kind': 'module', $repo: '.' })!, access: 'read', via: 'package', note: 'pkg-read is an installed package' };
	const root = await render(PageHeader, { icon: 'note', title: 'x', commit: null, origin }, [await router('/content/notes/x')]);
	const line = find(root, (n) => hasClass(n, 'dt-page-commit__origin'))!;
	assert.ok(line, 'the source line');
	const m = marks(line);
	assert.equal(m.length, 1);
	assert.ok(!hasClass(m[0]!, 'dt-source-mark--fit'));
	assert.ok(String(m[0]!.props['title'] ?? '').includes('installed package'), 'the record page mark keeps its native title');
});

test('h6: a Sources picker row keeps its title and no fit', async () => {
	const state = { sourceFacets: ref(SOURCES), filterGroup: ref({ logic: '_and', rules: [] }) };
	const root = await render(SourcePicker, { state }, [await router()]);
	(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!.props['onClick'] as () => void)();
	await flush();
	for (const s of SOURCES) {
		const row = find(root, (n) => hasClass(n, 'dt-source-picker__row') && n.props['data-source'] === s.name)!;
		assert.ok(row, `${s.name}: a picker row`);
		unchanged(marks(row)[0]!, s.name, { via: s.via, access: s.access, note: s.note }, `picker ${s.name}`);
	}
});
