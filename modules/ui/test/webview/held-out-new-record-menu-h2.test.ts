// Held-out h2 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h2) — written by the plan
// review, never read by the builder. Three writable targets (own, a layer, a linked clone) + one NARROWED
// source that takes no new record + one un-narrowed source that takes none: the rows in source order, the
// narrowed block with its visible reason (cr-vscode-004 line 6, D7), '+1 not offered' for the other, and each
// block's card saying what it should — moving between rows keeps exactly one card, the hovered one's.
// Synthetic names only. Run: npm test -- --only=held-out-new-record-menu-h2
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { SourceEntry } from '../../webview/src/api/types';
import { targetChoice } from '../../webview/src/lib/sources';
import TargetChoice from '../../webview/src/components/browse/TargetChoice.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1386, innerHeight: 800 };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const GAMMA_NOTE = 'layer-gamma has no compiled notes — its records are edited in place, and a new one is added there once `dt compile -w layer-gamma` has run';
const DELTA_NOTE = 'pkg-delta is an installed package — nothing is written to it from this workspace; change it in the package\'s own repo';
// deliberately interleaved: the menu must keep the HOST's order, not group by kind
const SOURCES: SourceEntry[] = [
	{ name: 'layer-gamma', kind: 'layer', repo: 'git_modules/layer-gamma', path: 'git_modules/layer-gamma/data/notes', installed: true, count: 2, via: 'layer', access: 'edit', note: GAMMA_NOTE },
	{ name: 'hq-sample', kind: 'own', repo: '.', path: 'data/notes', installed: true, count: 1, via: 'own', access: 'write' },
	{ name: 'pkg-delta', kind: 'module', repo: '.', path: 'node_modules/@sample/pkg-delta/data/notes', installed: true, count: 4, via: 'package', access: 'read', note: DELTA_NOTE },
	{ name: 'layer-alpha', kind: 'layer', repo: 'git_modules/layer-alpha', path: 'git_modules/layer-alpha/data/notes', installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'clone-beta', kind: 'module', repo: 'git_modules/clone-beta', path: 'git_modules/clone-beta/data/notes', installed: true, count: 1, via: 'clone', access: 'write' },
	{ name: 'layer-absent', kind: 'layer', repo: 'git_modules/layer-absent', path: 'git_modules/layer-absent/data/notes', installed: false, count: 0, via: 'layer', access: 'read', note: 'layer-absent is declared but not installed' },
];

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/notes');
	await r.isReady();
	return r;
}
const cards = (root: TestNode) => all(root, (n) => n.props['role'] === 'tooltip');
const ev = (n: TestNode) => ({ currentTarget: n, target: n, relatedTarget: null, preventDefault() {}, stopPropagation() {} });
const enter = async (n: TestNode) => { (n.props['onMouseenter'] as (e: unknown) => void)(ev(n)); await flush(); };
const leave = async (n: TestNode) => { (n.props['onMouseleave'] as (e: unknown) => void)(ev(n)); await flush(); };
const oneCard = (root: TestNode, why: string) => {
	const c = cards(root);
	assert.equal(c.length, 1, `${why}: exactly one card`);
	return text(c[0]!).replace(/\s+/g, ' ').trim();
};

test('h2: the choice itself — three targets in host order, the narrowed one excluded with its reason, one other counted with its reason', () => {
	const ch = targetChoice(SOURCES, ['layer-gamma']);
	assert.equal(ch.mode, 'choose');
	if (ch.mode !== 'choose') return;
	assert.deepEqual(ch.targets.map((t) => t.name), ['hq-sample', 'layer-alpha', 'clone-beta']);
	assert.deepEqual(ch.excluded.map((x) => [x.source.name, x.reason]), [['layer-gamma', GAMMA_NOTE]]);
	const others = (ch as unknown as { others: Array<{ source: SourceEntry; reason: string }> }).others;
	assert.deepEqual(others.map((x) => [x.source.name, x.reason]), [['pkg-delta', DELTA_NOTE]], 'the uninstalled layer is nobody\'s source; the narrowed one is not counted twice');
	assert.equal(ch.hidden, others.length);
});

test('h2: the menu — rows, the Not offered block with its visible reason, +1 not offered, and each block\'s card', async () => {
	const choice = targetChoice(SOURCES, ['layer-gamma']);
	const root = await render(TargetChoice, { choice }, [await router()]);
	const rows = all(root, (n) => hasClass(n, 'dt-target-choice__row'));
	assert.deepEqual(rows.map((r) => r.props['data-target']), ['hq-sample', 'layer-alpha', 'clone-beta'], 'rows in source order');
	const excluded = find(root, (n) => n.props['data-excluded'] === 'layer-gamma');
	assert.ok(excluded, 'the narrowed source is listed as not offered');
	assert.match(text(excluded!), /dt compile -w layer-gamma/, 'with its reason as VISIBLE text (D7)');
	assert.ok(find(root, (n) => hasClass(n, 'dt-target-choice__subhead') && /Not offered/.test(text(n))), 'under the Not offered subhead');
	const more = find(root, (n) => hasClass(n, 'dt-target-choice__more'));
	assert.ok(more, 'the other source is one line');
	assert.equal(text(more!).trim(), '+1 not offered');
	assert.equal(find(root, (n) => hasClass(n, 'dt-target-choice__hidden')), null, 'the paragraph is gone');
	assert.doesNotMatch(text(root), /Sources picker says why|pkg-delta/, 'the other source is neither named nor explained in the menu itself');
	assert.equal(cards(root).length, 0, 'no card before a hover');

	const want: Record<string, RegExp> = {
		'hq-sample': /this workspace · writes here/,
		'layer-alpha': /record layer · writes here/,
		'clone-beta': /linked clone · writes here/,
	};
	for (const row of rows) {
		const name = String(row.props['data-target']);
		await enter(row);
		const t = oneCard(root, name);
		assert.ok(t.includes(name), `${name}: the card names the source`);
		assert.match(t, want[name]!, `${name}: and its kind and writability`);
		for (const other of Object.keys(want)) if (other !== name) assert.ok(!t.includes(other), `${name}: and no other row's name`);
		await leave(row);
		assert.equal(cards(root).length, 0, `${name}: leaving clears it`);
	}

	await enter(excluded!);
	const ex = oneCard(root, 'the excluded line');
	assert.ok(ex.includes('layer-gamma'), 'the excluded line\'s card names it');
	assert.match(ex, /record layer/, 'and says what it is');
	assert.ok(!ex.includes('pkg-delta'), 'and nothing about the counted one');
	await leave(excluded!);

	await enter(more!);
	const m = oneCard(root, '+1 not offered');
	assert.ok(m.includes(DELTA_NOTE.replace(/\s+/g, ' ')), 'the +1 card carries the counted source\'s reason');
	assert.ok(!m.includes('compile -w layer-gamma'), 'and not the narrowed one\'s — that one is already said in the block');
	await leave(more!);

	// moving between rows: one card, the one under the pointer; a late leave of the old row does not clear the new card
	await enter(rows[0]!);
	await enter(rows[1]!);
	assert.match(oneCard(root, 'after moving from row 1 to row 2'), /layer-alpha/);
	await leave(rows[0]!);
	assert.match(oneCard(root, 'a stale leave of row 1'), /layer-alpha/, 'row 1\'s late mouseleave must not close row 2\'s card');
	await leave(rows[1]!);
	assert.equal(cards(root).length, 0);
});
