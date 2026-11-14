import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModuleScope, MODULE_ROUTES } from '../src/module-scope.js';
import { readModuleGrant, readModuleGrantResult } from '../src/module-grant.js';
import { gate } from '../src/gate.js';

const descriptors = [
	{ name: 'lab/samples', fields: { name: { type: 'string' }, owner: { type: 'users' }, seen_in: { type: 'contacts' }, project: { type: 'projects' } }, compiled: { overlaid_by: [] } },
	{ name: 'lab/runs', fields: { sample: { type: 'lab/samples' } }, compiled: { overlaid_by: [] } },
	{ name: 'lab/shared', fields: { name: { type: 'string' } }, compiled: { overlaid_by: ['other'] } },
	{ name: 'users', fields: { name: { type: 'string' } } },
	{ name: 'contacts', fields: { name: { type: 'string' } } },
	{ name: 'projects', fields: { name: { type: 'string' } } },
	{ name: 'tasks', fields: { name: { type: 'string' } } },
];
const collectionsRows = [
	{ id: 'lab/samples', $module: 'lab' }, { id: 'lab/runs', $module: 'lab' }, { id: 'lab/shared', $module: 'lab' },
	{ id: 'users', $module: '@dreamteamer/core' }, { id: 'contacts', $module: '@dreamteamer/core' }, { id: 'projects', $module: '@dreamteamer/core' },
	{ id: 'tasks', $module: '@dreamteamer/core' }, { id: 'ui-views', $module: 'dreamteamer' },
];
const build = (grant) => buildModuleScope({ module: 'lab', home: 'lab-layer', collectionsRows, descriptors, grant });

test('own is the module single-source collections; an overlay is never own', () => {
	assert.deepEqual([...build({}).own].sort(), ['lab/runs', 'lab/samples']);
});
test('reads: own, plus granted collections an own collection references, plus ui-views; a reference alone grants nothing', () => {
	const none = build({});
	assert.deepEqual([...none.reads].sort(), ['lab/runs', 'lab/samples', 'ui-views']);
	const granted = build({ lab: { reads: ['users', 'contacts', 'tasks', 'collections'] } });
	assert.deepEqual([...granted.reads].sort(), ['contacts', 'lab/runs', 'lab/samples', 'ui-views', 'users']);
});
test('writes: only granted own collections, never a system collection; no grant means read-only routes', () => {
	assert.equal(build({}).writes.size, 0);
	assert.match(gate(build({}), descriptors, 'POST', '/collections/lab%2Fsamples/records', {}, { name: 'x' }).error, /no write is granted/);
	const s = build({ lab: { writes: ['lab/samples', 'users', 'ui-views'] } });
	assert.deepEqual([...s.writes.keys()], ['lab/samples']);
	assert.deepEqual(s.writes.get('lab/samples'), { ops: new Set(['create', 'update', 'delete', 'position']), fields: 'own-fields', mirroredRefs: 'refuse', commit: false });
	assert.equal(s.routes.has('records-create'), true);
	assert.equal(s.home, 'lab-layer');
});
test('module routes never include commit, history, fields, folder, files, rename, revert, sources, activity, nav (read or write), notes, sessions', () => {
	for (const id of ['commit', 'history', 'history-diff', 'field-add', 'folder', 'file-import', 'rename', 'revert', 'sources', 'activity', 'nav', 'nav-put', 'nav-patch', 'reload']) assert.equal(MODULE_ROUTES.includes(id), false, id);
});
test('refusal sentences name the collection or route, its owner, and the reach', () => {
	const s = build({});
	assert.equal(gate(s, descriptors, 'GET', '/collections/tasks/records', {}).error,
		'module app lab cannot read tasks: it belongs to @dreamteamer/core — a module app reads only its own collections (lab/runs, lab/samples) and what this workspace\'s .vscode/settings.json grants it');
	assert.equal(gate(s, descriptors, 'POST', '/collections/lab%2Fsamples/records', {}, { name: 'x' }).error,
		'module app lab cannot write lab/samples: no write is granted to it — grant one in dreamteamer.moduleApps in this workspace\'s .vscode/settings.json');
	assert.equal(gate(s, descriptors, 'POST', '/collections/tasks/records', {}, { name: 'x' }).error,
		'module app lab cannot write tasks: it belongs to @dreamteamer/core — a module app writes only its own collections, and only what this workspace grants it');
	assert.equal(gate(s, descriptors, 'POST', '/commit', {}, {}).error, 'module app lab cannot call POST /commit: a module app reads and writes records only');
});

test('readModuleGrant reads only <root>/.vscode/settings.json, with comments and trailing commas', () => {
	const root = mkdtempSync(join(tmpdir(), 'grant-'));
	assert.deepEqual(readModuleGrant(root), {});
	mkdirSync(join(root, '.vscode'));
	writeFileSync(join(root, '.vscode', 'settings.json'), '{\n // the grant\n "dreamteamer.moduleApps": { "lab": { "reads": ["users",], "writes": ["lab/samples"] }, },\n "x": "http://a//b" /* tail */ }\n');
	assert.deepEqual(readModuleGrant(root), { lab: { reads: ['users'], writes: ['lab/samples'] } });
	writeFileSync(join(root, 'hq.code-workspace'), '{"settings": {"dreamteamer.moduleApps": {"lab": {"reads": ["contacts"]}}}}');
	assert.deepEqual(readModuleGrant(root), { lab: { reads: ['users'], writes: ['lab/samples'] } });
	writeFileSync(join(root, '.vscode', 'settings.json'), '{ not json');
	assert.deepEqual(readModuleGrant(root), {});
	writeFileSync(join(root, '.vscode', 'settings.json'), '{"dreamteamer.moduleApps": {"lab": {"reads": "users", "writes": [3]}}}');
	assert.deepEqual(readModuleGrant(root), { lab: { reads: [], writes: [] } });
});

test('readModuleGrantResult says why a grant could not be read; an absent file or key is no problem', () => {
	const root = mkdtempSync(join(tmpdir(), 'grant-'));
	assert.deepEqual(readModuleGrantResult(root), { grant: {}, problem: null });
	mkdirSync(join(root, '.vscode'));
	writeFileSync(join(root, '.vscode', 'settings.json'), '{ not json');
	assert.match(readModuleGrantResult(root).problem, /not valid JSON/);
	for (const v of ['"all"', '["lab"]']) { writeFileSync(join(root, '.vscode', 'settings.json'), `{"dreamteamer.moduleApps": ${v}}`); assert.match(readModuleGrantResult(root).problem, /not an object/); }
	writeFileSync(join(root, '.vscode', 'settings.json'), '{"editor.tabSize": 2}');
	assert.deepEqual(readModuleGrantResult(root), { grant: {}, problem: null });
});
