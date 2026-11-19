/**
 * Render tier — the one menu's PLACEMENT (DtMenu): fixed, from its anchor's rect, so no overflow ancestor clips it;
 * flipped above the trigger when there is no room below; inside the window horizontally; placed again on scroll and
 * resize. The tier has no layout, so the test gives the anchor and the menu their rects and fires a resize.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import fs from 'node:fs';
import { defineComponent, h, ref } from 'vue';
import { find, flush, hasClass, render, unmountAll, type TestNode } from './render';
import DtMenu from '../../src/components/DtMenu.vue';

type Listener = (e: unknown) => void;
const winListeners: Record<string, Listener[]> = {};
(globalThis as { window?: unknown }).window = {
	innerWidth: 1000,
	innerHeight: 800,
	addEventListener(type: string, fn: Listener) { (winListeners[type] ??= []).push(fn); },
	removeEventListener(type: string, fn: Listener) { winListeners[type] = (winListeners[type] ?? []).filter((f) => f !== fn); },
};
(globalThis as { document?: unknown }).document = { addEventListener() {}, removeEventListener() {} };
const fire = async (type: string) => { for (const fn of [...(winListeners[type] ?? [])]) fn({}); await flush(); };
afterEach(() => unmountAll());

const Host = (align: 'start' | 'end', at?: { x: number; y: number }) => defineComponent({
	setup() {
		const trigger = ref<unknown>(null);
		return () => h('span', { class: 'anchor' }, [
			h('button', { ref: trigger, class: 'trigger' }, '⋯'),
			h(DtMenu, { class: 'menu', align, ...(at ? { at, trigger: trigger.value } : {}) }, () => [h('button', { role: 'menuitem' }, 'Delete')]),
		]);
	},
});
const rect = (n: TestNode, r: { left: number; top: number; width: number; height: number }) => {
	Object.defineProperty(n, 'getBoundingClientRect', { value: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }), configurable: true });
};

async function mounted(align: 'start' | 'end', anchor: { left: number; top: number; width: number; height: number }, at?: { x: number; y: number }) {
	const root = await render(Host(align, at));
	const menu = find(root, (n) => hasClass(n, 'menu'))!;
	rect(find(root, (n) => hasClass(n, 'anchor'))!, anchor);
	rect(find(root, (n) => hasClass(n, 'trigger'))!, anchor);
	rect(menu, { left: 0, top: 0, width: 200, height: 150 });
	await fire('resize');
	return find(root, (n) => hasClass(n, 'menu'))!;
}

test('an anchored menu is fixed under its trigger, end-aligned, and follows a scroll', async () => {
	const menu = await mounted('end', { left: 600, top: 100, width: 28, height: 28 });
	assert.ok(hasClass(menu, 'dt-menu--below'));
	assert.deepEqual(menu.props['style'], { left: '428px', top: '134px' });
	rect(find(menu.parent!, (n) => hasClass(n, 'anchor')) ?? menu.parent!, { left: 600, top: 40, width: 28, height: 28 });
	await fire('scroll');
	assert.deepEqual(menu.props['style'], { left: '428px', top: '74px' }, 'the menu did not follow its trigger on scroll');
});

test('near the bottom of the window the menu flips above its trigger', async () => {
	const menu = await mounted('end', { left: 600, top: 720, width: 28, height: 28 });
	assert.deepEqual(menu.props['style'], { left: '428px', top: '564px' });
	assert.ok(hasClass(menu, 'dt-menu--flipped'));
});

test('near the left or right edge the menu is clamped inside the window', async () => {
	let menu = await mounted('end', { left: 10, top: 100, width: 28, height: 28 });
	assert.equal((menu.props['style'] as Record<string, string>).left, '4px', 'off the left edge');
	unmountAll();
	menu = await mounted('start', { left: 950, top: 100, width: 28, height: 28 });
	assert.equal((menu.props['style'] as Record<string, string>).left, '796px', 'off the right edge');
});

test('a point menu (a context menu) flips above its point near the bottom and is clamped, but stays put on scroll', async () => {
	const menu = await mounted('start', { left: 960, top: 760, width: 28, height: 20 }, { x: 960, y: 782 });
	assert.deepEqual(menu.props['style'], { left: '796px', top: '610px' });
	await fire('scroll');
	assert.deepEqual(menu.props['style'], { left: '796px', top: '610px' });
});

test('the menu is position: fixed in both placements and on the menu layer — no overflow ancestor clips it', () => {
	const src = fs.readFileSync(new URL('../../src/components/DtMenu.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(src, /\.dt-menu--fixed,\s*\.dt-menu--below \{\s*position: fixed;/);
	assert.doesNotMatch(src.slice(src.indexOf('<style')), /position: absolute/);
	const base = fs.readFileSync(new URL('../../src/styles/base.css', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(/\.dt-menu \{([^}]*)\}/.exec(base)![1]!, /z-index: var\(--dt-z-menu\)/);
});
