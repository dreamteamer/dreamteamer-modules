// Tier 1 — THE NEW RECORD MENU'S BUILDERS (cr-vscode-016; `lib/sources.ts`). The menu draws a target row as its
// mark alone and every word about it — the kind, the writability, the host's note, why the other sources are not
// offered — on a card. These are the lines that card holds (HoverCard's own `lines` shape, cr-vscode-013), the
// sources the '+N not offered' line counts, and where the card goes beside the menu. Synthetic names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceEntry } from '../../src/api/types';
import { cardPlace, excludedHoverLines, othersHoverLines, targetChoice, targetHoverLines } from '../../src/lib/sources';

const own: SourceEntry = { name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' };
const a: SourceEntry = { name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'write' };
const b: SourceEntry = { name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit', note: 'project-b has no compiled tasks — run dt compile -w project-b' };
const c: SourceEntry = { name: 'project-c', kind: 'layer', repo: 'git_modules/project-c', path: 'git_modules/project-c/data/tasks', installed: false, count: 0, via: 'layer', access: 'read', note: 'project-c is declared but not installed' };

test('the sources "+N not offered" counts are named, each with its reason, and hidden is their number', () => {
	const ch = targetChoice([own, a, b, c], []);
	assert.equal(ch.mode, 'choose');
	if (ch.mode !== 'choose') return;
	assert.deepEqual(ch.others.map((x) => [x.source.name, x.reason]), [['project-b', b.note]]);
	assert.equal(ch.hidden, ch.others.length);
	const narrowed = targetChoice([own, a, b, c], ['project-b']);
	assert.equal(narrowed.mode, 'choose');
	if (narrowed.mode === 'choose') {
		assert.deepEqual(narrowed.others, [], 'a narrowed source is in excluded, never counted twice');
		assert.equal(narrowed.hidden, 0);
	}
});

test("a target row's card: the full name, then its kind and writability in words", () => {
	assert.deepEqual(targetHoverLines(a), [
		{ text: 'project-a', kind: 'title' },
		{ text: 'record layer · writes here', kind: 'body' },
	]);
	assert.deepEqual(targetHoverLines(own), [
		{ text: 'my-hq', kind: 'title' },
		{ text: 'this workspace · writes here', kind: 'body' },
	]);
	const noted = { ...a, note: 'project-a writes through its own workspace' };
	assert.deepEqual(targetHoverLines(noted).at(-1), { text: 'project-a writes through its own workspace', kind: 'body' }, 'a host note on a writable target is shown too');
	assert.deepEqual(targetHoverLines({ ...a, via: undefined, access: undefined }), [{ text: 'project-a', kind: 'title' }], 'no words, no empty line');
});

test("a narrowed source that is not offered: its card names it and its kind — the reason is already visible text", () => {
	assert.deepEqual(excludedHoverLines({ source: b, reason: b.note! }), [
		{ text: 'project-b', kind: 'title' },
		{ text: 'record layer · edits here · new records in its own workspace', kind: 'body' },
	]);
});

test("the '+N not offered' card: a title, then one line per source's reason", () => {
	assert.deepEqual(othersHoverLines([{ source: b, reason: b.note! }, { source: c, reason: c.note! }]), [
		{ text: 'Not offered here', kind: 'title' },
		{ text: b.note, kind: 'body' },
		{ text: c.note, kind: 'body' },
	]);
});

test('the card goes left of the menu, else right, else below it clamped into the viewport', () => {
	assert.deepEqual(cardPlace({ left: 1088, right: 1378, height: 120 }, 30, 280, 1386), { side: 'left', top: 30 });
	assert.deepEqual(cardPlace({ left: 4, right: 294, height: 120 }, 30, 280, 1386), { side: 'right', top: 30 });
	assert.deepEqual(cardPlace({ left: 190, right: 476, height: 120 }, 30, 280, 480), { side: 'below', top: 124, left: 0 }, 'card x 190, inside [4, 196]');
	assert.deepEqual(cardPlace({ left: 220, right: 476, height: 120 }, 30, 280, 480), { side: 'below', top: 124, left: -24 }, 'the clamp bites: card x 196');
});
