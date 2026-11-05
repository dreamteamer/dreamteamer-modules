/**
 * Where the record page's hover card goes (cr-vscode-013): below the trigger, above it when the card
 * would cross the bottom and there is more room above, never outside the viewport — `top` and `left`
 * are both clamped, so the explanation's first line is always on screen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hoverPlace } from '../../src/lib/hover-place';

const VIEW = { width: 1000, height: 800 };
const rect = (top: number, left = 100, height = 28, width = 160) => ({ top, bottom: top + height, left, right: left + width });

describe('hoverPlace', () => {
	it('opens below the trigger, left-aligned, 4 px under it', () => {
		assert.deepEqual(hoverPlace(rect(100), { width: 360, height: 120 }, VIEW), { top: 132, left: 100, above: false });
	});

	it('opens above near the bottom edge, when the room above is larger', () => {
		assert.deepEqual(hoverPlace(rect(700), { width: 360, height: 120 }, VIEW), { top: 576, left: 100, above: true });
	});

	it('stays below when it does not fit there but the room above is smaller still', () => {
		const p = hoverPlace(rect(300), { width: 360, height: 700 }, VIEW);
		assert.equal(p.above, false);
	});

	it('is clamped at the right edge', () => {
		assert.equal(hoverPlace(rect(100, 900), { width: 360, height: 120 }, VIEW).left, 1000 - 360 - 4);
	});

	it('is clamped at the left edge', () => {
		assert.equal(hoverPlace(rect(100, -50), { width: 360, height: 120 }, VIEW).left, 4);
	});

	it('a card wider than the viewport sits at 4', () => {
		assert.equal(hoverPlace(rect(100, 50), { width: 360, height: 120 }, { width: 300, height: 800 }).left, 4);
	});

	it('a short pane: above is chosen and clamped to 4, never a negative top (the plan review case)', () => {
		const p = hoverPlace({ top: 200, bottom: 228, left: 10, right: 170 }, { width: 360, height: 220 }, { width: 800, height: 300 });
		assert.deepEqual(p, { top: 4, left: 10, above: true });
	});

	it('a card taller than the viewport starts at 4', () => {
		assert.equal(hoverPlace(rect(100), { width: 360, height: 900 }, VIEW).top, 4);
	});
});
