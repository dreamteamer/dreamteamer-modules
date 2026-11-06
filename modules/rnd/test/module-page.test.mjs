// The R&D module's PAGE — ten ui-views rnd ships: a page view (`modules-rnd`) that nests the module's
// activity feed beside a column of counts, one per lifecycle collection, each grouped by its status.
// A page that nests views is the editor's vocabulary (`display.list.layout: page`, `options.views`); the
// engine passes it through untouched, so what this module owes is that the views are PACKED, COMPILE
// in a fresh workspace from the tarball, name what the page promises, and leave `dt check` clean with
// records in every collection they count. Synthetic Northwind records only.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, packedFiles, run, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);

const COUNTED = ['change-requests', 'issues', 'features', 'tests', 'reviews', 'design-docs', 'implementation-plans'];
const BY_STATUS = COUNTED.map((c) => `rnd-${c}-by-status`);
const VIEWS = ['modules-rnd', 'modules-rnd-activity', 'modules-rnd-counts', ...BY_STATUS];

let ws;
const view = (id) => yaml.load(fs.readFileSync(path.join(ws, '.dreamteamer', 'ui-views', `${id}.ui-view.yaml`), 'utf8'));
const put = (rel, text) => { const f = path.join(ws, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function workspace() {
	if (ws) return ws;
	ws = virginWorkspace();
	installPacked(ws, ['rnd']);
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}\n');
	const c = run(ws, ['compile']);
	assert.equal(c.status, 0, c.stderr + c.stdout);
	return ws;
}

test('the tarball ships the ten page views', () => {
	const files = packedFiles('rnd');
	for (const id of VIEWS) assert.ok(files.includes(`ui-views/${id}.ui-view.yaml`), `ui-views/${id}.ui-view.yaml is not in the tarball`);
	// the change-request board (cr-stage-board.test.mjs) is a collection view, not one of the page's
	const others = ['ui-views/rnd-change-requests-board.ui-view.yaml'];
	assert.equal(files.filter((f) => f.startsWith('ui-views/') && !others.includes(f)).length, VIEWS.length, 'and nothing else under ui-views/');
});

test('from the tarball, a fresh workspace compiles all ten, and the page is keyed on the installed module id', () => {
	workspace();
	const compiled = fs.readdirSync(path.join(ws, '.dreamteamer', 'ui-views')).map((f) => f.replace(/\.ui-view\.yaml$/, ''));
	for (const id of VIEWS) assert.ok(compiled.includes(id), `${id} compiled`);
	assert.ok(fs.existsSync(path.join(ws, '.dreamteamer', 'modules', 'rnd.module.yaml')), 'the installed module id is rnd');
	const page = view('modules-rnd');
	assert.equal(page.scope, 'page');
	assert.deepEqual(page.compiled.display.list, { layout: 'page', options: { module: 'rnd', grid_columns: 2, views: ['ui-views/modules-rnd-activity', 'ui-views/modules-rnd-counts'] } });
	assert.deepEqual(view('modules-rnd-activity').compiled.display.list, { layout: 'activity', options: { module: 'rnd' } });
});

test('the counts column names a by-status view per lifecycle collection, each counting that collection by its status', () => {
	workspace();
	const column = view('modules-rnd-counts');
	assert.equal(column.compiled.display.list.layout, 'page');
	assert.deepEqual(column.compiled.display.list.options.views, BY_STATUS.map((id) => `ui-views/${id}`));
	for (const c of COUNTED) {
		const v = view(`rnd-${c}-by-status`);
		assert.equal(v.scope, 'collection');
		assert.equal(v.collection, `collections/rnd/${c}`);
		assert.equal(v.compiled.display.list.layout, 'counts');
		assert.equal(v.compiled.display.list.options.group_by, 'status', `${c} counts by status — a field option, so compile checked it`);
	}
	// every reference a page makes resolves to a compiled view — a missing one would be refused at render
	for (const id of ['modules-rnd', 'modules-rnd-counts']) for (const ref of view(id).compiled.display.list.options.views) assert.ok(fs.existsSync(path.join(ws, '.dreamteamer', 'ui-views', `${ref.replace(/^ui-views\//, '')}.ui-view.yaml`)), `${id} → ${ref}`);
});

test('dt check is clean with records in every counted collection', () => {
	workspace();
	put('data/repos/northwind-portal.repo.yaml', 'name: northwind-portal\nurl: https://git.example/northwind/portal\n');
	put('data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
	put('data/rnd/change-requests/cr-001.change-request.md', '---\nkey: cr-001\nname: Grantees upload receipts\nproducts:\n  - rnd/products/grantee-portal\nstatus: accepted\n---\n');
	put('data/rnd/issues/2026-01-10--login-loops.issue.md', '---\nname: Login loops\nrepo: repos/northwind-portal\nstatus: open\n---\n');
	put('data/rnd/issues/2026-01-11--receipt-upload-times-out.issue.md', '---\nname: Receipt upload times out\nrepo: repos/northwind-portal\nstatus: fixed\n---\n');
	put('data/rnd/features/2026-01-10--bulk-export.feature.md', '---\nname: Bulk export\nrepo: repos/northwind-portal\nproblem: Harbor Mutual exports by hand.\nstatus: requested\n---\n');
	put('data/rnd/tests/grantee-portal/upload-a-receipt.test.md', '---\nkey: upload-a-receipt\nname: Upload a receipt\nproduct: rnd/products/grantee-portal\nstatus: passing\n---\n');
	put('data/rnd/reviews/2026-01-12--receipts-design.review.md', '---\nname: Receipts design\nstatus: closed\n---\n');
	put('data/rnd/design-docs/2026-01-09--receipts.design-doc.md', '---\nname: Receipts\nstatus: active\n---\n');
	put('data/rnd/implementation-plans/2026-01-11--receipts.implementation-plan.md', '---\nname: Receipts\nstatus: in-progress\n---\n');
	for (const c of ['rnd/products', 'rnd/change-requests', 'rnd/design-docs', 'rnd/implementation-plans']) {
		const r = run(ws, ['relations', 'rebuild', c]);
		assert.equal(r.status, 0, `${c}: ${r.stderr}${r.stdout}`);
	}
	const k = run(ws, ['check']);
	assert.equal(k.status, 0, k.stdout + k.stderr);
	for (const c of COUNTED) {
		const l = run(ws, ['list', `rnd/${c}`, '--json']);
		assert.equal(l.status, 0, l.stderr);
		assert.ok(JSON.parse(l.stdout).length > 0, `rnd/${c} holds a record the page counts`);
	}
});
