// The Schema tab narrowed to one module — the module a nav click opened it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleScopeFilter, nextModuleScope, withModuleScope } from '../../src/lib/module-scope';

test('the scope is one ordinary filter on $module, and rides on the path as ?module=', () => {
	assert.deepEqual(moduleScopeFilter('project-alpha'), { $module: { _eq: 'project-alpha' } });
	assert.equal(withModuleScope('/settings/schema/agents', 'project-alpha'), '/settings/schema/agents?module=project-alpha');
	assert.equal(withModuleScope('/settings/schema/agents', undefined), '/settings/schema/agents');
});

test('sticky inside the tab: named by the route, kept on a record page, ended on a list or the root without it', () => {
	assert.equal(nextModuleScope(undefined, 'project-alpha', true), 'project-alpha', 'the nav click');
	assert.equal(nextModuleScope('project-alpha', undefined, true), 'project-alpha', 'a row opened from the narrowed list');
	assert.equal(nextModuleScope('project-alpha', undefined, false), undefined, 'the banner ✕, the gear');
	assert.equal(nextModuleScope('project-alpha', 'org', false), 'org', 'another module clicked in the nav');
	assert.equal(nextModuleScope(undefined, ['org'], false), 'org');
});
