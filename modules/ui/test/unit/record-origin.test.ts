// Tier 1 — the record page's origin line (`webview/src/lib/record-origin.ts`) and where a new record
// saves (`webview/src/lib/created-visibility.ts`), as pure functions. Synthetic names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originClassWord, originKindWord, recordOrigin } from '../../src/lib/record-origin';
import { excludedBy, saveRoot, selectionFromQuery, widenedFor } from '../../src/lib/created-visibility';
import { formSections } from '../../src/lib/field-row';
import { emptyFilterGroup, type FilterGroup } from '../../src/lib/filter-query';
import { selectedSources, withSourceSelection } from '../../src/lib/sources';
import { fieldRow } from './field-rows';

test('recordOrigin: a layer record, one commit not pushed, edited on disk', () => {
	const o = recordOrigin({ $source: 'project-a', '$source-kind': 'layer', $repo: 'git_modules/project-a', $dirty: true, $ahead: 1 })!;
	assert.deepEqual([o.name, o.kind, o.state], ['project-a', 'layer', ['ahead 1', 'uncommitted']]);
	assert.match(o.tooltip, /record layer project-a — committed in git_modules\/project-a\. 1 commit not pushed; changes on disk/);
});

test('recordOrigin: $repo null is an env folder, never committed, whatever the source says', () => {
	assert.deepEqual(recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: null }), {
		name: null, kind: 'env', state: ['never committed'], tooltip: 'Kept in a folder on this machine, outside every git repo here — saved, never committed.', inRepo: false,
	});
});

test('recordOrigin: no $repo key (an engine without Store#locate) is the origin with no state', () => {
	const o = recordOrigin({ $source: 'org', '$source-kind': 'module' })!;
	assert.deepEqual([o.name, o.kind, o.state], ['org', 'module', []]);
	assert.doesNotMatch(o.tooltip, /committed in/);
});

test('recordOrigin: nothing before the record loads; a clean own record says nothing but its name', () => {
	assert.equal(recordOrigin(null), null);
	assert.deepEqual(recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: '.', $dirty: false, $ahead: 0 })!.state, []);
	assert.equal(originKindWord('own'), '');
	assert.equal(originKindWord('env'), 'env folder');
});

const SOURCES = [
	{ name: 'my-hq', kind: 'own' as const, repo: '.', path: 'data/tasks', installed: true, count: 2 },
	{ name: 'project-a', kind: 'layer' as const, repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1 },
];

test('saveRoot: the workspace own root; a module-owned list (no own root) saves to its module', () => {
	assert.equal(saveRoot(SOURCES as any)?.name, 'my-hq');
	assert.equal(saveRoot([{ name: 'org', kind: 'module', repo: 'git_modules/org', path: 'git_modules/org/data/people', installed: true, count: 1 }] as any)?.name, 'org');
});

test('excludedBy / selectionFromQuery: the selection a new record will not be in', () => {
	assert.deepEqual(excludedBy(['project-a'], 'my-hq'), ['project-a']);
	assert.deepEqual(excludedBy(['project-a', 'my-hq'], 'my-hq'), [], 'a selection holding the root hides nothing');
	assert.deepEqual(excludedBy([], 'my-hq'), [], 'all sources: nothing hidden');
	assert.deepEqual(selectionFromQuery('project-a, project-b'), ['project-a', 'project-b']);
	assert.deepEqual(selectionFromQuery(undefined), []);
});

test('widenedFor: adds the root to a selection that leaves it out; null when it already shows it', () => {
	const only: FilterGroup = withSourceSelection(emptyFilterGroup(), ['project-a']);
	assert.deepEqual(selectedSources(widenedFor(only, 'my-hq')!), ['project-a', 'my-hq']);
	assert.equal(widenedFor(emptyFilterGroup(), 'my-hq'), null, 'all sources shown');
	assert.equal(widenedFor(withSourceSelection(emptyFilterGroup(), ['my-hq']), 'my-hq'), null);
});

test('formSections: a collapsed section goes after the unclaimed fields and says it is collapsed', () => {
	const rows = ['name', 'author', 'source', 'status'].map((f) => fieldRow(f));
	const out = formSections(rows, [{ title: 'Provenance', fields: ['author', 'source'], collapsed: true }]);
	assert.deepEqual(out.map((s) => [s.title, s.fields.map((f) => f.field), s.collapsed ?? false]), [
		['', ['name', 'status'], false],
		['Provenance', ['author', 'source'], true],
	]);
	const open = formSections(rows, [{ title: 'Provenance', fields: ['author', 'source'] }]);
	assert.deepEqual(open.map((s) => s.title), ['Provenance', ''], 'an open section keeps its place');
});

test('withComputedRows: nothing before the field rows load — not `$source` alone; after, the rows then $source then the rest', async () => {
	const { withComputedRows } = await import('../../src/lib/computed-fields');
	const layered = SOURCES as any;
	// measured in a dev host: the overview (with its sources) landed first, the selection initialised on
	// [$source], and the list drew one column, Source, for the whole visit
	assert.deepEqual(withComputedRows([], 'tasks', layered), []);
	const after = withComputedRows([fieldRow('name')], 'tasks', layered).map((f) => f.field);
	assert.deepEqual(after.slice(0, 2), ['name', '$source']);
	assert.equal(withComputedRows([fieldRow('name')], 'tasks', [SOURCES[0]] as any).some((f) => f.field === '$source'), false, 'own root alone: no $source');
});

// cr-vscode-004: the source line's class word follows what the host says the root IS
test('originClassWord: layer, linked clone, package from `via`; nothing for the own root; the kind word without `via`', () => {
	assert.deepEqual(
		[originClassWord('layer', 'layer'), originClassWord('module', 'clone'), originClassWord('module', 'package'), originClassWord('own', 'own')],
		['layer', 'linked clone', 'package', ''],
	);
	assert.deepEqual([originClassWord('module', undefined), originClassWord('env', 'own')], ['module', 'env folder'], 'an older host keeps the old word; an env folder is always one');
});
