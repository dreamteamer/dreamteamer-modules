// THE CONTRACT — one case per behaviour a host owes, each naming the ROUTES entry it exercises.
// Run in order on one fixture (fixture.js): reads, record writes, the layer, dry runs, field writes,
// system writes. Each `expect` asserts status and SHAPE; values only where the fixture fixes them.
// A dry-run case asserts nothing was written: the workspace's HEAD and `git status` are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { check, shape, status } from './shape.js';

const NULL_PLAN = (res) => {
	status(res, 200);
	check(res.body && res.body.plan === null && res.body['dry-run'] === 'unsupported', `expected the null plan, got ${JSON.stringify(res.body).slice(0, 160)}`);
};
const snapshot = ({ fixture }) => ({ head: fixture.head(), status: fixture.git(['status', '--porcelain']) });
const unchanged = ({ fixture }, snap) => {
	check(fixture.head() === snap.head, 'a commit was made');
	check(fixture.git(['status', '--porcelain']) === snap.status, 'a file changed');
};
const A_PLAN = (res, ctx, snap) => {
	status(res, 200);
	check(res.body && typeof res.body === 'object' && res.body['dry-run'] !== 'unsupported', `expected a plan, got ${JSON.stringify(res.body).slice(0, 160)}`);
	unchanged(ctx, snap);
};
const schemaOf = async ({ request }, name) => {
	const res = await request('GET', '/schema');
	status(res, 200);
	return res.body.find((d) => d.name === name);
};
const ok = (res) => status(res, 200);
const layerFile = ({ fixture }) => path.join(fixture.layer, 'data', 'projects', 'harbor-mutual-archive.project.md');

/** @type {Array<{ id: string, route: string, method: string, path: string | Function, body?: unknown, before?: Function, expect: Function }>} */
export const cases = [
	// ---- reads ---------------------------------------------------------------------------------
	{ id: 'info', route: 'info', method: 'GET', path: '/info', expect: (res) => {
		ok(res); shape(res.body, { name: 'string', collections: 'array', modules: 'array', stale: 'number' });
		check(res.body.collections.includes('lab/samples'), 'collections lacks lab/samples');
	} },
	{ id: 'schema', route: 'schema', method: 'GET', path: '/schema', expect: (res) => {
		ok(res); check(Array.isArray(res.body) && res.body.some((d) => d.name === 'projects'), 'no projects descriptor');
	} },
	{ id: 'presentation-sources', route: 'presentation', method: 'GET', path: '/presentation', expect: (res) => {
		ok(res); shape(res.body, { collections: 'array' });
		const row = res.body.collections.find((r) => r.collection === 'projects');
		check(row, 'no projects row');
		check(Array.isArray(row.sources) && row.sources.length >= 2, 'the projects row carries no sources (own + the layer)');
		shape(row.sources[0], { name: 'string', kind: 'string', count: 'number' }, 'sources[0]');
	} },
	{ id: 'sources', route: 'sources', method: 'GET', path: '/sources', expect: (res) => {
		ok(res); shape(res.body, { workspace: 'object', layers: 'array', modules: 'array' });
		check(res.body.layers.some((l) => l.name === 'northwind-archive'), 'the layer is not in the stack');
	} },
	{ id: 'activity', route: 'activity', method: 'GET', path: '/activity?limit=5', expect: (res) => {
		ok(res); shape(res.body, { entries: 'array', hasMore: 'boolean', pending: 'array', settled: 'number' });
	} },
	{ id: 'nav', route: 'nav', method: 'GET', path: '/nav', expect: (res) => {
		ok(res); check(Array.isArray(res.body) && res.body.length > 0, 'no nav nodes');
		shape(res.body[0], { kind: 'string', key: 'string', label: 'string' }, 'nav[0]');
	} },
	{ id: 'scope', route: 'scope', method: 'PUT', path: '/scope', body: { scope: 'all' }, expect: (res) => {
		ok(res); shape(res.body, { scope: 'string' });
	} },
	{ id: 'folder', route: 'folder', method: 'GET', path: '/folder/projects/northwind-launch?field=media', expect: (res) => {
		ok(res); shape(res.body, { path: 'string|null', files: 'array', reason: 'string|null' });
		check(res.body.files.length > 0 || typeof res.body.reason === 'string', 'no files and no reason');
	} },
	{ id: 'values', route: 'values', method: 'GET', path: '/collections/projects/values/status', expect: (res) => {
		ok(res); shape(res.body, { values: 'array' });
		check(res.body.values.some((v) => v.value === 'active'), 'status values lack active');
	} },
	{ id: 'records-list', route: 'records-list', method: 'GET', path: '/collections/projects/records', expect: (res) => {
		ok(res); shape(res.body, { records: 'array', total: 'number' });
		const ids = res.body.records.map((r) => r.id);
		for (const id of ['northwind-launch', 'harbor-mutual-renewal', 'harbor-mutual-archive']) check(ids.includes(id), `no row ${id} (the layer's record included)`);
		const layer = res.body.records.find((r) => r.id === 'harbor-mutual-archive');
		shape(layer, { $source: 'string', 'last-modified': 'string|null' }, 'the layer row');
		check(!('notes' in res.body.records[0]), 'the body field came back without with-body=true');
	} },
	{ id: 'records-list-namespaced', route: 'records-list', method: 'GET', path: '/collections/lab%2Fsamples/records', expect: (res) => {
		ok(res); check(res.body.total === 1, `lab/samples total ${res.body.total}`);
	} },
	{ id: 'records-list-filter', route: 'records-list', method: 'GET', path: `/collections/projects/records?filter=${encodeURIComponent(JSON.stringify({ status: { _eq: 'active' } }))}`, expect: (res) => {
		ok(res); check(res.body.records.every((r) => r.status === 'active') && res.body.records.length >= 1, 'the filter did not narrow to active');
	} },
	{ id: 'records-list-unencoded-namespace', route: 'records-list', method: 'GET', path: '/collections/lab/samples/records', expect: (res) => status(res, 404) },
	{ id: 'record-read', route: 'record-read', method: 'GET', path: '/collections/projects/records/northwind-launch', expect: (res) => {
		ok(res); shape(res.body, { id: 'string', fields: 'object', path: 'string' });
		shape(res.body.fields, { name: 'string', 'last-modified': 'string|null', '$last-modified-by': 'string|null' }, 'fields');
		check(res.body.fields.name === 'Northwind launch', 'wrong record');
	} },
	{ id: 'record-read-missing', route: 'record-read', method: 'GET', path: '/collections/projects/records/no-such-project', expect: (res) => status(res, 404) },
	{ id: 'commands', route: 'commands', method: 'GET', path: '/commands/projects?ids=northwind-launch', expect: (res) => {
		ok(res); shape(res.body, { collection: 'string', ids: 'array', commands: 'array' });
		const row = res.body.commands.find((r) => r.name === 'review-project');
		check(row, 'review-project is not bound');
		check(row.states?.['northwind-launch'] === 'available', `northwind-launch is ${row.states?.['northwind-launch']}, expected available`);
	} },
	{ id: 'history', route: 'history', method: 'GET', path: '/history/projects/northwind-launch', expect: (res, ctx) => {
		ok(res); check(Array.isArray(res.body) && res.body.length >= 1, 'no commits');
		ctx.state.fixtureHash = res.body[0].hash ?? res.body[0].sha;
		check(typeof ctx.state.fixtureHash === 'string', 'a commit carries no hash');
	} },
	{ id: 'history-diff', route: 'history-diff', method: 'GET', path: '/history-diff/projects/northwind-launch', expect: (res) => {
		ok(res); check(res.body && typeof res.body === 'object', 'no diff object');
	} },

	// ---- record writes -------------------------------------------------------------------------
	{ id: 'records-create', route: 'records-create', method: 'POST', path: '/collections/tasks/records', body: { name: 'Call Sam', project: 'projects/northwind-launch' }, expect: (res, { fixture }) => {
		ok(res); shape(res.body, { id: 'string', path: 'string' });
		check(res.body.id === 'call-sam', `id ${res.body.id}`);
		check(fs.existsSync(path.join(fixture.root, res.body.path)), 'no file at the answered path');
	} },
	{ id: 'records-create-explicit-id', route: 'records-create', method: 'POST', path: '/collections/lab%2Fsamples/records', body: { id: 'sample-two', name: 'Second sample' }, expect: (res) => {
		ok(res); check(res.body.id === 'sample-two', `id ${res.body.id}`);
	} },
	{ id: 'records-create-refused', route: 'records-create', method: 'POST', path: '/collections/tasks/records', body: { done: true }, before: snapshot, expect: (res, ctx, snap) => {
		status(res, 400); shape(res.body, { error: 'string' }); unchanged(ctx, snap);
	} },
	{ id: 'record-update', route: 'record-update', method: 'PATCH', path: '/collections/tasks/records/call-sam', body: { done: true, id: 'ignored', 'last-modified': 'ignored', '$last-modified-by': 'ignored' }, expect: async (res, { request, fixture }) => {
		ok(res); shape(res.body, { id: 'string' });
		const read = await request('GET', '/collections/tasks/records/call-sam');
		check(read.body.fields.done === true, 'done was not set');
		const text = fs.readFileSync(path.join(fixture.root, read.body.path), 'utf8');
		check(!text.includes('last-modified') && !text.includes('$last-modified-by'), 'an echoed computed key was written');
	} },
	{ id: 'record-update-refused', route: 'record-update', method: 'PATCH', path: '/collections/projects/records/northwind-launch', body: { status: 'no-such-status' }, before: snapshot, expect: (res, ctx, snap) => {
		status(res, 400); unchanged(ctx, snap);
	} },
	{ id: 'record-update-layer', route: 'record-update', method: 'PATCH', path: '/collections/projects/records/harbor-mutual-archive', body: { status: 'active' }, expect: (res, ctx) => {
		ok(res); check(/status: active/.test(fs.readFileSync(layerFile(ctx), 'utf8')), "the edit did not land in the layer's clone");
	} },
	{ id: 'rename-layer-refused', route: 'rename', method: 'POST', path: '/collections/projects/rename', body: { old: 'harbor-mutual-archive', new: 'harbor-mutual-history' }, expect: (res, ctx) => {
		status(res, 400); check(/held by layer/.test(res.body.error), `refusal does not name the layer: ${res.body.error}`);
		check(fs.existsSync(layerFile(ctx)), 'the layer record moved');
	} },
	{ id: 'rename', route: 'rename', method: 'POST', path: '/collections/tasks/rename', body: { old: 'call-sam', new: 'call-sam-diaz' }, expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/tasks/records/call-sam-diaz'), 200);
	} },
	{ id: 'position', route: 'position', method: 'PATCH', path: '/collections/projects/position/harbor-mutual-renewal', body: { top: true }, expect: async (res, { request }) => {
		ok(res); shape(res.body, { id: 'string' });
		const read = await request('GET', '/collections/projects/records/harbor-mutual-renewal');
		check(typeof read.body.fields.rank === 'string' && read.body.fields.rank.length > 0, 'no rank written');
	} },
	{ id: 'position-refused', route: 'position', method: 'PATCH', path: '/collections/tasks/position/brief-dana', body: { top: true }, expect: (res) => status(res, 400) },
	{ id: 'revert', route: 'revert', method: 'POST', path: '/collections/projects/records-revert/northwind-launch', body: (ctx) => ({ hash: ctx.state.fixtureHash }),
		before: async ({ request }) => { await request('PATCH', '/collections/projects/records/northwind-launch', { status: 'paused' }); },
		expect: async (res, { request }) => {
			ok(res); const read = await request('GET', '/collections/projects/records/northwind-launch');
			check(read.body.fields.status === 'active', `status ${read.body.fields.status} after the revert`);
		} },
	{ id: 'file-import-refused', route: 'file-import', method: 'POST', path: '/collections/tasks/files', body: {}, expect: (res) => status(res, 400) },
	{ id: 'record-remove-referenced', route: 'record-remove', method: 'DELETE', path: '/collections/projects/records/northwind-launch', expect: (res) => status(res, 409) },
	{ id: 'record-remove', route: 'record-remove', method: 'DELETE', path: '/collections/tasks/records/call-sam-diaz', expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/tasks/records/call-sam-diaz'), 404);
	} },

	// ---- dry runs: a non-planner answers the null plan and writes nothing -----------------------
	{ id: 'dry-run-record-create', route: 'records-create', method: 'POST', path: '/collections/tasks/records?dry-run=true', body: { name: 'Never written' }, before: snapshot, expect: (res, ctx, snap) => { NULL_PLAN(res); unchanged(ctx, snap); } },
	{ id: 'dry-run-record-update', route: 'record-update', method: 'PATCH', path: '/collections/tasks/records/brief-dana?dry-run=true', body: { done: true }, before: snapshot, expect: (res, ctx, snap) => { NULL_PLAN(res); unchanged(ctx, snap); } },
	{ id: 'dry-run-field-add', route: 'field-add', method: 'POST', path: '/fields/tasks?dry-run=true', body: { name: 'never', type: 'string' }, before: snapshot, expect: (res, ctx, snap) => { NULL_PLAN(res); unchanged(ctx, snap); } },
	{ id: 'dry-run-field-edit', route: 'field-edit', method: 'PATCH', path: '/fields/tasks/name?dry-run=true', body: { description: 'Never written.' }, before: snapshot, expect: (res, ctx, snap) => { NULL_PLAN(res); unchanged(ctx, snap); } },
	{ id: 'dry-run-collection-set', route: 'record-update', method: 'PATCH', path: '/collections/collections/records/tasks?dry-run=true', body: { description: 'Never written.' }, before: snapshot, expect: (res, ctx, snap) => { NULL_PLAN(res); unchanged(ctx, snap); } },
	// ---- dry runs: a planner answers its plan and writes nothing ---------------------------------
	{ id: 'dry-run-field-remove', route: 'field-remove', method: 'DELETE', path: '/fields/projects/media?dry-run=true', before: snapshot, expect: A_PLAN },
	{ id: 'dry-run-field-rename', route: 'field-rename', method: 'POST', path: '/fields/projects/status/rename?dry-run=true', body: { to: 'state' }, before: snapshot, expect: A_PLAN },
	{ id: 'dry-run-field-rename-value', route: 'field-rename-value', method: 'POST', path: '/fields/projects/status/rename-value?dry-run=true', body: { from: 'paused', to: 'on-hold' }, before: snapshot, expect: A_PLAN },
	{ id: 'dry-run-commit', route: 'commit', method: 'POST', path: '/commit', body: { only: ['tasks'], dryRun: true }, before: snapshot, expect: (res, ctx, snap) => {
		ok(res); check(Array.isArray(res.body), 'commit answers no results array'); unchanged(ctx, snap);
	} },

	// ---- field writes ------------------------------------------------------------------------
	{ id: 'field-add', route: 'field-add', method: 'POST', path: '/fields/tasks', body: { name: 'priority', type: 'string', enum: 'low,high' }, expect: async (res, ctx) => {
		ok(res); const d = await schemaOf(ctx, 'tasks');
		check(d?.fields?.priority, 'priority is not in the compiled schema');
	} },
	{ id: 'field-add-refused', route: 'field-add', method: 'POST', path: '/fields/tasks', body: { name: 'broken', type: 'no-such-type' }, expect: async (res, ctx) => {
		status(res, 400); const d = await schemaOf(ctx, 'tasks'); check(!d?.fields?.broken, 'the refused field was compiled');
	} },
	{ id: 'field-edit', route: 'field-edit', method: 'PATCH', path: '/fields/tasks/priority', body: { description: 'How soon Dana needs it.' }, expect: async (res, ctx) => {
		ok(res); const d = await schemaOf(ctx, 'tasks'); check(d?.fields?.priority?.description === 'How soon Dana needs it.', 'description not compiled');
	} },
	{ id: 'field-rename-value', route: 'field-rename-value', method: 'POST', path: '/fields/tasks/priority/rename-value', body: { from: 'low', to: 'later' }, expect: async (res, ctx) => {
		ok(res); const d = await schemaOf(ctx, 'tasks'); check(JSON.stringify(d?.fields?.priority?.enum ?? '').includes('later'), 'the value was not renamed');
	} },
	{ id: 'field-rename', route: 'field-rename', method: 'POST', path: '/fields/tasks/priority/rename', body: { to: 'urgency' }, expect: async (res, ctx) => {
		ok(res); const d = await schemaOf(ctx, 'tasks'); check(d?.fields?.urgency && !d?.fields?.priority, 'not renamed');
	} },
	{ id: 'field-remove', route: 'field-remove', method: 'DELETE', path: '/fields/tasks/urgency', expect: async (res, ctx) => {
		ok(res); const d = await schemaOf(ctx, 'tasks'); check(!d?.fields?.urgency, 'not removed');
	} },

	// ---- system writes: the schema through the record routes ------------------------------------
	{ id: 'modules-add', route: 'records-create', method: 'POST', path: '/collections/modules/records', body: { name: 'northwind-extras', description: 'Extras for the Northwind account, kept apart from the default module.' }, expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/modules/records/northwind-extras'), 200);
	} },
	{ id: 'collections-add', route: 'records-create', method: 'POST', path: '/collections/collections/records?module=default', body: { name: 'memos', description: 'A short memo to the team.' }, expect: async (res, ctx) => {
		ok(res); check(await schemaOf(ctx, 'memos'), 'memos is not compiled');
	} },
	{ id: 'collections-set', route: 'record-update', method: 'PATCH', path: '/collections/collections/records/memos', body: { description: 'A short memo to the Northwind team.' }, expect: async (res, ctx) => {
		ok(res); check((await schemaOf(ctx, 'memos'))?.description === 'A short memo to the Northwind team.', 'description not compiled');
	} },
	{ id: 'dry-run-collection-move', route: 'record-update', method: 'PATCH', path: '/collections/collections/records/memos?dry-run=true', body: { module: 'northwind-extras' }, before: snapshot, expect: A_PLAN },
	{ id: 'collections-move', route: 'record-update', method: 'PATCH', path: '/collections/collections/records/memos', body: { module: 'northwind-extras' }, expect: async (res, { fixture }) => {
		ok(res); check(fs.existsSync(path.join(fixture.root, 'modules', 'northwind-extras', 'collections', 'memos.collection.yaml')), 'the source did not move');
	} },
	{ id: 'collections-rename', route: 'rename', method: 'POST', path: '/collections/collections/rename', body: { old: 'memos', new: 'notes-to-team' }, expect: async (res, ctx) => {
		ok(res); check(await schemaOf(ctx, 'notes-to-team'), 'not renamed');
	} },
	{ id: 'collections-rm', route: 'record-remove', method: 'DELETE', path: '/collections/collections/records/notes-to-team', expect: async (res, ctx) => {
		ok(res); check(!(await schemaOf(ctx, 'notes-to-team')), 'not removed');
	} },
	{ id: 'ui-views-add', route: 'records-create', method: 'POST', path: '/collections/ui-views/records?module=default', body: { id: 'tasks-table', route: '/tasks-table', scope: 'collection', collection: 'collections/tasks', display: { list: { layout: 'table' } } }, expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/ui-views/records/tasks-table'), 200);
	} },
	{ id: 'ui-views-set', route: 'record-update', method: 'PATCH', path: '/collections/ui-views/records/tasks-table', body: { 'display.nav.title': 'Tasks table' }, expect: async (res, { request }) => {
		ok(res); const read = await request('GET', '/collections/ui-views/records/tasks-table');
		check(JSON.stringify(read.body).includes('Tasks table'), 'title not saved');
	} },
	{ id: 'ui-views-rm', route: 'record-remove', method: 'DELETE', path: '/collections/ui-views/records/tasks-table', expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/ui-views/records/tasks-table'), 404);
	} },
	{ id: 'skills-add', route: 'records-create', method: 'POST', path: '/collections/skills/records?module=default', body: { name: 'triaging-tasks', description: 'use when a task arrives for the Northwind team and needs an owner' }, expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/skills/records/triaging-tasks'), 200);
	} },
	{ id: 'skills-set', route: 'record-update', method: 'PATCH', path: '/collections/skills/records/triaging-tasks', body: { description: 'use when a task arrives for the Northwind team and nobody owns it' }, expect: async (res, { request }) => {
		ok(res); const read = await request('GET', '/collections/skills/records/triaging-tasks');
		check(JSON.stringify(read.body).includes('nobody owns it'), 'description not saved');
	} },
	{ id: 'skills-rename', route: 'rename', method: 'POST', path: '/collections/skills/rename', body: { old: 'triaging-tasks', new: 'routing-tasks' }, expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/skills/records/routing-tasks'), 200);
	} },
	{ id: 'skills-rm', route: 'record-remove', method: 'DELETE', path: '/collections/skills/records/routing-tasks', expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/skills/records/routing-tasks'), 404);
	} },
	{ id: 'modules-set', route: 'record-update', method: 'PATCH', path: '/collections/modules/records/northwind-extras', body: { description: 'Extras for the Northwind account: nothing in it yet.' }, expect: (res) => ok(res) },
	{ id: 'dry-run-module-rm', route: 'record-remove', method: 'DELETE', path: '/collections/modules/records/northwind-extras?dry-run=true&force=true', before: snapshot, expect: A_PLAN },
	{ id: 'modules-rm', route: 'record-remove', method: 'DELETE', path: '/collections/modules/records/northwind-extras?force=true', expect: async (res, { request }) => {
		ok(res); status(await request('GET', '/collections/modules/records/northwind-extras'), 404);
	} },

	{ id: 'reload', route: 'reload', method: 'POST', path: '/reload', body: {}, expect: (res) => { ok(res); shape(res.body, { ok: 'boolean' }); } },
];
