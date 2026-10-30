// `dt-workflows` — a shipped workflow reaches a workspace only as a copy the workspace then owns. Pinned
// twice: the pure rules on a hand-built runtime (refuse what names an uncompiled command, never
// overwrite an edited copy, --force replaces), and the whole path on the real engine — the module
// packed as npm delivers it, installed, compiled, the workflow installed and `dt check` clean, the
// nested references validated, and a step's set listed with its range filled in.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { moduleRoots, shippedWorkflows, refsOf, missingRefs, workflowsDir, stateOf, install, main } from '../bin/install.mjs';
import { virginWorkspace, installPacked, compileAndCheck, run, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TEMPLATE = `---
name: probe flow
status: active
steps:
  - name: sync
    command: commands/fetch-meetings
    collection: collections/meetings
  - name: plan
    command: commands/rnd/plan
    collection: collections/rnd/change-requests
---
## 1. sync
## 2. plan
`;

/** A hand-built compiled runtime: a manifest naming one npm module that ships the probe workflow. */
function fakeWorkspace({ compiled = ['fetch-meetings'], collections = ['meetings', 'workflows'] } = {}) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtw-')); made.push(ws);
	const mod = path.join(ws, 'node_modules', '@dreamteamer', 'probe');
	fs.mkdirSync(path.join(mod, 'data', 'workflows'), { recursive: true });
	fs.writeFileSync(path.join(mod, 'package.json'), '{"name":"@dreamteamer/probe"}');
	fs.writeFileSync(path.join(mod, 'data', 'workflows', 'probe-flow.workflow.md'), TEMPLATE);
	const rt = path.join(ws, '.dreamteamer');
	fs.mkdirSync(path.join(rt, 'commands', 'rnd'), { recursive: true });
	fs.mkdirSync(path.join(rt, 'collections', 'rnd'), { recursive: true });
	fs.writeFileSync(path.join(rt, 'manifest.yaml'), [
		'compiled: x', 'modules:',
		'  - name: default', '    location: modules', '    channel: inline', '    root: modules/default',
		"  - name: '@dreamteamer/probe'", '    location: node_modules', '    channel: npm', '    root: node_modules/@dreamteamer/probe',
		'  - name: workspace-root', '    channel: inline', '    root: .',
		'ui: []', '',
	].join('\n'));
	for (const c of compiled) fs.writeFileSync(path.join(rt, 'commands', `${c}.command.md`), '---\nname: x\n---\n');
	for (const c of collections) fs.writeFileSync(path.join(rt, 'collections', `${c}.collection.yaml`), c === 'workflows' ? 'name: workflows\nstorage:\n  path: data/workflows\n  format: md\n' : `name: ${c}\n`);
	return ws;
}

describe('the rules, on a hand-built runtime', () => {
	test('module roots come from the compiled manifest, and the workspace root is never one', () => {
		const ws = fakeWorkspace();
		assert.deepEqual(moduleRoots(ws).map((m) => m.root), ['modules/default', 'node_modules/@dreamteamer/probe']);
	});
	test('a shipped workflow is found under a module root, by id', () => {
		const ws = fakeWorkspace();
		assert.deepEqual(shippedWorkflows(ws).map((w) => [w.id, w.module]), [['probe-flow', '@dreamteamer/probe']]);
	});
	test('the references are read from the frontmatter only', () => {
		assert.deepEqual(refsOf(TEMPLATE + '\nsee commands/not-this-one\n'), ['collections/meetings', 'collections/rnd/change-requests', 'commands/fetch-meetings', 'commands/rnd/plan']);
	});
	test('a workflow naming an uncompiled command or collection is REFUSED, naming each one, and nothing is written', () => {
		const ws = fakeWorkspace();
		assert.deepEqual(missingRefs(ws, refsOf(TEMPLATE)), ['collections/rnd/change-requests', 'commands/rnd/plan']);
		const r = install(ws, shippedWorkflows(ws)[0]);
		assert.equal(r.ok, false);
		assert.match(r.line, /commands\/rnd\/plan/);
		assert.ok(!fs.existsSync(path.join(ws, 'data', 'workflows', 'probe-flow.workflow.md')));
	});
	test('with everything compiled it is copied verbatim, then reads installed', () => {
		const ws = fakeWorkspace({ compiled: ['fetch-meetings', 'rnd/plan'], collections: ['meetings', 'workflows', 'rnd/change-requests'] });
		const wf = shippedWorkflows(ws)[0];
		assert.equal(stateOf(ws, wf), 'missing');
		assert.equal(install(ws, wf).ok, true);
		assert.equal(fs.readFileSync(path.join(workflowsDir(ws), 'probe-flow.workflow.md'), 'utf8'), TEMPLATE);
		assert.equal(stateOf(ws, wf), 'installed');
		assert.match(install(ws, wf).line, /already installed/);
	});
	test('an edited copy is the workspace\'s own: refused without --force, replaced with it', () => {
		const ws = fakeWorkspace({ compiled: ['fetch-meetings', 'rnd/plan'], collections: ['meetings', 'workflows', 'rnd/change-requests'] });
		const wf = shippedWorkflows(ws)[0];
		install(ws, wf);
		const at = path.join(workflowsDir(ws), 'probe-flow.workflow.md');
		fs.writeFileSync(at, TEMPLATE.replace('status: active', 'status: retired'));
		assert.equal(stateOf(ws, wf), 'edited');
		const refused = install(ws, wf);
		assert.equal(refused.ok, false);
		assert.match(fs.readFileSync(at, 'utf8'), /retired/);
		assert.equal(install(ws, wf, { force: true }).ok, true);
		assert.equal(fs.readFileSync(at, 'utf8'), TEMPLATE);
	});
	test('without the workflows collection compiled there is nowhere to install to — refused, naming the module', () => {
		const ws = fakeWorkspace({ collections: ['meetings'] });
		assert.match(install(ws, shippedWorkflows(ws)[0]).line, /workflows collection is not compiled/);
	});
	test('the CLI: an unknown id exits 1, no verb exits 2', () => {
		const ws = fakeWorkspace();
		assert.equal(main(['install', 'no-such-flow'], ws), 1);
		assert.equal(main([], ws), 2);
		assert.equal(main(['list'], ws), 0);
	});
});

describe('on the real engine, from the packed tarball', () => {
	const MEETING_MODULES = ['assets', 'users', 'companies', 'contacts', 'engagements', 'tasks', 'meetings', 'recordings', 'meeting-docs'];
	const tool = (root, ...args) => spawnSync(process.execPath, [path.join(root, 'node_modules', '@dreamteamer', 'workflows', 'bin', 'install.mjs'), ...args], { cwd: root, encoding: 'utf8' });

	test('alone, the module compiles; customer-factory is refused, naming the meeting commands it lacks', () => {
		const root = virginWorkspace();
		installPacked(root, ['workflows']);
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		compileAndCheck(root);
		const r = tool(root, 'install', 'customer-factory');
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stderr, /commands\/fetch-meetings/);
		assert.ok(!fs.existsSync(path.join(root, 'data', 'workflows', 'customer-factory.workflow.md')));
	});

	test('beside the meeting modules: installed, dt check clean, its sets list, and dt next answers its steps', () => {
		const root = virginWorkspace();
		installPacked(root, ['workflows', ...MEETING_MODULES]);
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		compileAndCheck(root);
		const listed = tool(root, 'list');
		assert.match(listed.stdout, /customer-factory {2}@dreamteamer\/workflows {2}missing/);
		const r = tool(root, 'install', 'customer-factory');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		const checked = run(root, ['check']);
		assert.equal(checked.status, 0, checked.stdout + checked.stderr);
		assert.match(checked.stdout + checked.stderr, /0 violations/);
		// a record set, with the run's range filled in, and the engine's answer for it
		for (const [args, ok] of [
			[['add', 'companies', '--name', 'Northwind'], 0],
			[['add', 'meetings', '--name', 'Northwind intro', '--starts', '2026-10-28T10:00:00+02:00', '--company', 'companies/northwind'], 0],
		]) assert.equal(run(root, args).status, ok);
		const where = JSON.stringify({ starts: { _gte: '2026-10-23', _lte: '$now' }, company: { engagements: { _empty: true } } });
		const set = run(root, ['list', 'meetings', '--where', where, '--json']);
		assert.equal(set.status, 0, set.stderr);
		const ids = JSON.parse(set.stdout).map((x) => x.id);
		assert.deepEqual(ids, ['2026/10/2026-10-28--10-00--northwind--northwind-intro']);
		const next = run(root, ['next', 'meetings', '--ids', ids.join(',')]);
		assert.match(next.stdout, /prepare-for-meeting {2}\[record\] {2}1\/1 eligible/);
		// a range the runner forgot to fill in is refused rather than read as everything
		const unfilled = run(root, ['list', 'meetings', '--where', '{"starts":{"_gte":"$from"}}']);
		assert.notEqual(unfilled.status, 0);
		assert.match(unfilled.stderr, /unknown value token\(s\) \$from/);
	});

	test('a step naming a command the workspace lacks fails dt check — the nested references are typed', () => {
		const root = virginWorkspace();
		installPacked(root, ['workflows']);
		compileAndCheck(root);
		fs.mkdirSync(path.join(root, 'data', 'workflows'), { recursive: true });
		fs.writeFileSync(path.join(root, 'data', 'workflows', 'broken.workflow.md'), '---\nname: broken\nsteps:\n  - name: nope\n    command: commands/no-such-command\n    collection: collections/workflows\n  - name: look\n    collection: collections/workflows\n---\n');
		const checked = run(root, ['check']);
		assert.notEqual(checked.status, 0);
		assert.match(checked.stdout + checked.stderr, /steps\.command: dangling reference "commands\/no-such-command"/);
		assert.match(checked.stdout + checked.stderr, /must have required property 'stop'/);
	});
});
