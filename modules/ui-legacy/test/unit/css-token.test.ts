// A token where CSS cannot reach (an SVG attribute, a Leaflet option): `var(--x)` read off the document, a fallback
// chain followed, anything else passed through, and currentColor when there is nothing to read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveColor } from '../../src/lib/css-token';

test('resolveColor reads a var off the document, follows its fallback, and passes other values through', () => {
	const g = globalThis as { document?: unknown; getComputedStyle?: unknown };
	const before = { d: g.document, s: g.getComputedStyle };
	const values: Record<string, string> = { '--dt-map-marker': ' #6644ec ' };
	g.document = { documentElement: {} };
	g.getComputedStyle = () => ({ getPropertyValue: (n: string) => values[n] ?? '' });
	try {
		assert.equal(resolveColor('var(--dt-map-marker)'), '#6644ec');
		assert.equal(resolveColor('var(--dt-missing, var(--dt-map-marker))'), '#6644ec');
		assert.equal(resolveColor('var(--dt-missing)'), 'currentColor');
		assert.equal(resolveColor('rgb(1 2 3)'), 'rgb(1 2 3)');
		assert.equal(resolveColor(undefined), 'currentColor');
	} finally {
		g.document = before.d;
		g.getComputedStyle = before.s;
	}
	assert.equal(resolveColor('var(--dt-map-marker)'), 'currentColor', 'no document: currentColor');
});
