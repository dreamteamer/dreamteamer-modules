// Where a toolbar menu opens (lib/menu-place.ts, the nav toolbar of cr-dt-008's 2026-11-14 revision): under its
// button, by its start or end edge, and always inside the window — a 320 px desktop pane has a ~102 px nav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuUnder, rectOf, viewportWidth } from '../../src/lib/menu-place';

test('start: the menu\'s left edge on the button\'s, 2 px under it', () => {
	assert.deepEqual(menuUnder({ left: 40, right: 64, bottom: 28 }, 'start', 220, 1200), { x: 40, y: 30 });
});

test('end: the menu\'s right edge on the button\'s', () => {
	assert.deepEqual(menuUnder({ left: 232, right: 256, bottom: 28 }, 'end', 220, 1200), { x: 36, y: 30 });
});

test('never off the left edge: an end menu from the right of a 102 px nav opens at the 4 px inset', () => {
	assert.deepEqual(menuUnder({ left: 76, right: 100, bottom: 28 }, 'end', 220, 320), { x: 4, y: 30 });
});

test('never off the right edge: a start menu near the window\'s end is pulled back inside', () => {
	assert.deepEqual(menuUnder({ left: 250, right: 274, bottom: 28 }, 'start', 220, 320), { x: 96, y: 30 });
});

test('a window narrower than the menu keeps the left inset', () => {
	assert.deepEqual(menuUnder({ left: 10, right: 30, bottom: 20 }, 'start', 220, 200), { x: 4, y: 22 });
});

test('no window width (a test tier) clamps only at the left; no rect opens at the top left', () => {
	assert.deepEqual(menuUnder({ left: 900, right: 924, bottom: 28 }, 'start', 220), { x: 900, y: 30 });
	assert.deepEqual(menuUnder(null, 'end', 220, 1200), { x: 4, y: 2 });
});

test('rectOf reads an element\'s rect, or null; viewportWidth reads the window, or undefined', () => {
	assert.equal(rectOf(null), null);
	assert.equal(rectOf({}), null);
	assert.deepEqual(rectOf({ getBoundingClientRect: () => ({ left: 1, right: 2, bottom: 3 }) }), { left: 1, right: 2, bottom: 3 });
	const g = globalThis as { window?: unknown };
	const had = g.window;
	g.window = { innerWidth: 320 };
	assert.equal(viewportWidth(), 320);
	g.window = {};
	assert.equal(viewportWidth(), undefined);
	g.window = had;
});

// ---- placeMenu: the one menu (DtMenu) against the box it hangs from — fixed, flipped, clamped -------------------------

import { placeMenu } from '../../src/lib/menu-place';

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 150 };

test('placeMenu: under the box by the gap, on its start or end edge', () => {
	const box = { left: 400, right: 440, top: 100, bottom: 126 };
	assert.deepEqual(placeMenu(box, SIZE, VIEW, 'start'), { left: 400, top: 132, flipped: false });
	assert.deepEqual(placeMenu(box, SIZE, VIEW, 'end'), { left: 240, top: 132, flipped: false });
});

test('placeMenu: flips above the box when there is no room below and there is above', () => {
	const box = { left: 400, right: 440, top: 700, bottom: 726 };
	assert.deepEqual(placeMenu(box, SIZE, VIEW, 'end'), { left: 240, top: 544, flipped: true });
	// no room either way (a short window): as low as fits, never above the top edge
	assert.deepEqual(placeMenu({ left: 10, right: 50, top: 60, bottom: 80 }, { width: 100, height: 150 }, { width: 1000, height: 180 }), { left: 10, top: 26, flipped: false });
});

test('placeMenu: stays inside the window horizontally, 4 px from either edge', () => {
	assert.equal(placeMenu({ left: 950, right: 990, top: 10, bottom: 30 }, SIZE, VIEW, 'start').left, 1000 - 200 - 4, 'off the right edge');
	assert.equal(placeMenu({ left: 2, right: 40, top: 10, bottom: 30 }, SIZE, VIEW, 'end').left, 4, 'off the left edge');
	assert.equal(placeMenu({ left: 0, right: 30, top: 10, bottom: 30 }, { width: 400, height: 100 }, { width: 300, height: 800 }, 'start').left, 4, 'wider than the window: its start stays on screen');
});
