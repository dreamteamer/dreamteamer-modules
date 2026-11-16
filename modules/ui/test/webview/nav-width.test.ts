/**
 * Render tier — the nav width (browser host): "The nav width is draggable between its minimum and maximum and is the
 * same after a reload and the arrow keys move it." The nav's edge is a focusable vertical separator carrying its value
 * and bounds; a drag, the arrows, Home/End and a double-click change it; a fresh mount (a reload) reads the kept width.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, flush, render, unmountAll, type TestNode } from './render';
import NavSidebar from '../../src/components/NavSidebar.vue';

(globalThis as { window?: any }).window ??= { addEventListener() {}, removeEventListener() {} };
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, String(v)),
	removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => {
	resetHost();
	store.clear();
	onHostRequest((method, path) => {
		if (method === 'GET' && path === '/nav') return [{ kind: 'workspace', key: 'workspace', label: 'northwind-hq', children: [] }];
		throw new Error(`unexpected ${method} ${path}`);
	});
});
afterEach(() => unmountAll());

const mount = () => render(NavSidebar, {}, [createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })]);
const edge = (root: TestNode) => { const e = all(root, (n) => n.props['role'] === 'separator')[0]; assert.ok(e, 'the nav has no resize edge'); return e; };
const nav = (root: TestNode) => all(root, (n) => n.tag === 'nav')[0];
const fire = async (n: TestNode, ev: string, e: Record<string, unknown> = {}) => { (n.props[ev] as (e: unknown) => void)({ preventDefault() {}, shiftKey: false, button: 0, pointerId: 1, currentTarget: null, ...e }); await flush(); };

test('the edge is a focusable vertical separator with its value and bounds; a fresh nav uses the token default', async () => {
	const root = await mount();
	const e = edge(root);
	assert.equal(e.props['aria-orientation'], 'vertical');
	assert.equal(e.props['tabindex'], '0');
	assert.deepEqual([e.props['aria-valuenow'], e.props['aria-valuemin'], e.props['aria-valuemax']], [260, 180, 480]);
	assert.equal(nav(root).props['style'], undefined, 'no width chosen: the stylesheet draws the default');
});

test('the arrow keys move it, Home and End go to the bounds, and the width is the same after a reload', async () => {
	let root = await mount();
	await fire(edge(root), 'onKeydown', { key: 'ArrowRight' });
	await fire(edge(root), 'onKeydown', { key: 'ArrowRight' });
	assert.equal(edge(root).props['aria-valuenow'], 292);
	assert.deepEqual(nav(root).props['style'], { '--dt-nav-w': '292px' });
	await fire(edge(root), 'onKeydown', { key: 'ArrowLeft' });
	assert.equal(edge(root).props['aria-valuenow'], 276);
	unmountAll();
	root = await mount();
	assert.equal(edge(root).props['aria-valuenow'], 276, 'a reload lost the width');
	await fire(edge(root), 'onKeydown', { key: 'Home' });
	assert.equal(edge(root).props['aria-valuenow'], 180);
	await fire(edge(root), 'onKeydown', { key: 'ArrowLeft' });
	assert.equal(edge(root).props['aria-valuenow'], 180, 'past the minimum');
	await fire(edge(root), 'onKeydown', { key: 'End' });
	assert.equal(edge(root).props['aria-valuenow'], 480);
	await fire(edge(root), 'onKeydown', { key: 'ArrowRight' });
	assert.equal(edge(root).props['aria-valuenow'], 480, 'past the maximum');
});

test('a drag follows the pointer inside the bounds with no transition, is kept on release, and a double-click resets it', async () => {
	let root = await mount();
	await fire(edge(root), 'onPointerdown', { clientX: 260 });
	assert.ok(String(nav(root).props['class']).includes('dt-nav--resizing'), 'the drag did not mark the nav (no-transition) state');
	await fire(edge(root), 'onPointermove', { clientX: 330 });
	assert.equal(edge(root).props['aria-valuenow'], 330);
	await fire(edge(root), 'onPointermove', { clientX: 2000 });
	assert.equal(edge(root).props['aria-valuenow'], 480, 'a drag past the maximum');
	await fire(edge(root), 'onPointermove', { clientX: 300 });
	await fire(edge(root), 'onPointerup', { clientX: 300 });
	assert.ok(!String(nav(root).props['class']).includes('dt-nav--resizing'));
	unmountAll();
	root = await mount();
	assert.equal(edge(root).props['aria-valuenow'], 300, 'a reload lost the dragged width');
	await fire(edge(root), 'onDblclick');
	assert.equal(edge(root).props['aria-valuenow'], 260);
	assert.equal(store.size, 0, 'the reset kept a width');
	unmountAll();
	root = await mount();
	assert.equal(edge(root).props['aria-valuenow'], 260);
});

test('with storage off the nav still draws and resizes for this page', async () => {
	const g = globalThis as { localStorage?: unknown };
	const before = g.localStorage;
	g.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	try {
		const root = await mount();
		await fire(edge(root), 'onKeydown', { key: 'End' });
		assert.equal(edge(root).props['aria-valuenow'], 480);
	} finally {
		g.localStorage = before;
	}
});

test('the edge never animates its width and honours reduced motion: its only transition is a token duration', async () => {
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('../../src/components/NavSidebar.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	const css = src.slice(src.indexOf('<style'));
	assert.doesNotMatch(css, /transition:[^;]*\bwidth\b/, 'the nav width transitions');
	for (const m of css.matchAll(/\.dt-nav-resize[^{]*\{([^}]*)\}/g)) {
		const t = /transition:([^;]*)/.exec(m[1]!)?.[1];
		if (t && t.trim() !== 'none') assert.match(t, /var\(--dt-dur-(fast|med)\)/, 'a transition that does not go to zero under prefers-reduced-motion');
	}
});
