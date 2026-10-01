// The numbered-list parser, on the shapes a hand-written decision log actually holds: a row on one
// line, a row whose bold heading wraps, a row whose heading fits but whose reasoning runs on, and the
// prose around the list that must stay out of it.
import { test } from 'node:test';
import assert from 'node:assert';
import { numberedListItems } from '../../skills/running-retrospectives/lib/markdown.mjs';

test('a single-line item is its own content, marker stripped', () => {
	const items = numberedListItems('1. **2026-08-16 — the first.** Because so.\n');
	assert.equal(items.length, 1);
	assert.equal(items[0].number, 1);
	assert.equal(items[0].line, 1);
	assert.equal(items[0].content, '**2026-08-16 — the first.** Because so.');
	assert.equal(items[0].raw, '1. **2026-08-16 — the first.** Because so.');
});

test('a heading that wraps across lines is rejoined before anything matches it', () => {
	const items = numberedListItems([
		'2. **2026-08-17 — a title long enough that the bold header does not',
		'   fit on one line.** And the reasoning after it.',
	].join('\n'));
	assert.equal(items.length, 1);
	assert.equal(
		items[0].content,
		'**2026-08-17 — a title long enough that the bold header does not fit on one line.** And the reasoning after it.',
	);
	assert.match(items[0].raw, /\n/, 'the block is kept verbatim, newlines and all');
});

test('continuation text is carried however many lines it takes', () => {
	const items = numberedListItems([
		'1. **2026-08-16 — short heading.** first line of reasoning,',
		'   second line,',
		'   third line.',
	].join('\n'));
	assert.equal(items.length, 1);
	assert.equal(items[0].content, '**2026-08-16 — short heading.** first line of reasoning, second line, third line.');
});

test('an unindented wrapped line still belongs to the item it continues', () => {
	const items = numberedListItems([
		'1. **2026-08-16 — a heading that wraps',
		'without any indentation at all.** and its reasoning.',
	].join('\n'));
	assert.equal(items.length, 1);
	assert.equal(items[0].content, '**2026-08-16 — a heading that wraps without any indentation at all.** and its reasoning.');
});

test('items are cut at the next marker, at any width of number', () => {
	const items = numberedListItems([
		'9. **nine** the ninth,',
		'   wrapped.',
		'10. **ten** the tenth.',
		'11. **eleven** the eleventh.',
	].join('\n'));
	assert.deepEqual(items.map((i) => i.number), [9, 10, 11]);
	assert.equal(items[0].content, '**nine** the ninth, wrapped.');
	assert.equal(items[1].content, '**ten** the tenth.');
});

test('the marker’s own digits are the number, not the ordinal', () => {
	const items = numberedListItems('7. seven\n7. seven again\n12. twelve\n');
	assert.deepEqual(items.map((i) => i.number), [7, 7, 12]);
});

test('prose around the list, and a heading after it, stay out', () => {
	const items = numberedListItems([
		'# DECISION-LOG',
		'',
		'One row per decision. The log wins over any older note.',
		'',
		'1. **one** the first.',
		'2. **two** the second.',
		'',
		'## after',
		'',
		'a closing paragraph.',
	].join('\n'));
	assert.deepEqual(items.map((i) => i.number), [1, 2]);
	assert.equal(items[1].content, '**two** the second.');
});

test('a heading directly under an item interrupts it rather than joining it', () => {
	const items = numberedListItems(['1. **one** the first.', '## after', 'a paragraph.'].join('\n'));
	assert.equal(items.length, 1);
	assert.equal(items[0].content, '**one** the first.');
});

test('a blank line inside an item is a paragraph break, not the end of it', () => {
	const items = numberedListItems([
		'1. **one** the first.',
		'',
		'   a second paragraph of the same row.',
		'',
		'2. **two** the second.',
	].join('\n'));
	assert.deepEqual(items.map((i) => i.number), [1, 2]);
	assert.equal(items[0].content, '**one** the first. a second paragraph of the same row.');
	assert.match(items[0].raw, /a second paragraph/);
});

test('a deeper marker is a nested list, which is content', () => {
	const items = numberedListItems([
		'1. **one** the first, which lists:',
		'   1. a sub-point',
		'   2. another',
		'2. **two** the second.',
	].join('\n'));
	assert.deepEqual(items.map((i) => i.number), [1, 2]);
	assert.equal(items[0].content, '**one** the first, which lists: 1. a sub-point 2. another');
});

test('no list, empty input and nullish input are all no items', () => {
	assert.deepEqual(numberedListItems('just a paragraph.\n'), []);
	assert.deepEqual(numberedListItems(''), []);
	assert.deepEqual(numberedListItems(undefined), []);
});
