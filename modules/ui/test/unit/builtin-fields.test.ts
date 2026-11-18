// The engine's built-in fields under the engine's own names (cr-vscode-011). `last_modified` is the
// injected field a view may name; `last-modified` is the host's v1 ROW key, a wire key only. The
// translation turns that one legacy key into the field name and touches nothing else — not `created`,
// not `id`, and not the computed `$last-modified-by`, which merely contains the same letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineFieldName, engineSort } from '../../src/lib/builtin-fields';

test('engineFieldName turns the legacy wire key into the field, and only that', () => {
	assert.equal(engineFieldName('last-modified'), 'last_modified');
	for (const same of ['last_modified', 'created', 'id', 'name', '', '$last-modified-by', '$created-by', '$module', '$source', '-last-modified', 'last-modified-at'])
		assert.equal(engineFieldName(same), same, same);
});

test('engineSort keeps the direction and translates the name after it', () => {
	assert.equal(engineSort('last-modified'), 'last_modified');
	assert.equal(engineSort('-last-modified'), '-last_modified');
	for (const same of ['last_modified', '-last_modified', 'created', '-created', 'id', 'name', '-name', '', '-$last-modified-by'])
		assert.equal(engineSort(same), same, same);
});
