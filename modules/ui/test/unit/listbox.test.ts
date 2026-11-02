// Tier 1 — the searchable dropdown's logic. Wrap-around, what search matches, and where the panel
// goes are all easy to get subtly wrong and impossible to notice by reading, so they are run here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	SEARCH_THRESHOLD, filterChoices, indexOfValue, moveActive, placePanel, sameValue, type Choice,
} from '../../src/lib/listbox';

const choices: Choice[] = [
	{ text: 'High', value: 'high' },
	{ text: 'Low', value: 'low' },
	{ text: 'Borderline High', value: 'borderline-high' },
	{ text: 'Ada Lovelace', value: 'people/ada', hint: 'people' },
];

describe('filterChoices', () => {
	test('an empty query returns everything', () => {
		assert.equal(filterChoices(choices, '  ').length, choices.length);
	});

	test('matching is case-insensitive', () => {
		assert.deepEqual(filterChoices(choices, 'HIGH').map((c) => c.value), ['high', 'borderline-high']);
	});

	test('every term must hit — "bor hig" finds Borderline High only', () => {
		assert.deepEqual(filterChoices(choices, 'bor hig').map((c) => c.value), ['borderline-high']);
	});

	test('the hint and the raw value are searchable too', () => {
		assert.deepEqual(filterChoices(choices, 'people').map((c) => c.value), ['people/ada']);
	});

	// Same posture as the field tree: a dropdown that guesses commits a value you did not mean.
	test('a near-miss finds nothing rather than guessing', () => {
		assert.deepEqual(filterChoices(choices, 'hgih'), []);
	});
});

describe('moveActive — a dropdown is a ring', () => {
	test('down from nothing enters at the first item', () => assert.equal(moveActive(-1, 1, 4), 0));
	test('up from nothing enters at the LAST item', () => assert.equal(moveActive(-1, -1, 4), 3));
	test('down wraps past the end', () => assert.equal(moveActive(3, 1, 4), 0));
	test('up wraps past the start', () => assert.equal(moveActive(0, -1, 4), 3));
	test('an empty list has no active index to move to', () => assert.equal(moveActive(0, 1, 0), -1));
});

describe('sameValue', () => {
	// ⚠ A <select>'s value is ALWAYS a string, so a numeric enum came back as "3" and stopped
	// matching the choice whose value is 3 — the control showed a placeholder over a real value.
	test('a number and its string spelling are the same choice', () => {
		assert.equal(sameValue(3, '3'), true);
		assert.equal(sameValue('3', 3), true);
	});

	test('true and "true" are the same choice', () => assert.equal(sameValue(true, 'true'), true));

	test('null is never equal to a value, and objects never coerce', () => {
		assert.equal(sameValue(null, ''), false);
		assert.equal(sameValue(undefined, ''), false);
		assert.equal(sameValue({}, '[object Object]'), false);
	});

	test('indexOfValue finds a numerically-spelled value', () => {
		assert.equal(indexOfValue([{ text: 'Three', value: 3 }], '3'), 0);
		assert.equal(indexOfValue(choices, 'nope'), -1);
	});
});

describe('placePanel', () => {
	const viewport = { width: 1000, height: 800 };
	const anchor = (top: number, height = 24, left = 100, width = 200) =>
		({ top, bottom: top + height, left, width });

	test('opens BELOW when there is room', () => {
		const p = placePanel(anchor(100), viewport, 320);
		assert.equal(p.flipped, false);
		assert.equal(p.top, 128); // 100 + 24 + 4 gap
		assert.equal(p.maxHeight, 320);
	});

	test('flips UP when below cannot hold it and above is roomier', () => {
		const p = placePanel(anchor(700), viewport, 320);
		assert.equal(p.flipped, true);
		assert.ok(p.top < 700, 'sits above the control');
	});

	// ⚠ Flip only when above is genuinely BETTER. A control near the middle of a tall page has less
	// room below than the panel wants and more above — but flipping there is jarring for no gain.
	test('does not flip merely because below is smaller than desired', () => {
		// below = 800-124-4-8 = 664; above = 100-4-8 = 88. Desired 700: below is short, above worse.
		const p = placePanel(anchor(100), viewport, 700);
		assert.equal(p.flipped, false);
		assert.equal(p.maxHeight, 664, 'shrinks to fit rather than flipping into a worse spot');
	});

	test('never shrinks below a usable height', () => {
		const p = placePanel(anchor(780, 20), viewport, 320);
		assert.ok(p.maxHeight >= 120, `got ${p.maxHeight}`);
	});

	test('is kept on screen at the right edge', () => {
		const p = placePanel(anchor(100, 24, 900, 200), viewport, 320);
		assert.ok(p.left + p.width <= viewport.width, `${p.left}+${p.width} > ${viewport.width}`);
	});

	test('is kept on screen at the left edge', () => {
		const p = placePanel(anchor(100, 24, -50, 200), viewport, 320);
		assert.ok(p.left >= 0, `got ${p.left}`);
	});

	test('is at least as wide as its control', () => {
		assert.equal(placePanel(anchor(100, 24, 100, 260), viewport, 320).width, 260);
	});

	test('honours a minimum width for a narrow control', () => {
		assert.equal(placePanel(anchor(100, 24, 100, 60), viewport, 320, { minWidth: 220 }).width, 220);
	});
});

describe('SEARCH_THRESHOLD', () => {
	test('is stated, not scattered', () => assert.equal(SEARCH_THRESHOLD, 7));
});
