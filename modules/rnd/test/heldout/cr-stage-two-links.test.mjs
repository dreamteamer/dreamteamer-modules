// HELD-OUT (cr-modules-006-h2-two-plans-two-designs): a request with two plans (one abandoned) or two designs
// (one draft, one active) — what the check and the migration say. Written by the test stage from the review's steps.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { rndWorkspace, run, cleanupAll } from '../helpers/rnd-workspace.mjs';
import { product, doc, plan, req, reqFile, settle, linesFor, stageLines, migrate, accepted, designs } from './lib/cr-stage-records.mjs';

after(() => cleanupAll());

const available = (root, id) => {
	const j = JSON.parse(run(root, ['next', `rnd/change-requests/${id}`, '--json']).stdout);
	return (j.commands ?? j).filter((c) => c.states?.[id] === 'available').map((c) => String(c.binding).replace(/^command-bindings\//, ''));
};

test('h2 — two plans, two designs', () => {
	const root = rndWorkspace();
	product(root);
	doc(root, 'act', 'active');
	doc(root, 'dra', 'draft');
	for (const [id, st] of [['tp-plan-review', 'plan-review'], ['tp-implement', 'implement'], ['tp-empty', null]]) {
		req(root, id, [...accepted, designs('act'), st && `stage: ${st}`]);
		plan(root, `${id}-old`, id, 'abandoned');
		plan(root, `${id}-new`, id, 'draft');
	}
	req(root, 'ta-implement', [...accepted, designs('act'), 'stage: implement']);
	plan(root, 'ta-old', 'ta-implement', 'abandoned');
	plan(root, 'ta-new', 'ta-implement', 'approved');
	for (const [id, st] of [['td-design-review', 'design-review'], ['td-acceptance', 'acceptance'], ['td-empty', null]]) {
		req(root, id, ['status: suggested', designs('dra', 'act'), st && `stage: ${st}`]);
	}
	settle(root);

	// sanity — what dt next says
	assert.deepEqual(available(root, 'tp-empty').filter((b) => b.startsWith('rnd--')).sort(), ['rnd--review--change-requests--plan']);
	const tdAvail = available(root, 'td-empty');
	test.diagnostic?.(`two designs: dt next available = ${tdAvail.join(', ')}`);
	assert.ok(tdAvail.includes('rnd--review--change-requests--design'), `the draft design's review is open: ${tdAvail}`);
	assert.ok(tdAvail.includes('rnd--review--change-requests'), `the acceptance review is open: ${tdAvail}`);

	const c = run(root, ['check']);
	assert.equal(c.status, 0, c.stdout + c.stderr);
	assert.deepEqual(linesFor(c.stdout, 'tp-plan-review'), []);
	assert.match(linesFor(c.stdout, 'tp-implement').join('\n'), /stage is implement but the record is at plan-review — dt next names \/rnd:review \(plan\); set stage=plan-review/);
	assert.match(linesFor(c.stdout, 'tp-empty').join('\n'), /stage is empty; the record is at plan-review/);
	assert.deepEqual(linesFor(c.stdout, 'ta-implement'), []);
	assert.deepEqual(linesFor(c.stdout, 'td-design-review'), []);
	assert.match(linesFor(c.stdout, 'td-acceptance').join('\n'), /design-review/);
	assert.match(linesFor(c.stdout, 'td-empty').join('\n'), /design-review/);

	const before = fs.readdirSync(`${root}/data/rnd/change-requests`).map((f) => fs.readFileSync(`${root}/data/rnd/change-requests/${f}`, 'utf8'));
	const dry = migrate(root);
	assert.equal(dry.code, 0, dry.out + dry.err);
	const plans = dry.out.split('\n').filter((l) => l.startsWith('would set'));
	assert.deepEqual(plans.sort(), [
		'would set rnd/change-requests/td-acceptance stage=design-review (was acceptance)',
		'would set rnd/change-requests/td-empty stage=design-review (was empty)',
		'would set rnd/change-requests/tp-empty stage=plan-review (was empty)',
		'would set rnd/change-requests/tp-implement stage=plan-review (was implement)',
	]);
	assert.doesNotMatch(dry.out, /cannot tell/);
	assert.deepEqual(fs.readdirSync(`${root}/data/rnd/change-requests`).map((f) => fs.readFileSync(`${root}/data/rnd/change-requests/${f}`, 'utf8')), before);
	assert.equal(migrate(root, { args: ['--write'] }).code, 0);
	const c2 = run(root, ['check']);
	assert.equal(c2.status, 0);
	assert.deepEqual(stageLines(c2.stdout), []);
	assert.doesNotMatch(migrate(root).out, /would set/);
	assert.ok(fs.existsSync(reqFile(root, 'td-empty')));
});
