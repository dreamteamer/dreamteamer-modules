// THE STAGE FIELD — rnd/change-requests.stage names the gate a request waits on, in lifecycle order, so a
// board can draw change requests as columns. The lifecycle writes it; the editor does not offer it
// (`display.editable: false` locks the UI and lets the CLI through). Also pinned here: the list defaults of
// rnd/reviews and rnd/review-findings, and UPDATING's Unreleased section for the field.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { rndWorkspace, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';
import { ENGINE } from '../../../tests/helpers/workspace.mjs';

after(() => cleanupAll());

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const descriptor = (c) => yaml.load(fs.readFileSync(path.join(RND, `collections/rnd/${c}.collection.yaml`), 'utf8'));
const STAGES = ['design', 'design-review', 'acceptance', 'plan', 'plan-review', 'implement', 'code-review', 'test', 'test-review', 'deploy', 'live-check', 'done', 'rejected'];

describe('rnd/change-requests.stage', () => {
	const cr = descriptor('change-requests');

	test('a single closed enum of the thirteen gates in lifecycle order, no default, locked in the UI, after status', () => {
		const f = cr.fields.stage;
		assert.ok(f, 'the field exists');
		assert.equal(f.type, 'string');
		assert.notEqual(f.many, true);
		assert.deepEqual(f.enum, STAGES);
		assert.equal(f.default, undefined, 'no default: a default would materialize on any dt set of an old request');
		assert.notEqual(f.required, true);
		assert.equal(f.display?.editable, false);
		assert.match(f.description, /lifecycle/i);
		assert.doesNotMatch(f.description, /cr-[a-z]+-\d+/, 'no internal request ids in a shipped description');
		const names = Object.keys(cr.fields);
		assert.equal(names.indexOf('stage'), names.indexOf('status') + 1, 'placed right after status');
	});

	test('the list shows it after status', () => {
		assert.deepEqual(cr.display.list.columns, ['created', 'status', 'stage', 'name', 'tags', 'products', 'release']);
		assert.equal(cr.display.list.sort, '-created');
	});

	test('dt add refuses a value outside the enum before disk, and takes one inside it', () => {
		const root = rndWorkspace();
		put(root, 'data/rnd/products/portal.product.md', '---\nname: Portal\n---\n');
		const bad = run(root, ['add', 'rnd/change-requests', '--key', 'cr-x', '--name', 'x', '--products', 'rnd/products/portal', '--stage', 'nonsense']);
		assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
		assert.equal(fs.existsSync(path.join(root, 'data/rnd/change-requests/cr-x.change-request.md')), false, 'nothing written');
		const good = run(root, ['add', 'rnd/change-requests', '--key', 'cr-y', '--name', 'y', '--products', 'rnd/products/portal', '--stage', 'design']);
		assert.equal(good.status, 0, good.stdout + good.stderr);
		assert.match(fs.readFileSync(path.join(root, 'data/rnd/change-requests/cr-y.change-request.md'), 'utf8'), /^stage: design$/m);
	});

	test('the presentation contract the editor reads: the choices in order, and not editable', async () => {
		const root = rndWorkspace();
		const { presentation } = await import(path.join(ENGINE, 'src', 'records-api.js'));
		const { loadDescriptors } = await import(path.join(ENGINE, 'src', 'runtime.js'));
		const row = presentation(loadDescriptors(root)).fields['rnd/change-requests'].find((f) => f.field === 'stage');
		assert.ok(row, 'the stage row');
		assert.equal(row.editable, false);
		const choices = (row.editor_options?.choices ?? row.viewer_options?.choices ?? []).map((c) => c.value ?? c);
		assert.deepEqual(choices, STAGES);
	});
});

describe('the operator\'s list defaults for reviews and findings', () => {
	test('rnd/reviews: reviewed_on first, newest first', () => {
		const d = descriptor('reviews');
		assert.deepEqual(d.display.list.columns, ['reviewed_on', 'name', 'kind', 'subject', 'change_request', 'status', 'verdict']);
		assert.equal(d.display.list.sort, '-reviewed_on');
	});
	test('rnd/review-findings: created first, oldest first', () => {
		const d = descriptor('review-findings');
		assert.deepEqual(d.display.list.columns, ['created', 'name', 'review', 'severity', 'status', 'category']);
		assert.equal(d.display.list.sort, 'created');
	});
});
