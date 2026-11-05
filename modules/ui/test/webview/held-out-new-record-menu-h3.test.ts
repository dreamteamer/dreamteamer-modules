// Held-out h3 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h3) — written by the plan
// review, never read by the builder. A WRITABLE target that carries a host `note`: the design's card for a
// target row is "title the full name; body viaWord · accessWord; body the host's note when it sent one" —
// so its card shows the note, and the note is never drawn in the menu itself. A target with no note gets no
// other source's note on its card. Synthetic names only. Run: npm test -- --only=held-out-new-record-menu-h3
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { all, flush, hasClass, render, text, type TestNode } from './render';
import type { SourceEntry } from '../../src/api/types';
import { targetChoice, targetHoverLines } from '../../src/lib/sources';
import TargetChoice from '../../src/components/browse/TargetChoice.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1386, innerHeight: 800 };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const WRITE_NOTE = 'layer-noted writes through its own workspace — synthetic host note';
const EDIT_NOTE = 'layer-edit has no compiled notes — run dt compile -w layer-edit';
const SOURCES: SourceEntry[] = [
	{ name: 'hq-sample', kind: 'own', repo: '.', path: 'data/notes', installed: true, count: 1, via: 'own', access: 'write' },
	{ name: 'layer-noted', kind: 'layer', repo: 'git_modules/layer-noted', path: 'git_modules/layer-noted/data/notes', installed: true, count: 1, via: 'layer', access: 'write', note: WRITE_NOTE },
	{ name: 'layer-edit', kind: 'layer', repo: 'git_modules/layer-edit', path: 'git_modules/layer-edit/data/notes', installed: true, count: 1, via: 'layer', access: 'edit', note: EDIT_NOTE },
];

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/notes');
	await r.isReady();
	return r;
}
const cards = (root: TestNode) => all(root, (n) => n.props['role'] === 'tooltip');
const ev = (n: TestNode) => ({ currentTarget: n, target: n, relatedTarget: null, preventDefault() {}, stopPropagation() {} });

test('h3: the builder — a writable target\'s note is one of its card lines, after the kind line', () => {
	const lines = targetHoverLines(SOURCES[1]!);
	assert.equal(lines[0]?.text, 'layer-noted');
	assert.equal(lines[0]?.kind, 'title');
	const texts = lines.map((l) => l.text);
	assert.ok(texts.includes('record layer · writes here'), 'the kind line');
	assert.ok(texts.includes(WRITE_NOTE), 'the host\'s note, when it sent one');
	assert.ok(texts.indexOf(WRITE_NOTE) > texts.indexOf('record layer · writes here'));
	assert.ok(!targetHoverLines(SOURCES[0]!).some((l) => l.text.includes('note')), 'a target with no note has no note line');
});

test('h3: rendered — the noted target\'s card shows its note; the note is never menu text; the other target\'s card carries no note', async () => {
	const choice = targetChoice(SOURCES, []);
	const root = await render(TargetChoice, { choice }, [await router()]);
	assert.ok(!text(root).includes(WRITE_NOTE), 'the note is not drawn in the menu');
	assert.ok(!text(root).includes(EDIT_NOTE), 'nor the not-offered source\'s reason');
	const rows = all(root, (n) => hasClass(n, 'dt-target-choice__row'));
	const row = (name: string) => rows.find((r) => r.props['data-target'] === name)!;

	(row('layer-noted').props['onMouseenter'] as (e: unknown) => void)(ev(row('layer-noted')));
	await flush();
	assert.equal(cards(root).length, 1);
	assert.ok(text(cards(root)[0]!).includes(WRITE_NOTE), 'the writable target\'s card shows the host note');
	(row('layer-noted').props['onMouseleave'] as (e: unknown) => void)(ev(row('layer-noted')));
	await flush();

	(row('hq-sample').props['onMouseenter'] as (e: unknown) => void)(ev(row('hq-sample')));
	await flush();
	const own = text(cards(root)[0]!);
	assert.ok(!own.includes(WRITE_NOTE) && !own.includes(EDIT_NOTE), 'no other source\'s note on a target row\'s card');
});
