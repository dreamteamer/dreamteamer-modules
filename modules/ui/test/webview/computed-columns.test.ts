/**
 * The computed fields (module, modified by, created by) are there to be ADDED to a list — never a
 * default column, however few fields the collection has (operator 2026-10-29). Here, not in tier 1,
 * because `browse-state` reaches the webview transport, which this tier stubs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultColumns } from '../../src/composables/browse-state';
import { computedFieldRows } from '../../src/lib/computed-fields';
import type { FieldRow } from '../../src/api/types';

test('a computed field is never a default column', () => {
	const name = { collection: 'tasks', field: 'name', type: 'string', title: 'Name' } as FieldRow;
	assert.deepEqual(defaultColumns([name, ...computedFieldRows('tasks')]).map((f) => f.field), ['name']);
});
