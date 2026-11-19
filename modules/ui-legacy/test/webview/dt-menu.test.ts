/**
 * Render tier — THE ONE MENU (DtMenu.vue). "Every dropdown and context menu in the app is drawn by one menu component
 * with one shadow and one z-index." Its keyboard (arrows, Tab, Home/End, type-ahead, disabled items skipped), its
 * dismissal (Escape — once, however many listeners see it — and a press outside), focus back to the trigger, and a
 * static check that no menu in src is drawn by anything else.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { defineComponent, h, ref } from 'vue';
import { all, find, flush, focused, hasClass, render, unmountAll, type TestNode } from './render';
import DtMenu from '../../src/components/DtMenu.vue';

type Listener = (e: unknown) => void;
const docListeners: Record<string, Listener[]> = {};
(globalThis as { document?: unknown }).document = {
	addEventListener(type: string, fn: Listener) { (docListeners[type] ??= []).push(fn); },
	removeEventListener(type: string, fn: Listener) { docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== fn); },
};
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 1000 };
const fireDoc = (type: string, e: unknown) => { for (const fn of [...(docListeners[type] ?? [])]) fn(e); };

afterEach(() => unmountAll());
let closes: string[] = [];
beforeEach(() => { closes = []; focused.length = 0; });

/** A trigger and a menu of four entries (the third disabled), drawn while `open`. */
const Host = defineComponent({
	setup() {
		const open = ref(true);
		const trigger = ref<unknown>(null);
		return () => h('div', { class: 'host' }, [
			h('button', { ref: trigger, class: 'trigger' }, 'More'),
			open.value
				? h(DtMenu, { label: 'Actions', trigger: trigger.value, onClose: (r: string) => { closes.push(r); open.value = false; } }, () => [
					h('button', { role: 'menuitem', class: 'dt-menu-item', 'data-id': 'edit' }, 'Edit'),
					h('button', { role: 'menuitem', class: 'dt-menu-item', 'data-id': 'hide' }, 'Hide'),
					h('button', { role: 'menuitem', class: 'dt-menu-item', 'data-id': 'dup', disabled: true }, 'Duplicate'),
					h('button', { role: 'menuitem', class: 'dt-menu-item', 'data-id': 'delete' }, 'Delete'),
				])
				: null,
		]);
	},
});

const menuOf = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-menu'));
const item = (root: TestNode, id: string) => find(root, (n) => n.props['data-id'] === id)!;
const key = async (root: TestNode, k: string, extra: Record<string, unknown> = {}) => {
	(menuOf(root)!.props['onKeydown'] as Listener)({ key: k, preventDefault() {}, stopPropagation() {}, ...extra });
	await flush();
};
const last = () => focused[focused.length - 1];

test('one surface: the menu role, its name, the .dt-menu class, focusable itself, hung under its parent', async () => {
	const root = await render(Host);
	const m = menuOf(root)!;
	assert.equal(m.props['role'], 'menu');
	assert.equal(m.props['aria-label'], 'Actions');
	assert.equal(m.props['tabindex'], '-1');
	assert.ok(hasClass(m, 'dt-menu--below'));
});

test('focus goes to the first item on open; arrows and Tab wrap, skipping the disabled one; Home and End', async () => {
	const root = await render(Host);
	assert.equal(last(), item(root, 'edit'), 'the first item is not focused on open');
	await key(root, 'ArrowDown');
	assert.equal(last(), item(root, 'hide'));
	await key(root, 'ArrowDown');
	assert.equal(last(), item(root, 'delete'), 'the disabled item took focus');
	await key(root, 'ArrowDown');
	assert.equal(last(), item(root, 'edit'), 'down did not wrap');
	await key(root, 'ArrowUp');
	assert.equal(last(), item(root, 'delete'), 'up did not wrap');
	await key(root, 'Home');
	assert.equal(last(), item(root, 'edit'));
	await key(root, 'End');
	assert.equal(last(), item(root, 'delete'));
	await key(root, 'Tab');
	assert.equal(last(), item(root, 'edit'), 'Tab left the menu');
	await key(root, 'Tab', { shiftKey: true });
	assert.equal(last(), item(root, 'delete'), 'Shift+Tab left the menu');
});

test('type-ahead moves to the next item starting with what was typed, never to a disabled one', async () => {
	let root = await render(Host);
	await key(root, 'd');
	assert.equal(last(), item(root, 'delete'), 'type-ahead landed on the disabled Duplicate, or nowhere');
	unmountAll();
	root = await render(Host);
	await key(root, 'h');
	assert.equal(last(), item(root, 'hide'));
	await key(root, 'i');
	assert.equal(last(), item(root, 'hide'), 'a second letter within the pause narrows the same word');
});

test('Escape closes once — the menu and the document both see it — and focus goes back to the trigger', async () => {
	const root = await render(Host);
	const trigger = find(root, (n) => hasClass(n, 'trigger'))!;
	const e = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
	(menuOf(root)!.props['onKeydown'] as Listener)(e);
	fireDoc('keydown', e);
	await flush();
	assert.deepEqual(closes, ['escape']);
	assert.equal(menuOf(root), null);
	assert.equal(last(), trigger, 'focus did not return to the trigger');
});

test('Escape from the document alone closes it (focus was on the trigger, not in the menu)', async () => {
	const root = await render(Host);
	fireDoc('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
	await flush();
	assert.deepEqual(closes, ['escape']);
	assert.equal(menuOf(root), null);
});

test('a press outside closes it and leaves focus where the press put it; a press on the menu or the trigger does not', async () => {
	const root = await render(Host);
	const m = menuOf(root)!;
	const trigger = find(root, (n) => hasClass(n, 'trigger'))!;
	// the tier has no layout: give the two boxes a `contains` that answers for their own subtree
	const inside = (box: TestNode) => (t: unknown) => all(box, () => true).includes(t as TestNode);
	Object.defineProperty(m, 'contains', { value: inside(m), configurable: true });
	Object.defineProperty(trigger, 'contains', { value: inside(trigger), configurable: true });
	fireDoc('mousedown', { target: item(root, 'hide') });
	fireDoc('mousedown', { target: trigger });
	await flush();
	assert.deepEqual(closes, [], 'a press on the menu or its trigger closed it');
	focused.length = 0;
	fireDoc('mousedown', { target: find(root, (n) => hasClass(n, 'host')) });
	await flush();
	assert.deepEqual(closes, ['outside']);
	assert.equal(menuOf(root), null);
	assert.equal(focused.length, 0, 'an outside press pulled focus back to the trigger');
});

test('a fixed menu (a context menu) is placed at its point; a combobox panel keeps its own keys and dismissal', async () => {
	const root = await render(defineComponent({
		setup: () => () => h('div', [
			h(DtMenu, { class: 'ctx', at: { x: 40, y: 60 } }, () => [h('button', { role: 'menuitem' }, 'One')]),
			h(DtMenu, { class: 'combo', role: 'presentation', anchor: 'none', keys: false, dismiss: false }, () => [h('input', {})]),
		]),
	}));
	const ctx = find(root, (n) => hasClass(n, 'ctx'))!;
	assert.deepEqual(ctx.props['style'], { left: '40px', top: '60px' });
	assert.ok(hasClass(ctx, 'dt-menu--fixed'));
	const combo = find(root, (n) => hasClass(n, 'combo'))!;
	assert.ok(hasClass(combo, 'dt-menu'), 'the combobox panel is not the one surface');
	assert.ok(!hasClass(combo, 'dt-menu--below'), 'a caller-placed panel got the anchored placement');
	focused.length = 0;
	(combo.props['onKeydown'] as Listener)({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
	(combo.props['onKeydown'] as Listener)({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
	await flush();
	assert.equal(focused.length, 0, 'a keys:false panel moved focus');
});

// ---- the static half: every menu in src is a DtMenu, and the surface is defined once ----------------------------------

const SRC = path.resolve(new URL('.', import.meta.url).pathname.replace('/.test-build/webview', '/test/webview'), '..', '..', 'src');
function files(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
const sources = files(SRC).filter((f) => /\.(vue|ts|css)$/.test(f)).map((f) => ({ file: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));

test('no menu is drawn outside DtMenu: no role="menu" element, no reka-ui DropdownMenu or ContextMenu', () => {
	for (const { file, text } of sources) {
		if (file === path.join('components', 'DtMenu.vue')) continue;
		assert.doesNotMatch(text, /<[a-z][^>]*\srole="menu"/, `${file} draws its own role="menu" element`);
		assert.doesNotMatch(text, /\b(DropdownMenu|ContextMenu)[A-Z]\w*/, `${file} uses a reka-ui menu`);
		// a listbox POPUP is a DtMenu too; the listboxes allowed elsewhere sit INSIDE one (DtSelect's list), are a dialog's
		// result list (search), or expand in flow and pop nothing up (the filter's field picker, by its own header)
		if (/<[a-z][^>]*\srole="listbox"/.test(text)) assert.ok(['components/DtSelect.vue', 'components/SearchModal.vue', 'components/FilterFieldPicker.vue'].includes(file.split(path.sep).join('/')), `${file} draws its own listbox popup`);
	}
});

test('one shadow and one z-index: only the .dt-menu surface applies --dt-shadow-menu as a menu and --dt-z-menu', () => {
	const zUses = sources.filter(({ text }) => /z-index:\s*var\(--dt-z-menu\)/.test(text)).map((s) => s.file.split(path.sep).join('/'));
	assert.deepEqual(zUses, ['styles/base.css'], 'a menu sets its own layer');
	const base = sources.find((s) => s.file.endsWith('base.css'))!.text;
	const menuRule = /\.dt-menu \{([^}]*)\}/.exec(base)?.[1] ?? '';
	assert.match(menuRule, /box-shadow:\s*var\(--dt-shadow-menu\)/);
	assert.match(menuRule, /z-index:\s*var\(--dt-z-menu\)/);
	// every menu caller leaves the surface to .dt-menu: none restates a shadow, a layer or a ground of its own
	for (const f of ['components/NavMenu.vue', 'components/PaneSwitcher.vue', 'components/browse/DensityMenu.vue', 'components/CommitButton.vue', 'components/browse/TargetChoice.vue', 'components/browse/SourcePicker.vue']) {
		const text = sources.find((s) => s.file.split(path.sep).join('/') === f)!.text;
		const css = text.slice(text.indexOf('<style'));
		assert.match(text, /<DtMenu\b/, `${f} does not draw its menu with DtMenu`);
		for (const m of css.matchAll(/([^{}]*(?:menu|__panel|target-choice)\b[^{}]*)\{([^}]*)\}/g)) {
			if (/__card|__line|__list|__item|__row|-item|__hint|__notice|__error|__muted|__settings|__head|__subhead|__more|__reason|__excluded|__empty|-actions|-ask|-title|-input|-ok|__access|__count|__check|__name|__note|__all/.test(m[1]!)) continue;
			assert.doesNotMatch(m[2]!, /box-shadow|z-index/, `${f}: ${m[1]!.trim()} restates the menu surface`);
		}
	}
});

test('reduced motion: the menu surface and its items carry no animation or transition', () => {
	const own = sources.find((s) => s.file.endsWith('DtMenu.vue'))!.text;
	assert.doesNotMatch(own.slice(own.indexOf('<style')), /animation|transition/);
	const base = sources.find((s) => s.file.endsWith('base.css'))!.text;
	for (const m of base.matchAll(/(\.dt-menu[^{]*)\{([^}]*)\}/g)) assert.doesNotMatch(m[2]!, /animation|transition/, `${m[1]!.trim()} animates`);
});
