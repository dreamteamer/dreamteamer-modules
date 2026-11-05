/**
 * THE NEW RECORD MENU IS ONE LINE PER SOURCE (cr-vscode-016), rendered. In 0.24.27 each target row drew its mark
 * and a kind word ("this workspace", "record layer") in a second column — on a long layer name the word wrapped
 * over the pencil — and a paragraph said how many other sources take no new record. Now a row is its mark alone
 * (dot, name, pencil), the others are one '+N not offered' line, and every word is on a card the menu opens the
 * moment the pointer (or focus) is on the line — no timer. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { SourceEntry } from '../../src/api/types';
import { targetChoice } from '../../src/lib/sources';
import TargetChoice from '../../src/components/browse/TargetChoice.vue';

// A document whose listeners can be fired: the menu closes on Escape through its document keydown handler.
const listeners = new Map<string, Set<(e: unknown) => void>>();
(globalThis as { document?: unknown }).document = {
	addEventListener: (type: string, fn: (e: unknown) => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
	removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
};
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((fn) => fn(event));

const LONG = 'example-org-project-with-a-very-long-layer-name';
const SOURCES: SourceEntry[] = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: LONG, kind: 'layer', repo: `git_modules/${LONG}`, path: `git_modules/${LONG}/data/tasks`, installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit', note: 'project-b has no compiled tasks — run dt compile -w project-b' },
];

async function menu(selection: string[] = []) {
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push('/content/tasks');
	await router.isReady();
	const choice = targetChoice(SOURCES, selection);
	assert.equal(choice.mode, 'choose');
	const picks: string[] = [];
	let cancels = 0;
	const root = await render(TargetChoice, { choice, onPick: (n: string) => picks.push(n), onCancel: () => cancels++ }, [router]);
	return { root, picks, cancels: () => cancels };
}
const rows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-target-choice__row'));
const card = (root: TestNode) => find(root, (n) => n.props['role'] === 'tooltip');
const elements = (n: TestNode) => n.children.filter((c): c is TestNode => typeof c !== 'string' && !c.tag.startsWith('#'));

/** Fire a handler with no timer allowed: the card must be there after ONE nextTick, or the hover is not instant. */
async function instantly(handler: unknown): Promise<void> {
	const real = globalThis.setTimeout;
	(globalThis as { setTimeout: unknown }).setTimeout = () => {
		throw new Error('the card waited on a timer');
	};
	try {
		(handler as (e?: unknown) => void)();
		await nextTick();
	} finally {
		globalThis.setTimeout = real;
	}
}

test('each target row is ONE fit source mark — dot, name, pencil — and no kind column (lines 1, 2)', async () => {
	const { root } = await menu();
	assert.deepEqual(rows(root).map((r) => r.props['data-target']), ['my-hq', LONG]);
	for (const row of rows(root)) {
		const kids = elements(row);
		assert.equal(kids.length, 1, 'the row holds the mark and nothing else');
		assert.ok(hasClass(kids[0]!, 'dt-source-mark') && hasClass(kids[0]!, 'dt-source-mark--fit'));
		assert.equal(text(row).trim(), row.props['data-target'], 'its only words are the name');
		assert.match(String(find(row, (n) => hasClass(n, 'dt-source-mark__access'))?.props['class']), /codicon-edit/, 'with its pencil');
	}
	assert.equal(find(root, (n) => hasClass(n, 'dt-target-choice__via')), null);
	assert.doesNotMatch(text(root), /this workspace|record layer/, 'the kind is not drawn in the menu');
	assert.equal(card(root), null, 'no card until a row is hovered');
});

test("hovering a row opens its card at once — the full name and its kind — and leaving closes it (lines 2, 4)", async () => {
	const { root } = await menu();
	const layer = rows(root)[1]!;
	await instantly(layer.props['onMouseenter']);
	const c = card(root);
	assert.ok(c, 'one tooltip, with no timer');
	assert.equal(all(root, (n) => n.props['role'] === 'tooltip').length, 1);
	assert.match(text(c!), new RegExp(LONG), 'the full name, however the row ellipsised it');
	assert.match(text(c!), /record layer · writes here/);
	assert.equal(layer.props['aria-describedby'], c!.props['id'], 'the row names its card');
	(layer.props['onMouseleave'] as () => void)();
	await nextTick();
	assert.equal(card(root), null);
	await instantly(rows(root)[0]!.props['onMouseenter']);
	assert.match(text(card(root)!), /this workspace · writes here/);
});

test('focus opens the same card; blur closes it', async () => {
	const { root } = await menu();
	await instantly(rows(root)[0]!.props['onFocus']);
	assert.match(text(card(root)!), /my-hq/);
	(rows(root)[0]!.props['onBlur'] as () => void)();
	await nextTick();
	assert.equal(card(root), null);
});

test("the paragraph is gone; '+1 not offered' is one muted line whose card names the reason, on hover or focus (line 3)", async () => {
	const { root } = await menu();
	assert.equal(find(root, (n) => hasClass(n, 'dt-target-choice__hidden')), null);
	assert.doesNotMatch(text(root), /Sources picker says why|take no new record from here/);
	const more = find(root, (n) => hasClass(n, 'dt-target-choice__more'))!;
	assert.equal(text(more).trim(), '+1 not offered');
	assert.equal(more.props['tabindex'], '0', 'reachable by keyboard');
	await instantly(more.props['onMouseenter']);
	assert.match(text(card(root)!), /Not offered here/);
	assert.match(text(card(root)!), /project-b has no compiled tasks/);
	(more.props['onMouseleave'] as () => void)();
	await nextTick();
	await instantly(more.props['onFocus']);
	assert.match(text(card(root)!), /project-b has no compiled tasks/);
});

test('a pick still emits the source and clears the card; Escape cancels and clears it (line 5)', async () => {
	const { root, picks, cancels } = await menu();
	const layer = rows(root)[1]!;
	await instantly(layer.props['onMouseenter']);
	(layer.props['onClick'] as () => void)();
	await nextTick();
	assert.deepEqual(picks, [LONG]);
	assert.equal(card(root), null);
	await instantly(rows(root)[0]!.props['onMouseenter']);
	fire('keydown', { key: 'Escape' });
	await flush();
	assert.equal(cancels(), 1);
	assert.equal(card(root), null);
});

test('narrowed to a source that takes no new record: its reason stays visible text, its mark fits its line (D7)', async () => {
	const { root } = await menu(['project-b']);
	const excluded = find(root, (n) => n.props['data-excluded'] === 'project-b')!;
	assert.match(text(excluded), /dt compile -w project-b/, 'the reason, visible');
	assert.ok(find(excluded, (n) => hasClass(n, 'dt-source-mark--fit')));
	assert.match(text(root), /Not offered/);
	await instantly(excluded.props['onMouseenter']);
	assert.match(text(card(root)!), /record layer · edits here/);
});
