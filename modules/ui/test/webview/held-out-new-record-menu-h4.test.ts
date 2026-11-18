// Held-out h4 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h4) — written by the plan
// review, never read by the builder. The keyboard: focus on a target row and on the '+N not offered' line
// (which must be focusable) opens the same card as the pointer, the focused element pointing at it with
// aria-describedby; blur clears it; Escape — dispatched the way a real keydown travels, from the focused
// row up through the menu to the document — clears the card AND closes the menu with exactly ONE cancel.
// Synthetic names only. Run: npm test -- --only=held-out-new-record-menu-h4
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import type { SourceEntry } from '../../src/api/types';
import { targetChoice } from '../../src/lib/sources';
import TargetChoice from '../../src/components/browse/TargetChoice.vue';

// a document that KEEPS its listeners, so a keydown can be delivered the way the browser delivers it
type Listener = (e: unknown) => void;
const docListeners: Record<string, Listener[]> = {};
(globalThis as { document?: unknown }).document = {
	addEventListener(type: string, fn: Listener) { (docListeners[type] ??= []).push(fn); },
	removeEventListener(type: string, fn: Listener) { docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== fn); },
};
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1386, innerHeight: 800 };

const SOURCES: SourceEntry[] = [
	{ name: 'hq-sample', kind: 'own', repo: '.', path: 'data/notes', installed: true, count: 1, via: 'own', access: 'write' },
	{ name: 'layer-alpha', kind: 'layer', repo: 'git_modules/layer-alpha', path: 'git_modules/layer-alpha/data/notes', installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'layer-beta', kind: 'layer', repo: 'git_modules/layer-beta', path: 'git_modules/layer-beta/data/notes', installed: true, count: 1, via: 'layer', access: 'edit', note: 'layer-beta has no compiled notes — run dt compile -w layer-beta' },
];

afterEach(() => unmountAll());

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/notes');
	await r.isReady();
	return r;
}
const cards = (root: TestNode) => all(root, (n) => n.props['role'] === 'tooltip');
const ev = (n: TestNode, extra: Record<string, unknown> = {}) => ({ currentTarget: n, target: n, relatedTarget: null, preventDefault() {}, stopPropagation() {}, ...extra });
const call = (n: TestNode, prop: string, e: unknown) => { const f = n.props[prop] as Listener | undefined; if (typeof f === 'function') f(e); else if (Array.isArray(f)) for (const g of f) (g as Listener)(e); };

async function mount() {
	let cancels = 0;
	const picks: string[] = [];
	const root = await render(TargetChoice, { choice: targetChoice(SOURCES, []), onCancel: () => { cancels++; }, onPick: (n: string) => { picks.push(n); } }, [await router()]);
	return { root, cancels: () => cancels, picks };
}

test('h4: focus on a row opens its card, the row describes itself by it; blur clears it', async () => {
	const { root } = await mount();
	const row = all(root, (n) => hasClass(n, 'dt-target-choice__row')).find((r) => r.props['data-target'] === 'layer-alpha')!;
	assert.equal(typeof row.props['onFocus'], 'function', 'the row listens for focus');
	call(row, 'onFocus', ev(row));
	await flush();
	const c = cards(root);
	assert.equal(c.length, 1, 'focus opens the card');
	assert.match(text(c[0]!), /record layer · writes here/);
	assert.ok(c[0]!.props['id'], 'the card has an id');
	assert.equal(row.props['aria-describedby'], c[0]!.props['id'], 'the focused row is described by the card');
	call(row, 'onBlur', ev(row));
	await flush();
	assert.equal(cards(root).length, 0, 'blur clears it');
	assert.equal(row.props['aria-describedby'] ?? null, null, 'and the row no longer points at a card');
});

test('h4: the +N line is focusable and focus opens its reasons', async () => {
	const { root } = await mount();
	const more = find(root, (n) => hasClass(n, 'dt-target-choice__more'))!;
	assert.ok(more, '+1 not offered');
	assert.equal(String(more.props['tabindex']), '0', 'reachable by Tab');
	call(more, 'onFocus', ev(more));
	await flush();
	const c = cards(root);
	assert.equal(c.length, 1);
	assert.match(text(c[0]!), /layer-beta has no compiled notes/);
	call(more, 'onBlur', ev(more));
	await flush();
	assert.equal(cards(root).length, 0);
});

test('h4: Escape with a focused row — the card goes and the menu is cancelled exactly once', async () => {
	const { root, cancels, picks } = await mount();
	const row = all(root, (n) => hasClass(n, 'dt-target-choice__row'))[0]!;
	call(row, 'onFocus', ev(row));
	await flush();
	assert.equal(cards(root).length, 1);
	const menu = find(root, (n) => n.props['data-target-choice'] !== undefined)!;
	const key = ev(row, { key: 'Escape', code: 'Escape', type: 'keydown' });
	// bubble: the focused row, every ancestor up to the menu, then the document
	for (let n: TestNode | null = row; n; n = n === menu ? null : n.parent) call(n, 'onKeydown', key);
	for (const fn of [...(docListeners['keydown'] ?? [])]) fn(key);
	await flush();
	assert.equal(cancels(), 1, 'one cancel — Escape is not handled twice on its way up');
	assert.equal(cards(root).length, 0, 'and the card is cleared with it');
	assert.deepEqual(picks, [], 'Escape picks nothing');
});
