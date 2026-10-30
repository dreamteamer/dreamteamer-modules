// migrate-journey-steps — what a fixture can pin: the plan over a synthetic workspace, the write, the no-op
// second run, each refusal, --screen-rules on a comma string and on a list, bytes outside the moved keys kept,
// and — on a real engine workspace — `dt check` exiting 0 on what the migration wrote.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { plan, main, dropKeys, addBlock, planLine } from '../bin/migrate-journey-steps.mjs';
import { rndWorkspace, seedNorthwind, settle, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); cleanupAll(); });
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const front = (root, rel) => yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(read(root, rel))[1]);
const quiet = () => { const out = []; return { out, log: (l) => out.push(l), error: (l) => out.push(l) }; };

const J = 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md';
const S = (k) => `data/rnd/user-stories/2026-01-10--${k}.user-story.md`;

/** A pre-0.5.0 workspace: three stories ordered on one journey by journey/step, one story standing alone. */
function legacy(root) {
	seedNorthwind(root);
	put(root, J, '---\nkey: apply-for-a-grant\nname: Apply for a grant\nproducts:\n  - rnd/products/grantee-portal\n---\nThe journey body.\n');
	const add = (k, extra) => { const f = path.join(root, S(k)); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n---\n$/, `\n${extra}---\n`)); };
	add('open-the-portal', 'journey: apply-for-a-grant\nstep: 1\n');
	add('review-the-application', 'journey: apply-for-a-grant\nstep: 3\n');
	add('submit-an-application', 'journey: apply-for-a-grant\nstep: 2\n');
	return root;
}
function bare() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-steps-')); made.push(root);
	put(root, 'package.json', '{"name":"northwind","private":true}\n'); put(root, 'package-lock.json', '{}\n');
	return legacy(root);
}

describe('the line-level edits', () => {
	test('dropKeys removes a key with its continuation lines and keeps every other byte, CRLF included', () => {
		const text = '---\r\nname: x\r\nverified_on: 2026-01-05\r\njourney: >-\r\n  a folded\r\n  value\r\nstep: 2\r\ntags:\r\n  - a\r\n---\r\nbody\r\n';
		assert.equal(dropKeys(text, ['journey', 'step']), '---\r\nname: x\r\nverified_on: 2026-01-05\r\ntags:\r\n  - a\r\n---\r\nbody\r\n');
	});
	test('dropKeys leaves a file with mixed line endings mixed: only the moved keys go', () => {
		assert.equal(dropKeys('---\nname: x\r\njourney: a\nstep: 2\r\ntags:\n  - a\r\n---\n', ['journey', 'step']), '---\nname: x\r\ntags:\n  - a\r\n---\n');
		assert.equal(dropKeys('---\nname: x\r\nstep: 2\n---\n', ['step']), '---\nname: x\n---\n');
	});
	test('dropKeys removes a list written at column zero under its key', () => {
		assert.equal(dropKeys('---\nrule:\n- A\n- B\nname: x\n---\n', ['rule']), '---\nname: x\n---\n');
	});
	test('addBlock appends a dumped block before the closing fence in the file\'s own line ending', () => {
		assert.equal(addBlock('---\r\nname: x\r\n---\r\n', 'steps', [{ screen: 'rnd/screens/a' }]), '---\r\nname: x\r\nsteps:\r\n  - screen: rnd/screens/a\r\n---\r\n');
	});
});

describe('the plan', () => {
	test('orders the stories by step into steps with the stored reference forms, and is a read', () => {
		const root = bare();
		const before = read(root, J);
		const p = plan(root);
		assert.equal(planLine(p), 'journeys 1 · steps 3 · stories cleared 3 · screens 0');
		assert.deepEqual(p.problems, []);
		assert.equal(read(root, J), before);
		const text = p.journeyWrites[0].text;
		const steps = yaml.load(/^---\n([\s\S]*?)\n---/.exec(text)[1]).steps;
		assert.deepEqual(steps, [
			{ screen: 'rnd/screens/gp-home', story: 'rnd/user-stories/2026-01-10--open-the-portal', persona: 'rnd/personas/applicant' },
			{ screen: 'rnd/screens/gp-apply', story: 'rnd/user-stories/2026-01-10--submit-an-application', persona: 'rnd/personas/applicant' },
			{ screen: 'rnd/screens/bo-review', story: 'rnd/user-stories/2026-01-10--review-the-application', persona: 'rnd/personas/grant-officer' },
		]);
		assert.ok(text.endsWith('---\nThe journey body.\n'), 'the body is untouched');
	});
	test('--write moves the order, clears the legacy fields, and a second run is a no-op', () => {
		const root = bare(); const q = quiet();
		assert.equal(main(['--write', '--root', root], q), 0);
		assert.match(q.out.join('\n'), /journeys 1 · steps 3 · stories cleared 3 · screens 0/);
		assert.equal(front(root, J).steps.length, 3);
		for (const k of ['open-the-portal', 'submit-an-application', 'review-the-application']) {
			const fm = front(root, S(k)); assert.equal(fm.journey, undefined); assert.equal(fm.step, undefined); assert.ok(fm.screen);
		}
		const again = quiet();
		assert.equal(main(['--write', '--root', root], again), 0);
		assert.match(again.out.join('\n'), /journeys 0 · steps 0 · stories cleared 0 · screens 0/);
	});
	test('--screen-rules folds a comma string or a list into scope_rows and drops the field', () => {
		const root = bare();
		const scr = (k) => `data/rnd/screens/${k}.screen.md`;
		fs.writeFileSync(path.join(root, scr('gp-home')), read(root, scr('gp-home')).replace(/\n---\n$/, '\nrule: GRT-R-005, GRT-R-006\n---\n'));
		fs.writeFileSync(path.join(root, scr('gp-apply')), read(root, scr('gp-apply')).replace(/\n---\n$/, '\nrule:\n  - GRT-R-002\n  - GRT-R-003\n---\n'));
		assert.equal(main(['--write', '--root', root, '--screen-rules', 'rule'], quiet()), 0);
		assert.deepEqual(front(root, scr('gp-home')).scope_rows, ['GRT-R-005', 'GRT-R-006']);
		assert.deepEqual(front(root, scr('gp-apply')).scope_rows, ['GRT-R-001', 'GRT-R-002', 'GRT-R-003']);
		assert.equal(front(root, scr('gp-apply')).rule, undefined);
	});
});

describe('the refusals — --write exits 1 and writes nothing', () => {
	const refuses = (mutate, pattern) => {
		const root = bare(); mutate(root);
		const snapshot = (dir) => Object.fromEntries([...fs.readdirSync(dir, { recursive: true })].filter((f) => f.endsWith('.md')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
		const before = snapshot(path.join(root, 'data'));
		const q = quiet();
		assert.equal(main(['--write', '--root', root], q), 1);
		assert.match(q.out.join('\n'), pattern);
		assert.deepEqual(snapshot(path.join(root, 'data')), before);
	};
	const edit = (root, rel, from, to) => fs.writeFileSync(path.join(root, rel), read(root, rel).replace(from, to));
	test('two stories claiming one step', () => refuses((r) => edit(r, S('review-the-application'), 'step: 3', 'step: 2'), /step 2 of journey "apply-for-a-grant" is also claimed/));
	test('a story on a journey with no screen', () => refuses((r) => edit(r, S('open-the-portal'), /screen: .*\n/, ''), /with no screen/));
	test('a story on a journey with no step', () => refuses((r) => edit(r, S('open-the-portal'), 'step: 1\n', ''), /with no step/));
	test('a journey key no journey record has', () => refuses((r) => edit(r, S('open-the-portal'), 'journey: apply-for-a-grant', 'journey: renew-a-grant'), /"renew-a-grant" names no rnd\/user-journeys record/));
	test('a story with no journey is never read, and one on a journey that already has steps is reported, unchanged', () => {
		const root = bare();
		edit(root, J, 'name: Apply for a grant\n', 'name: Apply for a grant\nsteps:\n  - screen: rnd/screens/gp-home\n');
		const before = read(root, S('open-the-portal'));
		const q = quiet();
		assert.equal(main(['--write', '--root', root], q), 0);
		assert.match(q.out.join('\n'), /already has steps — left unchanged/);
		assert.equal(read(root, S('open-the-portal')), before);
	});
});

describe('on a real engine', () => {
	test('the migrated workspace checks clean', () => {
		const root = legacy(rndWorkspace());
		assert.equal(main(['--write', '--root', root], quiet()), 0);
		settle(root);
		const c = run(root, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		const rows = JSON.parse(run(root, ['list', 'rnd/user-journeys', '--json']).stdout);
		assert.equal(rows[0].steps[2].story, 'rnd/user-stories/2026-01-10--review-the-application');
	});
});
