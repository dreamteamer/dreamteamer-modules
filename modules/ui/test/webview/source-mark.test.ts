/**
 * The SOURCE MARK, rendered: `● name` — dot and name together — for a record read from another root,
 * NOTHING for the workspace's own (design rule 1), and a LINK to the matched `repos` record in a
 * record context only. Rendered because "own rows plain" is a rendering, and a resolver that answered
 * the right name while the cell drew it anyway would pass every pure test there is.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ref } from 'vue';
import { all, find, flush, hasClass, render, text } from './render';
import type { SourceEntry } from '../../src/api/types';
import { sourceFieldRow } from '../../src/lib/sources';
import SourceMark from '../../src/components/SourceMark.vue';
import ViewSource from '../../src/views/ViewSource.vue';
import PageHeader from '../../src/components/PageHeader.vue';
import SourcePicker from '../../src/components/browse/SourcePicker.vue';
import { recordOrigin } from '../../src/lib/record-origin';

const SOURCES: SourceEntry[] = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2 },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, record: 'repos/project-a' },
	{ name: 'org', kind: 'module', repo: 'git_modules/org', path: 'git_modules/org/data/people', installed: true, count: 3 },
];
const FIELD = sourceFieldRow('tasks', SOURCES);

async function router(at = '/content/tasks') {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(at);
	await r.isReady();
	return r;
}

const mark = (root: Parameters<typeof find>[0]) => find(root, (n) => hasClass(n, 'dt-source-mark'));
const dot = (root: Parameters<typeof find>[0]) => find(root, (n) => hasClass(n, 'dt-source-mark__dot'));

test('a foreign source draws the dot and the name, together, the dot in the hashed colour', async () => {
	const root = await render(SourceMark, { name: 'project-a' }, [await router()]);
	const m = mark(root);
	assert.ok(m, 'a mark');
	assert.equal(m.props['data-source'], 'project-a');
	assert.equal(text(m).trim(), 'project-a', 'the name is always drawn');
	const d = dot(root);
	assert.ok(d, 'and the dot');
	assert.match(String((d.props['style'] as Record<string, string>)['background']), /^var\(--vscode-charts-[a-z]+, var\(--dt-color-charts-[a-z]+, var\(--dt-unknown-color\)\)\)$/, 'a theme colour, never hex');
});

test('the same name is the same colour on every surface', async () => {
	const a = dot(await render(SourceMark, { name: 'org' }, [await router()]))!;
	const b = dot(await render(SourceMark, { name: 'org', context: 'record' }, [await router()]))!;
	assert.deepEqual(a.props['style'], b.props['style']);
});

test('with a matched repos record the name is a LINK in a record context, and inert text in a cell', async () => {
	const inRecord = await render(SourceMark, { name: 'project-a', record: 'repos/project-a', context: 'record' }, [await router('/content/tasks/x')]);
	const link = find(inRecord, (n) => n.tag === 'a');
	assert.ok(link, 'a link on the record page');
	assert.equal(link.props['href'], '/content/repos/project-a');
	assert.equal(text(link).trim(), 'project-a');

	const inCell = await render(SourceMark, { name: 'project-a', record: 'repos/project-a' }, [await router()]);
	assert.equal(find(inCell, (n) => n.tag === 'a'), null, 'a cell is already a click target — no nested link');
	assert.equal(text(mark(inCell)!).trim(), 'project-a');

	const unmatched = await render(SourceMark, { name: 'org', record: null, context: 'record' }, [await router()]);
	assert.equal(find(unmatched, (n) => n.tag === 'a'), null, 'no repos record, no link — never a dangling reference');
});

test('a prefix wraps with the mark: "shared from ● org"', async () => {
	const root = await render(SourceMark, { name: 'org', prefix: 'shared from' }, [await router()]);
	const m = mark(root)!;
	assert.equal(text(find(m, (n) => hasClass(n, 'dt-source-mark__prefix'))!).trim(), 'shared from');
	assert.equal(text(find(m, (n) => hasClass(n, 'dt-source-mark__name'))!).trim(), 'org');
	assert.ok(dot(m), 'the dot sits between them');
});

test('the $source View: NOTHING for the workspace\'s own root, the mark for a layer, a link for a matched module', async () => {
	const own = await render(ViewSource, { value: 'my-hq', field: FIELD, options: FIELD.viewer_options }, [await router()]);
	assert.equal(mark(own), null, 'an own row is plain');
	assert.equal(text(own).trim(), '', 'and draws no text at all — not even a dash');

	const layer = await render(ViewSource, { value: 'project-a', field: FIELD, options: FIELD.viewer_options }, [await router()]);
	assert.equal(text(mark(layer)!).trim(), 'project-a');
	assert.equal(find(layer, (n) => n.tag === 'a'), null, 'a cell: inert');

	const linked = await render(ViewSource, { value: 'project-a', field: FIELD, options: FIELD.viewer_options, context: 'record' }, [await router()]);
	assert.equal(find(linked, (n) => n.tag === 'a')?.props['href'], '/content/repos/project-a', 'the record the host matched, through the row\'s options');

	const empty = await render(ViewSource, { value: null, field: FIELD, options: FIELD.viewer_options }, [await router()]);
	assert.equal(all(empty, (n) => hasClass(n, 'dt-source-mark')).length, 0, 'no value, no mark');
});

// ---- cr-vscode-004: ONE glyph vocabulary for whether a write lands in the root -----------------------
// A pencil (codicon `edit`) when rows of that root are changed from here — `write` (edits and new
// records) and `edit` (edits only); a lock when nothing is written from here (`read`). No `access`, no
// glyph. The class and the reason are the hover's words. Every surface draws the SAME component, so
// each surface below is asserted by finding the glyph inside its own markup.
const glyph = (root: Parameters<typeof find>[0]) => find(root, (n) => hasClass(n, 'dt-source-mark__access'));
const glyphName = (root: Parameters<typeof find>[0]) => {
	const g = glyph(root);
	return g ? String(g.props['class']).match(/codicon-([a-z-]+)/)?.[1] ?? null : null;
};

test('the vocabulary: a pencil for write and edit, a lock for read, nothing when the host did not say', async () => {
	assert.equal(glyphName(await render(SourceMark, { name: 'my-hq', access: 'write', via: 'own' }, [await router()])), 'edit');
	assert.equal(glyphName(await render(SourceMark, { name: 'project-a', access: 'edit', via: 'layer' }, [await router()])), 'edit');
	assert.equal(glyphName(await render(SourceMark, { name: 'tasks', access: 'read', via: 'package' }, [await router()])), 'lock');
	assert.equal(glyph(await render(SourceMark, { name: 'project-a' }, [await router()])), null, 'no access, no glyph — an older host draws the mark it always drew');
});

test('the hover names the class and the writability, and the reason for anything short of write', async () => {
	const w = mark(await render(SourceMark, { name: 'project-a', access: 'write', via: 'layer' }, [await router()]))!;
	assert.equal(w.props['title'], 'project-a — record layer · writes here');
	assert.equal(w.props['data-access'], 'write');
	const r = mark(await render(SourceMark, { name: 'tasks', access: 'read', via: 'package', note: 'tasks is an installed package — nothing is written to it' }, [await router()]))!;
	assert.equal(r.props['title'], 'tasks — installed package · read-only\ntasks is an installed package — nothing is written to it');
	const c = mark(await render(SourceMark, { name: 'org', access: 'write', via: 'clone' }, [await router()]))!;
	assert.match(String(c.props['title']), /linked clone · writes here/);
});

const CLASSED: SourceEntry[] = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'edit', note: 'project-a has no compiled tasks' },
	{ name: 'tasks', kind: 'module', repo: '.', path: 'node_modules/@scope/tasks', installed: true, count: 3, via: 'package', access: 'read', note: 'tasks is an installed package' },
];

test('a list cell (the $source View) draws the glyph its root earns', async () => {
	const field = sourceFieldRow('tasks', CLASSED);
	assert.equal(glyphName(await render(ViewSource, { value: 'project-a', field, options: field.viewer_options }, [await router()])), 'edit');
	assert.equal(glyphName(await render(ViewSource, { value: 'tasks', field, options: field.viewer_options }, [await router()])), 'lock');
	assert.equal(mark(await render(ViewSource, { value: 'my-hq', field, options: field.viewer_options }, [await router()])), null, 'an own row stays plain — rule 1 holds');
});

test('the record page\'s source line draws the glyph and the class word; a read-only root says why in the line', async () => {
	const origin = (extra: Record<string, unknown>) => ({ ...recordOrigin({ $source: 'tasks', '$source-kind': 'module', $repo: '.' })!, ...extra });
	const header = async (o: ReturnType<typeof origin>) => find(await render(PageHeader, { icon: 'tasklist', title: 'x', commit: null, origin: o }, [await router()]), (n) => hasClass(n, 'dt-page-commit__origin'))!;
	const ro = await header(origin({ access: 'read', via: 'package', note: 'tasks is an installed package' }));
	assert.equal(glyphName(ro), 'lock');
	assert.equal(text(find(ro, (n) => hasClass(n, 'dt-page-commit__kind'))!).trim(), 'package');
	assert.equal(text(find(ro, (n) => n.props['data-read-only'] !== undefined)!).trim(), 'read-only — tasks is an installed package');
	const clone = await header(origin({ access: 'write', via: 'clone' }));
	assert.equal(glyphName(clone), 'edit');
	assert.equal(text(find(clone, (n) => hasClass(n, 'dt-page-commit__kind'))!).trim(), 'linked clone');
	assert.equal(find(clone, (n) => n.props['data-read-only'] !== undefined), null, 'a writable root has no read-only words');
});

test('a picker row draws the glyph and says the class and writability beside its count', async () => {
	const state = { sourceFacets: ref(CLASSED), filterGroup: ref({ logic: '_and', rules: [] }) };
	const root = await render(SourcePicker, { state }, [await router()]);
	(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!.props['onClick'] as () => void)();
	await flush();
	const row = (name: string) => find(root, (n) => hasClass(n, 'dt-source-picker__row') && n.props['data-source'] === name)!;
	assert.equal(glyphName(row('project-a')), 'edit');
	assert.equal(glyphName(row('tasks')), 'lock');
	const words = (name: string) => text(find(row(name), (n) => hasClass(n, 'dt-source-picker__access'))!).trim();
	assert.deepEqual([words('my-hq'), words('project-a'), words('tasks')], ['this workspace · writes', 'record layer · edits only', 'installed package · read-only']);
	assert.equal(text(find(row('tasks'), (n) => hasClass(n, 'dt-source-picker__count'))!).trim(), '3', 'and still its count');
});
