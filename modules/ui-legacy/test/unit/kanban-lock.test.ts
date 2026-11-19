/**
 * `kanbanLock` — the one answer to "may this board move a card to another column, may it offer the column
 * `+`, and what does a card say when it may not" (cr-vscode-009). Pure, so every case of the form's own rule
 * (`hasControl`) is pinned here without a renderer; `test/webview/kanban-locked.test.ts` proves the board
 * consumes it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { kanbanLock } from '../../src/lib/kanban-lock';
import { enumRow } from './field-rows';

const field = (overrides: Parameters<typeof enumRow>[2] = {}) => enumRow('stage', ['draft', 'review', 'live'], overrides);

test('an editable column field locks nothing and says nothing', () => {
	assert.deepEqual(kanbanLock(field(), { reorder: false }), { columns: false, add: true, reason: null });
	assert.deepEqual(kanbanLock(field(), { reorder: true }), { columns: false, add: true, reason: null });
});

test('editable: false locks the columns and the +, and the reason names the field', () => {
	const lock = kanbanLock(field({ editable: false }), { reorder: false });
	assert.equal(lock.columns, true);
	assert.equal(lock.add, false);
	assert.equal(lock.reason, 'Stage is not editable here, so this card cannot be moved to another column.');
});

test('with manual ordering on, the reason says the card reorders within its column', () => {
	const lock = kanbanLock(field({ editable: false }), { reorder: true });
	assert.equal(lock.columns, true);
	assert.equal(lock.reason, 'Stage is not editable here — this card can be reordered within its column, not moved to another.');
});

test("editable: 'create' locks the columns but keeps the + (a create is where the field is set)", () => {
	const lock = kanbanLock(field({ editable: 'create' }), { reorder: false });
	assert.equal(lock.columns, true);
	assert.equal(lock.add, true);
	assert.match(lock.reason ?? '', /^Stage is not editable here/);
});

for (const kind of ['derived', 'virtual', 'mirror'] as const) {
	test(`an engine-held ${kind} field locks the columns and the +, whatever its editable says`, () => {
		const lock = kanbanLock(field({ kind, editable: true }), { reorder: false });
		assert.equal(lock.columns, true);
		assert.equal(lock.add, false);
		assert.match(lock.reason ?? '', /not editable here/);
	});
}

test('no column field: nothing to lock', () => {
	assert.deepEqual(kanbanLock(null, { reorder: false }), { columns: false, add: true, reason: null });
});

test('an empty title falls back to the field name', () => {
	const lock = kanbanLock(field({ editable: false, title: '' }), { reorder: false });
	assert.match(lock.reason ?? '', /^stage is not editable here/);
});
