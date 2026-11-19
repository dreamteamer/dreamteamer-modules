// Held-out h5 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h5) — written by the plan
// review, never read by the builder. Tier 1: `cardPlace` at its edges — exactly fits on the left, one pixel
// short on the left, exactly fits on the right, one pixel short on the right, and a viewport narrower than
// the card's 280 px cap (the caller then passes viewportWidth − 8 as the card's width): `below`, the card's
// viewport x clamped to 4. In every `below` case the card sits under the menu and inside the viewport.
// Run: npm test -- --only=held-out-new-record-menu-h5
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardPlace } from '../../src/lib/sources';

const belowInside = (menu: { left: number; right: number; height: number }, w: number, vw: number, p: ReturnType<typeof cardPlace>, why: string) => {
	assert.equal(p.side, 'below', why);
	assert.equal(p.top, menu.height + 4, `${why}: under the menu, covering none of its rows`);
	assert.equal(typeof p.left, 'number', `${why}: a below card says where it goes`);
	const x = menu.left + p.left!;
	assert.ok(x >= 4 && x <= vw - w - 4, `${why}: card x ${x} inside [4, ${vw - w - 4}]`);
};

test('h5: exactly fits on the left — left, at the row', () => {
	// menu.left − 4 − w === 4
	const p = cardPlace({ left: 288, right: 568, height: 100 }, 20, 280, 1000);
	assert.equal(p.side, 'left');
	assert.equal(p.top, 20);
});

test('h5: one pixel short on the left, room on the right — right, at the row', () => {
	const p = cardPlace({ left: 287, right: 567, height: 100 }, 44, 280, 1000);
	assert.equal(p.side, 'right');
	assert.equal(p.top, 44);
});

test('h5: exactly fits on the right (and not on the left) — right', () => {
	// menu.right + 4 + w === viewportWidth − 4
	const p = cardPlace({ left: 100, right: 380, height: 100 }, 12, 280, 668);
	assert.equal(p.side, 'right');
	assert.equal(p.top, 12);
});

test('h5: one pixel short on both sides — below, inside the viewport', () => {
	const menu = { left: 100, right: 380, height: 100 };
	belowInside(menu, 280, 667, cardPlace(menu, 12, 280, 667), 'short by one on the right');
});

test('h5: a viewport narrower than the card cap — below, its x clamped to 4', () => {
	const vw = 200;
	const w = vw - 8; // the card's width when the viewport is narrower than 280 + 8
	const menu = { left: 30, right: 190, height: 90 };
	const p = cardPlace(menu, 40, w, vw);
	belowInside(menu, w, vw, p, 'narrow viewport');
	assert.equal(p.left, 4 - menu.left, 'the only x that fits is 4');
	const p2 = cardPlace({ left: 8, right: 192, height: 60 }, 0, w, vw);
	belowInside({ left: 8, right: 192, height: 60 }, w, vw, p2, 'narrow viewport, menu at the left edge');
	assert.equal(p2.left, 4 - 8);
});
