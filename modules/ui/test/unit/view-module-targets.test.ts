// Tier 1 — where a view can land, as data (cr-vscode-010). The Save as… form and a ui-view's record page
// pick the module in ONE dropdown: the targets carry what both need (the module's id on every row, its
// path, whether it is linked, which row is the workspace's), and the pure helpers decide what a choice
// reads, what its hover and the line under the control say, and the one sentence for the npm-installed
// modules. Synthetic manifest only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LOCKED_REASON, lockedNote, moduleChoices, recordPageTargets, viewModuleTargets, whereOf, type ViewModuleTarget,
} from '../../src/lib/view-module-targets';

const inline = (id: string) => ({ id, title: id, location: 'modules', path: `modules/${id}` });
const linked = (id: string) => ({ id, title: id, location: 'git_modules', path: `git_modules/northwind-modules/modules/${id}` });
const npm = (id: string) => ({ id, title: id, location: 'node_modules', path: `node_modules/@harbor/${id}` });

const LINKED = ['claims', 'claims-archive', 'billing', 'fleet', 'ports', 'routes', 'tariffs', 'crews', 'cargo', 'docks', 'audits'];
const NPM = ['core', 'harbor-rnd', 'routines', 'search', 'carriers'];
// manifest order, mixed — the workspace module first in the file is NOT assumed
const MANIFEST = [inline('reports'), npm('core'), linked('claims'), inline('default'), ...LINKED.slice(1).map(linked), inline('ledger'), ...NPM.slice(1).map(npm)];

const targets = viewModuleTargets(MANIFEST, 'default');

test('every row carries the module\'s id, its path, whether it is linked and whether it is the workspace\'s', () => {
	const ws = targets[0]!;
	assert.equal(ws.id, null, 'the workspace row is still the no-selector row');
	assert.equal(ws.name, 'default', 'but it names the workspace module');
	assert.equal(ws.path, 'modules/default');
	assert.equal(ws.workspace, true);
	assert.equal(ws.linked, false);
	const claims = targets.find((t) => t.id === 'claims')!;
	assert.deepEqual([claims.name, claims.path, claims.linked, claims.workspace], ['claims', 'git_modules/northwind-modules/modules/claims', true, false]);
	const reports = targets.find((t) => t.id === 'reports')!;
	assert.deepEqual([reports.name, reports.path, reports.linked, reports.workspace], ['reports', 'modules/reports', false, false]);
	assert.equal(targets.find((t) => t.id === 'carriers')!.locked, true);
});

test('moduleChoices keeps the order, offers the writable modules and splits the npm ones out', () => {
	const { choices, locked } = moduleChoices(targets);
	assert.deepEqual(choices.map((c) => c.value), [null, 'reports', 'claims', ...LINKED.slice(1), 'ledger']);
	assert.equal(choices.length, 14);
	assert.deepEqual(locked.map((t) => t.id).sort(), [...NPM].sort());
});

test('the hints: the workspace module beside "Workspace module", "linked" on a linked module, nothing on an inline one', () => {
	const { choices } = moduleChoices(targets);
	const by = (v: string | null) => choices.find((c) => c.value === v)!;
	assert.equal(by(null).text, 'Workspace module');
	assert.equal(by(null).hint, 'default');
	assert.equal(by('claims').hint, 'linked');
	assert.equal(by('reports').hint, undefined);
	for (const c of choices) {
		assert.doesNotMatch(`${c.text} ${c.hint ?? ''}`, /\//, `no path on the choice itself: ${c.text}`);
		assert.equal(c.title, whereOf(targets.find((t) => t.id === c.value)!), 'the path is the hover');
	}
});

test('a workspace module whose id sits inside "Workspace module" is still named beside it', () => {
	const t = viewModuleTargets([inline('module'), inline('reports')], 'module');
	assert.equal(moduleChoices(t).choices[0]!.hint, 'module');
});

test('whereOf: the module, linked when it is, and its path — never blank', () => {
	assert.equal(whereOf(targets.find((t) => t.id === 'reports')!), 'reports · modules/reports');
	assert.equal(whereOf(targets.find((t) => t.id === 'claims')!), 'claims · linked · git_modules/northwind-modules/modules/claims');
	assert.equal(whereOf(targets[0]!), 'default · modules/default');
	const none = viewModuleTargets([inline('reports')], null);
	assert.equal(none[0]!.name, '');
	assert.equal(whereOf(none[0]!), 'the default', 'no workspace module declared: the line still says something');
});

test('lockedNote: one sentence, singular and plural', () => {
	assert.equal(lockedNote(1), '1 module installed by npm is not offered — a write there is erased by the next npm install.');
	assert.equal(lockedNote(5), '5 modules installed by npm are not offered — a write there is erased by the next npm install.');
	assert.match(LOCKED_REASON, /erased by the next npm install/);
});

test('recordPageTargets renames only the workspace row, keeping its flags — and its choice has no hint', () => {
	const page = recordPageTargets(targets, 'default');
	const ws = page[0]!;
	assert.deepEqual([ws.id, ws.label, ws.name, ws.path, ws.workspace], ['default', 'default (workspace module)', 'default', 'modules/default', true]);
	assert.deepEqual(page.slice(1), targets.slice(1), 'every other row as it was');
	const { choices } = moduleChoices(page);
	assert.equal(choices[0]!.hint, undefined, 'the label already names the module');
	assert.equal(choices[0]!.title, 'default · modules/default');
});

test('recordPageTargets drops the workspace row when no workspace module is declared — a move names a module', () => {
	const none = viewModuleTargets([inline('reports'), npm('core')], null);
	const page = recordPageTargets(none, null);
	assert.deepEqual(page.map((t: ViewModuleTarget) => t.id), ['reports', 'core']);
});
