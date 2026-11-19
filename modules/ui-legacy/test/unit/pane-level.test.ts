// Tier 1 — cr-modules-017 task 15: the level chip's words. The page can only LOWER its level; a raise is the chat's
// (dt web open --edit|--admin), and while one is in force the bar says since when.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelWord, lowerChoices, raiseNotice } from '../../src/lib/pane-level';

test('levelWord names each level with a capital', () => {
	assert.equal(levelWord('read'), 'Read');
	assert.equal(levelWord('edit'), 'Edit');
	assert.equal(levelWord('admin'), 'Admin');
});

test('lowerChoices offers only the levels below — never a raise', () => {
	assert.deepEqual(lowerChoices('admin'), ['edit', 'read']);
	assert.deepEqual(lowerChoices('edit'), ['read']);
	assert.deepEqual(lowerChoices('read'), []);
});

test('raiseNotice says since when the raised level holds, and nothing with no raise', () => {
	const at = new Date(2026, 10, 14, 2, 41).toISOString();
	assert.equal(raiseNotice({ level: 'admin', raisedAt: at }, 'en-GB'), 'Admin since 02:41 — opened from the chat');
	assert.equal(raiseNotice({ level: 'edit', raisedAt: at }, 'en-GB'), 'Edit since 02:41 — opened from the chat');
	assert.equal(raiseNotice({ level: 'admin' }), null);
	assert.equal(raiseNotice({ level: 'edit', raisedAt: 'not a date' }), null);
});
