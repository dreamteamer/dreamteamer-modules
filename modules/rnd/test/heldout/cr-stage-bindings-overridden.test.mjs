// HELD-OUT (cr-modules-006-h1-binding-overridden-or-disabled): a workspace that overrides rnd's plan binding by
// id (its own copy, edited in place) or disables it — the stage rule follows the workspace's bindings, or goes
// silent; never a warning built on the shipped predicate. Written by the test stage from the review's steps; the
// steps' override value `urgent` is not a priority the enum allows, so the override reads `critical`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { rndWorkspace, run, cleanupAll } from '../helpers/rnd-workspace.mjs';
import { RND, product, doc, req, reqFile, settle, linesFor, stageLines, migrate, accepted, designs, bytes } from './lib/cr-stage-records.mjs';

after(() => cleanupAll());
const { allowedStages } = await import(path.join(RND, 'lib', 'cr-stage.mjs'));

function seed(root) {
	product(root);
	doc(root, 'act', 'active');
	req(root, 'ov-medium', [...accepted, 'priority: medium', designs('act'), 'stage: plan']);
	req(root, 'ov-medium-empty', [...accepted, 'priority: medium', designs('act')]);
	req(root, 'ov-urgent', [...accepted, 'priority: critical', designs('act'), 'stage: design-review']);
	settle(root);
}
const available = (root, id) => {
	const r = run(root, ['next', `rnd/change-requests/${id}`, '--json']);
	assert.equal(r.status, 0, r.stderr);
	const j = JSON.parse(r.stdout);
	return (j.commands ?? j).filter((c) => c.states?.[id] === 'available').map((c) => String(c.binding).replace(/^command-bindings\//, ''));
};
const ALLOWED = () => allowedStages({ status: 'accepted', accepted_on: 'x', design_docs: ['d'], implementation_plans: [] }).join(' · ');

describe('h1 — a binding overridden by id, or disabled', () => {
	test('override: the workspace\'s predicate is followed; the migration agrees', () => {
		const root = rndWorkspace();
		const f = path.join(root, 'modules/rnd/command-bindings/rnd--plan--change-requests.command-binding.yaml');
		fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('available_when:\n', 'available_when:\n  priority:\n    _eq: critical\n'));
		assert.equal(run(root, ['compile']).status, 0);
		seed(root);
		assert.ok(!available(root, 'ov-medium').includes('rnd--plan--change-requests'));
		assert.ok(available(root, 'ov-urgent').includes('rnd--plan--change-requests'));
		assert.equal(ALLOWED(), 'design-review · plan');
		const c = run(root, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		assert.deepEqual(linesFor(c.stdout, 'ov-medium'), [], 'no line on the shipped predicate');
		assert.doesNotMatch(c.stdout, /ov-medium\.change-request\.md — .*(is at plan|\/rnd:plan)/);
		const empty = linesFor(c.stdout, 'ov-medium-empty');
		assert.equal(empty.length, 1);
		assert.match(empty[0], new RegExp(`stage is empty and no gate is open — the record allows ${ALLOWED()}`));
		const urgent = linesFor(c.stdout, 'ov-urgent');
		assert.equal(urgent.length, 1);
		assert.match(urgent[0], /stage is design-review but the record is at plan — dt next names \/rnd:plan; set stage=plan/);

		const dry = migrate(root);
		assert.equal(dry.code, 0, dry.out + dry.err);
		assert.match(dry.out, /would set rnd\/change-requests\/ov-urgent stage=plan \(was design-review\)/);
		assert.match(dry.out, new RegExp(`cannot tell rnd/change-requests/ov-medium-empty: .* — the record allows ${ALLOWED()}`));
		assert.doesNotMatch(dry.out, /rnd\/change-requests\/ov-medium[ :]/);
		const before = { m: bytes(reqFile(root, 'ov-medium')), e: bytes(reqFile(root, 'ov-medium-empty')) };
		const w = migrate(root, { args: ['--write'] });
		assert.equal(w.code, 0, w.out + w.err);
		assert.match(fs.readFileSync(reqFile(root, 'ov-urgent'), 'utf8'), /^stage: plan$/m);
		assert.deepEqual(bytes(reqFile(root, 'ov-medium')), before.m);
		assert.deepEqual(bytes(reqFile(root, 'ov-medium-empty')), before.e);
		const c2 = run(root, ['check']);
		assert.equal(stageLines(c2.stdout).length, 1, c2.stdout);
		assert.equal(linesFor(c2.stdout, 'ov-medium-empty').length, 1);
	});

	test('disable: silent on the gate rule; the empty request still warns; the migration plans no write', () => {
		const root = rndWorkspace();
		const pf = path.join(root, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pf, 'utf8'));
		pkg.dreamteamer.disable = [...(pkg.dreamteamer.disable ?? []), 'command-bindings/rnd--plan--change-requests'];
		fs.writeFileSync(pf, JSON.stringify(pkg, null, '\t') + '\n');
		const comp = run(root, ['compile']);
		assert.equal(comp.status, 0, comp.stderr);
		assert.doesNotMatch(comp.stderr + comp.stdout, /matched nothing/);
		seed(root);
		assert.ok(!available(root, 'ov-urgent').includes('rnd--plan--change-requests'));
		const c = run(root, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		assert.deepEqual(linesFor(c.stdout, 'ov-medium'), []);
		assert.deepEqual(linesFor(c.stdout, 'ov-urgent'), []);
		assert.equal(linesFor(c.stdout, 'ov-medium-empty').length, 1);
		const dry = migrate(root);
		assert.equal(dry.code, 0, dry.out + dry.err);
		assert.match(dry.out, /cannot tell rnd\/change-requests\/ov-medium-empty/);
		assert.doesNotMatch(dry.out, /would set rnd\/change-requests\/ov-urgent/);
		assert.doesNotMatch(dry.out + dry.err, /    at /);
	});
});
