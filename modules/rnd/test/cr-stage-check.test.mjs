// THE STAGE RULE — `dt check` warns when a change request's `stage` is not the gate `dt next` names on it, or
// contradicts the request's own status, dates and links. The pure half first (lib/cr-stage.mjs: every
// reading is a test), then the rule end to end through `dt check` on fixtures.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { rndWorkspace, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';

after(() => cleanupAll());

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const lib = await import(path.join(RND, 'lib', 'cr-stage.mjs'));
const { STAGES, GATES, expectedStage, stageContradictions, allowedStages, stageWarnings, gateCommand } = lib;

const T = '2026-03-02T10:00:00+02:00';
// a request's own facts, by the state it is in
const base = { status: 'suggested', design_docs: [], implementation_plans: [] };
const at = {
	design: { ...base },
	'design-review': { ...base, design_docs: ['rnd/design-docs/d'] },
	acceptance: { ...base, design_docs: ['rnd/design-docs/d'] },
	plan: { status: 'accepted', accepted_on: T, design_docs: ['rnd/design-docs/d'], implementation_plans: [] },
	'plan-review': { status: 'accepted', accepted_on: T, design_docs: ['rnd/design-docs/d'], implementation_plans: ['rnd/implementation-plans/p'] },
};
at.implement = { ...at['plan-review'] };
at['code-review'] = { ...at['plan-review'] };
at.test = { ...at['plan-review'] };
at['test-review'] = { ...at.test, tested_on: T };
at.deploy = { ...at['test-review'], verified_on: T };
at['live-check'] = { ...at.deploy, deployed_on: T };
at.done = { ...at['live-check'], status: 'implemented' };
at.rejected = { ...base, status: 'rejected', design_docs: ['rnd/design-docs/d'] };

describe('lib/cr-stage.mjs — the pure rule', () => {
	test('STAGES is the descriptor\'s enum, in order', () => {
		const d = yaml.load(fs.readFileSync(path.join(RND, 'collections/rnd/change-requests.collection.yaml'), 'utf8'));
		assert.deepEqual(STAGES, d.fields.stage.enum);
	});

	// one case per binding, so swapping any two GATES entries fails two cases
	const BINDINGS = [
		['rnd--design--change-requests', 'design'],
		['rnd--review--change-requests--design', 'design-review'],
		['rnd--review--change-requests', 'acceptance'],
		['rnd--plan--change-requests', 'plan'],
		['rnd--review--change-requests--plan', 'plan-review'],
		['rnd--implement--change-requests', 'implement'],
		['rnd--review--change-requests--code', 'code-review'],
		['rnd--test--change-requests', 'test'],
		['rnd--review--change-requests--test', 'test-review'],
		['rnd--deploy--change-requests', 'deploy'],
		['rnd--release--change-requests', 'deploy'],
		['rnd--review--change-requests--deploy', 'live-check'],
	];
	test('GATES maps exactly rnd\'s twelve change-request bindings', () => {
		assert.deepEqual(Object.keys(GATES).sort(), BINDINGS.map(([b]) => b).sort());
	});
	for (const [binding, stage] of BINDINGS) {
		test(`${binding} open → ${stage}`, () => {
			assert.equal(GATES[binding], stage);
			assert.equal(expectedStage({ status: 'accepted', available: [binding] }), stage);
		});
	}
	test('every rnd change-request binding file on disk is in GATES', () => {
		const files = fs.readdirSync(path.join(RND, 'command-bindings')).filter((f) => /--change-requests(--[a-z]+)?\.command-binding\.yaml$/.test(f) && !/^rnd--change-request--/.test(f));
		assert.deepEqual(files.map((f) => f.replace('.command-binding.yaml', '')).sort(), Object.keys(GATES).sort());
	});

	test('expectedStage: status decides done and rejected; two gates → the earlier; none or unknown → null', () => {
		assert.equal(expectedStage({ status: 'implemented', available: [] }), 'done');
		assert.equal(expectedStage({ status: 'rejected', available: ['rnd--design--change-requests'] }), 'rejected');
		assert.equal(expectedStage({ status: 'accepted', available: ['rnd--review--change-requests--deploy', 'rnd--review--change-requests--test'] }), 'test-review');
		assert.equal(expectedStage({ status: 'suggested', available: ['rnd--review--change-requests', 'rnd--review--change-requests--design'] }), 'design-review');
		assert.equal(expectedStage({ status: 'accepted', available: [] }), null);
		assert.equal(expectedStage({ status: 'accepted', available: ['my--own--binding'] }), null);
		assert.equal(expectedStage({ status: undefined, available: [] }), null);
	});

	test('gateCommand names the verb, and which review', () => {
		assert.equal(gateCommand('rnd--plan--change-requests'), '/rnd:plan');
		assert.equal(gateCommand('rnd--review--change-requests--code'), '/rnd:review (code)');
		assert.equal(gateCommand('rnd--review--change-requests'), '/rnd:review (acceptance)');
	});

	test('every stage at its own state: no contradiction', () => {
		for (const s of STAGES) assert.deepEqual(stageContradictions(at[s], s), [], s);
	});

	// each row of the contradiction table: one firing case and one quiet one
	const ROWS = [
		['status implemented excludes all but done', at.done, 'live-check', at.done, 'done'],
		['done needs status implemented', at['live-check'], 'done', at.done, 'done'],
		['status rejected excludes all but rejected', at.rejected, 'design', at.rejected, 'rejected'],
		['rejected needs status rejected', at.acceptance, 'rejected', at.rejected, 'rejected'],
		['status suggested excludes plan … live-check', at.acceptance, 'plan', at.plan, 'plan'],
		['acceptance needs status suggested', at.plan, 'acceptance', at.acceptance, 'acceptance'],
		['accepted_on set excludes acceptance', { ...at.acceptance, accepted_on: T }, 'acceptance', at.acceptance, 'acceptance'],
		['accepted_on empty excludes plan … live-check', { ...at.plan, accepted_on: undefined }, 'plan', at.plan, 'plan'],
		['tested_on set excludes design … test', { ...at.test, tested_on: T }, 'test', at.test, 'test'],
		['tested_on empty excludes test-review', at.test, 'test-review', at['test-review'], 'test-review'],
		['verified_on set excludes design … test-review', { ...at['test-review'], verified_on: T }, 'test-review', at['test-review'], 'test-review'],
		['verified_on empty excludes deploy and live-check', at['test-review'], 'deploy', at.deploy, 'deploy'],
		['deployed_on set excludes design … code-review', { ...at['code-review'], deployed_on: T }, 'code-review', at['code-review'], 'code-review'],
		['deployed_on empty excludes live-check', at.deploy, 'live-check', at['live-check'], 'live-check'],
		['design_docs set excludes design', at['design-review'], 'design', at.design, 'design'],
		['design_docs empty excludes design-review and acceptance', at.design, 'design-review', at['design-review'], 'design-review'],
		['implementation_plans set excludes design … plan', at['plan-review'], 'plan', at.plan, 'plan'],
		['implementation_plans empty excludes plan-review … live-check', at.plan, 'plan-review', at['plan-review'], 'plan-review'],
	];
	for (const [name, firing, s1, quiet, s2] of ROWS) {
		test(`contradiction row: ${name}`, () => {
			assert.ok(stageContradictions(firing, s1).length > 0, `${s1} on the firing record`);
			assert.deepEqual(stageContradictions(quiet, s2), [], `${s2} on the quiet record`);
		});
	}

	test('the two null-gate scenarios contradict the record', () => {
		// an accepted request whose plan was abandoned, dragged to done
		assert.match(stageContradictions(at.implement, 'done').join(' '), /done needs status implemented/);
		// a suggested request with accepted_on set, at acceptance
		assert.match(stageContradictions({ ...at.acceptance, accepted_on: T }, 'acceptance').join(' '), /accepted_on/);
	});

	test('a deployed request sent back (verified_on cleared) may stand at test or test-review, not live-check', () => {
		const back = { ...at['live-check'], verified_on: undefined };
		assert.deepEqual(stageContradictions(back, 'test-review'), []);
		assert.deepEqual(stageContradictions({ ...back, tested_on: undefined }, 'test'), []);
		assert.ok(stageContradictions(back, 'live-check').length > 0);
		assert.ok(stageContradictions(back, 'deploy').length > 0);
	});

	test('allowedStages: what the contradiction table still allows', () => {
		assert.deepEqual(allowedStages(at.implement), ['plan-review', 'implement', 'code-review', 'test']);
		assert.deepEqual(allowedStages(at.done), ['done']);
	});

	test('stageWarnings: at most one per request — gate first, then a contradiction, then empty; a layer\'s empty stage is skipped', () => {
		const rows = [
			{ id: 'ok', file: 'ok.md', stage: 'plan', expected: 'plan', gate: 'rnd--plan--change-requests', fields: at.plan },
			{ id: 'gate', file: 'gate.md', stage: 'design-review', expected: 'plan', gate: 'rnd--plan--change-requests', fields: at.plan },
			{ id: 'contra', file: 'contra.md', stage: 'done', expected: null, gate: null, fields: at.implement },
			{ id: 'empty', file: 'empty.md', stage: undefined, expected: 'plan', gate: 'rnd--plan--change-requests', fields: at.plan },
			{ id: 'nogate', file: 'nogate.md', stage: undefined, expected: null, gate: null, fields: at.implement },
			{ id: 'layer', file: 'layer.md', stage: undefined, expected: 'plan', gate: 'rnd--plan--change-requests', fields: at.plan, inLayer: true },
			{ id: 'layer-wrong', file: 'lw.md', stage: 'test', expected: 'plan', gate: 'rnd--plan--change-requests', fields: at.plan, inLayer: true },
		];
		const w = stageWarnings(rows);
		assert.deepEqual(w.map((x) => [x.file, x.warning]), [['gate.md', true], ['contra.md', true], ['empty.md', true], ['nogate.md', true], ['lw.md', true]]);
		assert.equal(w[0].message, 'stage is design-review but the record is at plan — dt next names /rnd:plan; set stage=plan');
		assert.match(w[1].message, /^stage is done but done needs status implemented .* — the record allows plan-review · implement · code-review · test; set stage to one of them$/);
		assert.equal(w[2].message, 'stage is empty; the record is at plan (dt next names /rnd:plan) — run migrate-change-request-stage, or set stage=plan');
		assert.equal(w[3].message, 'stage is empty and no gate is open — the record allows plan-review · implement · code-review · test; set stage by hand');
	});
});
