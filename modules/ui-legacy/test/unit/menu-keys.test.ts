// The one menu keyboard (lib/menu-keys.ts, DtMenu.vue): arrows and Tab wrap, Home/End go to the ends, a menu with no
// items keeps focus on itself, and type-ahead finds the next label by its first letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuMove, typeahead, typeaheadIndex, typedChar, TYPEAHEAD_MS } from '../../src/lib/menu-keys';

test('arrows and Tab move and wrap; Home and End go to the ends; other keys are not moves', () => {
	assert.equal(menuMove('ArrowDown', -1, 3), 0, 'nothing focused: down enters at the top');
	assert.equal(menuMove('ArrowUp', -1, 3), 2, 'nothing focused: up enters at the bottom');
	assert.equal(menuMove('ArrowDown', 2, 3), 0, 'wraps forward');
	assert.equal(menuMove('ArrowUp', 0, 3), 2, 'wraps back');
	assert.equal(menuMove('Tab', 1, 3), 2);
	assert.equal(menuMove('Tab', 0, 3, true), 2, 'Shift+Tab wraps back');
	assert.equal(menuMove('Home', 2, 3), 0);
	assert.equal(menuMove('End', 0, 3), 2);
	assert.equal(menuMove('ArrowDown', -1, 0), -1, 'no items: the menu keeps focus');
	assert.equal(menuMove('Enter', 0, 3), null);
	assert.equal(menuMove('a', 0, 3), null);
});

test('type-ahead: a printable key with no modifier, the next label that starts with the word, a repeated letter walks', () => {
	assert.equal(typedChar({ key: 'D' }), 'd');
	assert.equal(typedChar({ key: 'd', metaKey: true }), null);
	assert.equal(typedChar({ key: ' ' }), null, 'Space is the item\'s own click');
	assert.equal(typedChar({ key: 'ArrowDown' }), null);
	const labels = ['Edit field', 'Hide field', 'Delete field', 'Duplicate'];
	assert.equal(typeaheadIndex(labels, 'd', -1), 2);
	assert.equal(typeaheadIndex(labels, 'd', 2), 3, 'the same letter again moves to the next match');
	assert.equal(typeaheadIndex(labels, 'dd', 3), 2, 'a repeated letter keeps walking, wrapping');
	assert.equal(typeaheadIndex(labels, 'du', 2), 3, 'a longer word narrows');
	assert.equal(typeaheadIndex(labels, 'del', 2), 2, 'a longer word may stay on the current item');
	assert.equal(typeaheadIndex(labels, 'z', 0), -1);
});

test('the type-ahead word grows within the pause and starts again after it', () => {
	let t = 1000;
	const push = typeahead(() => t);
	assert.equal(push('d'), 'd');
	t += 100;
	assert.equal(push('e'), 'de');
	t += TYPEAHEAD_MS + 1;
	assert.equal(push('h'), 'h');
});
