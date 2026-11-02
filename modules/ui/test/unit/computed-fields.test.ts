// The computed fields every record has — module, modified by, created by — offered wherever a field
// is, never shown by default (operator 2026-10-29: "should be able to add custom fields like source,
// author etc to list views and all relevant places").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATED_BY_FIELD, MODIFIED_BY_FIELD, computedFieldRows, isComputedField } from '../../src/lib/computed-fields';
import * as computedFields from '../../src/lib/computed-fields';
import type { FieldRow } from '../../src/api/types';

test('three read-only fields, titled, kept off the form and the record page', () => {
	const rows = computedFieldRows('tasks');
	assert.deepEqual(rows.map((r) => [r.field, r.title]), [['$module', 'Module'], [MODIFIED_BY_FIELD, 'Modified by'], [CREATED_BY_FIELD, 'Created by']]);
	for (const r of rows) {
		assert.equal(r.collection, 'tasks');
		assert.equal(r.editable, false, `${r.field} is never written`);
		assert.deepEqual(r.hidden, ['form', 'record']);
	}
	assert.ok(isComputedField(MODIFIED_BY_FIELD));
	assert.equal(isComputedField('name'), false);
});

test('no computed field carries "(computed)" in its title — it is told apart by being drawn dimmed (operator 2026-10-30)', () => {
	for (const r of computedFieldRows('tasks')) assert.doesNotMatch(String(r.title), /\(computed\)/);
	assert.equal('distinctTitles' in computedFields, false, 'the suffixing helper is gone, so nothing can re-add the label');
});
