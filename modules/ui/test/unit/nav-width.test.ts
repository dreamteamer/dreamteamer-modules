// The browser shell's nav width: kept inside its bounds, moved by the arrow keys (mirrored right to left), Home/End to
// the bounds, a drag measured from where it started — and kept per browser, with storage that may be off or broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_WIDTH_FALLBACK as B, NAV_WIDTH_STEP, clampWidth, dragWidth, keyWidth, loadNavWidth, navWidthBounds, saveNavWidth } from '../../src/lib/nav-width';

const memory = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test('a width is clamped to the bounds and rounded; nonsense is the default', () => {
	assert.equal(clampWidth(10, B), B.min);
	assert.equal(clampWidth(9999, B), B.max);
	assert.equal(clampWidth(300.6, B), 301);
	assert.equal(clampWidth(Number.NaN, B), B.def);
});

test('the arrow keys step it, Shift steps four times, Home and End go to the bounds, other keys are not its own', () => {
	assert.equal(keyWidth(260, 'ArrowRight', B), 260 + NAV_WIDTH_STEP);
	assert.equal(keyWidth(260, 'ArrowLeft', B), 260 - NAV_WIDTH_STEP);
	assert.equal(keyWidth(260, 'ArrowRight', B, { shift: true }), 260 + 4 * NAV_WIDTH_STEP);
	assert.equal(keyWidth(B.max - 2, 'ArrowRight', B), B.max, 'never past the maximum');
	assert.equal(keyWidth(260, 'Home', B), B.min);
	assert.equal(keyWidth(260, 'End', B), B.max);
	assert.equal(keyWidth(260, 'Enter', B), null);
	assert.equal(keyWidth(260, 'ArrowLeft', B, { dir: 'rtl' }), 260 + NAV_WIDTH_STEP, 'right to left, the moving edge is the left one');
});

test('a drag adds how far the pointer moved since it started, mirrored right to left', () => {
	assert.equal(dragWidth(260, 100, 150, B), 310);
	assert.equal(dragWidth(260, 100, 150, B, 'rtl'), 210);
	assert.equal(dragWidth(260, 100, -900, B), B.min);
});

test('the width round-trips through storage; a reset forgets it; broken or absent storage is no width', () => {
	const s = memory();
	assert.equal(loadNavWidth(B, s), null);
	saveNavWidth(312, s);
	assert.equal(loadNavWidth(B, s), 312);
	saveNavWidth(null, s);
	assert.equal(loadNavWidth(B, s), null);
	s.setItem('dt.nav.width.v1', 'wide');
	assert.equal(loadNavWidth(B, s), null);
	s.setItem('dt.nav.width.v1', '9000');
	assert.equal(loadNavWidth(B, s), B.max, 'a kept width outside today\'s bounds comes back inside them');
	const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
	assert.equal(loadNavWidth(B, throwing), null);
	assert.doesNotThrow(() => saveNavWidth(300, throwing));
	assert.equal(loadNavWidth(B, null), null);
});

test('the bounds come from the tokens, with the fallback where there is no computed style', () => {
	assert.deepEqual(navWidthBounds(null), B);
	const g = globalThis as { getComputedStyle?: unknown };
	const before = g.getComputedStyle;
	g.getComputedStyle = () => ({ getPropertyValue: (n: string) => ({ '--dt-nav-width-min': ' 200px', '--dt-nav-width-max': '400px', '--dt-nav-width': '240px' } as Record<string, string>)[n] ?? '' });
	try {
		assert.deepEqual(navWidthBounds({} as Element), { min: 200, max: 400, def: 240 });
	} finally {
		g.getComputedStyle = before;
	}
});

test('the fallback agrees with tokens.css', async () => {
	const fs = await import('node:fs');
	const css = fs.readFileSync(new URL('../../src/styles/tokens.css', import.meta.url).pathname.replace('/.test-build/unit', ''), 'utf8');
	const val = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(css)?.[1]);
	assert.deepEqual({ min: val('--dt-nav-width-min'), max: val('--dt-nav-width-max'), def: val('--dt-nav-width') }, B);
});
