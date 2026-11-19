// Tier 1 — cr-modules-017 task 16: the place a page reports. Four shapes only — { collection }, { collection, id },
// { uiView }, { other: true } — and a namespaced collection keeps its slash (the longest registered prefix wins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOf, splitRef } from '../../src/lib/pane-place';

const COLLECTIONS = ['tasks', 'rnd/change-requests', 'rnd', 'meetings'];
const content = (path: string) => ({ name: 'content', params: { path } });

test('a collection list is { collection }', () => {
	assert.deepEqual(placeOf(content('tasks'), COLLECTIONS), { collection: 'tasks' });
	assert.deepEqual(placeOf(content('tasks/'), COLLECTIONS), { collection: 'tasks' });
});

test('a record is { collection, id }, the id keeping its own slashes', () => {
	assert.deepEqual(placeOf(content('tasks/call-the-bank'), COLLECTIONS), { collection: 'tasks', id: 'call-the-bank' });
	assert.deepEqual(placeOf(content('meetings/2026/11/standup'), COLLECTIONS), { collection: 'meetings', id: '2026/11/standup' });
});

test('a namespaced collection keeps its slash: the longest registered prefix wins', () => {
	assert.deepEqual(placeOf(content('rnd/change-requests'), COLLECTIONS), { collection: 'rnd/change-requests' });
	assert.deepEqual(placeOf(content('rnd/change-requests/cr-x'), COLLECTIONS), { collection: 'rnd/change-requests', id: 'cr-x' });
	assert.deepEqual(placeOf({ name: 'content', params: { path: ['rnd', 'change-requests', 'cr-x'] } }, COLLECTIONS), { collection: 'rnd/change-requests', id: 'cr-x' });
});

test('the create page is the collection; an unknown collection is other', () => {
	assert.deepEqual(placeOf(content('tasks/+'), COLLECTIONS), { collection: 'tasks' });
	assert.deepEqual(placeOf(content('nope/x'), COLLECTIONS), { other: true });
});

test('a ui-view route is { uiView }', () => {
	assert.deepEqual(placeOf({ name: 'ui-view:tasks-board', params: {} }, COLLECTIONS), { uiView: 'tasks-board' });
	assert.deepEqual(placeOf({ name: 'ui-view:inbox', params: { id: 'x' } }, COLLECTIONS), { uiView: 'inbox' });
});

test('a module app route, home and anything else is { other: true }', () => {
	assert.deepEqual(placeOf({ name: 'module-app:x', params: {} }, COLLECTIONS), { other: true });
	assert.deepEqual(placeOf({ name: undefined, params: {} }, COLLECTIONS), { other: true });
	assert.deepEqual(placeOf({ name: 'content', params: { path: '' } }, COLLECTIONS), { other: true });
	assert.deepEqual(placeOf({ name: Symbol('x'), params: {} }, COLLECTIONS), { other: true });
});

test('splitRef splits a reference at the end of the longest registered collection', () => {
	assert.deepEqual(splitRef('rnd/change-requests/cr-x', COLLECTIONS), { collection: 'rnd/change-requests', id: 'cr-x' });
	assert.deepEqual(splitRef('tasks/a/b', COLLECTIONS), { collection: 'tasks', id: 'a/b' });
	assert.equal(splitRef('nope/a', COLLECTIONS), null);
	assert.equal(splitRef('tasks', COLLECTIONS), null);
});
