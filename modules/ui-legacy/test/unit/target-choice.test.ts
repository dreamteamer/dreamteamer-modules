// Tier 1 — WHAT NEW DOES, decided before the form (cr-vscode-004, lines 5 and 6; `lib/sources.ts`
// `targetChoice`). A target is an installed source whose `access` is `write`. Synthetic names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceEntry } from '../../src/api/types';
import { isTarget, targetChoice } from '../../src/lib/sources';

const own: SourceEntry = { name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' };
const a: SourceEntry = { name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'write' };
const b: SourceEntry = { name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit', note: 'project-b has no compiled tasks — run dt compile -w project-b' };
const c: SourceEntry = { name: 'project-c', kind: 'layer', repo: 'git_modules/project-c', path: 'git_modules/project-c/data/tasks', installed: false, count: 0, via: 'layer', access: 'read', note: 'project-c is declared but not installed' };
const names = (xs: SourceEntry[]) => xs.map((s) => s.name);

test('a target is installed AND writes', () => {
	assert.deepEqual([own, a, b, c].map(isTarget), [true, true, false, false]);
});

test('two writable sources, nothing narrowed: CHOOSE between them (line 5)', () => {
	const ch = targetChoice([own, a, b, c], []);
	assert.equal(ch.mode, 'choose');
	if (ch.mode !== 'choose') return;
	assert.deepEqual(names(ch.targets), ['my-hq', 'project-a']);
	assert.deepEqual(ch.excluded, [], 'un-narrowed, the rest is a count, not a row each');
	assert.equal(ch.hidden, 1, 'project-b — the absent project-c is not a source anyone reads');
	assert.equal(ch.hidden, ch.others.length, 'the count is the sources the menu names on its card (cr-vscode-016)');
});

test('narrowed to exactly ONE writable source: no choice, straight to it (line 6)', () => {
	assert.deepEqual(targetChoice([own, a, b], ['project-a']), { mode: 'direct', target: a });
	assert.deepEqual(targetChoice([own, a, b], ['project-a', 'project-b']), { mode: 'direct', target: a }, 'one writable among the narrowed is still one');
});

test('narrowed to two writable sources: choose between THOSE', () => {
	const ch = targetChoice([own, a, b], ['my-hq', 'project-a']);
	assert.equal(ch.mode, 'choose');
	if (ch.mode === 'choose') assert.deepEqual(names(ch.targets), ['my-hq', 'project-a']);
});

test('narrowed to sources that take no new record: offer every writable root, and say why the narrowed ones are not (line 6)', () => {
	const ch = targetChoice([own, a, b, c], ['project-b']);
	assert.equal(ch.mode, 'choose');
	if (ch.mode !== 'choose') return;
	assert.deepEqual(names(ch.targets), ['my-hq', 'project-a']);
	assert.deepEqual(ch.excluded.map((x) => [x.source.name, x.reason]), [['project-b', b.note]]);
	const one = targetChoice([own, b], ['project-b']);
	assert.equal(one.mode, 'choose', 'even ONE writable root is asked, so the reason is said before the form');
	if (one.mode === 'choose') assert.deepEqual(names(one.targets), ['my-hq']);
});

test('one writable source, nothing narrowed: straight to it — today\'s create, unchanged', () => {
	assert.deepEqual(targetChoice([own, b], []), { mode: 'direct', target: own });
	assert.deepEqual(targetChoice([own], []), { mode: 'direct', target: own });
});

test('a host that says nothing about writability: the form as it always opened', () => {
	const bare = [{ ...own, access: undefined, via: undefined }, { ...a, access: undefined, via: undefined }];
	assert.deepEqual(targetChoice(bare, []), { mode: 'direct', target: null });
	assert.deepEqual(targetChoice(undefined, []), { mode: 'direct', target: null });
});
