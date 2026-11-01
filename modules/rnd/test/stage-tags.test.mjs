// THE STAGE TAGS — a change request carries `designed`, `implemented`, `tested`, `deployed` in its
// free `tags`, the descriptor declares how a surface draws them (`display.viewer: stage-checks`, the
// stages and the reviews that belong to each), and `dt check` warns when `deployed` and `deployed_on`
// disagree. What a fixture can pin: the field, the declaration reaching the presentation contract the
// editor reads, the warning rule, and the skills' wording. The drawing itself is the extension's.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { rndWorkspace, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';
import { ENGINE } from '../../../tests/helpers/workspace.mjs';

after(() => cleanupAll());

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const crDescriptor = yaml.load(fs.readFileSync(path.join(RND, 'collections/rnd/change-requests.collection.yaml'), 'utf8'));
const STAGES = ['designed', 'implemented', 'tested', 'deployed'];

const request = (root, key, extra = '') => put(root, `data/rnd/change-requests/${key}.change-request.md`,
	`---\nkey: ${key}\nname: ${key}\nproducts:\n  - rnd/products/portal\n${extra}---\n`);
const product = (root) => put(root, 'data/rnd/products/portal.product.md', '---\nname: Portal\n---\n');
/** Regenerate the product's generated `change_requests`, so `dt check` judges only what a test wrote. */
const settle = (root) => { const r = run(root, ['relations', 'rebuild', 'rnd/products']); assert.equal(r.status, 0, r.stderr + r.stdout); };

describe('rnd/change-requests.tags and its stage declaration', () => {
	test('the descriptor: free tags, the four stages declared in order for the stage-checks viewer, tags a list column', () => {
		const tags = crDescriptor.fields.tags;
		assert.equal(tags.many, true);
		assert.equal(tags.display.viewer, 'stage-checks');
		const o = tags.display.options;
		assert.equal(o.reviews_from, 'rnd/reviews');
		assert.equal(o.findings_from, 'rnd/review-findings');
		assert.deepEqual(o.stages.map((s) => s.tag), STAGES);
		const by = Object.fromEntries(o.stages.map((s) => [s.tag, s.reviews]));
		assert.deepEqual(by.designed, [{ kind: ['design'], subject: 'design_docs', since: 'created' }, { kind: ['acceptance'], subject: 'self', before: 'deployed_on' }]);
		assert.deepEqual(by.implemented, [{ kind: ['code', 'security'], subject: 'implementation_plans' }, { kind: ['code', 'security'], subject: 'self' }]);
		assert.deepEqual(by.tested, [{ kind: ['test'], subject: 'self' }, { kind: ['test'], subject: 'implementation_plans' }]);
		assert.deepEqual(by.deployed, [{ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }]);
		// every field a matcher names is a field of the request (or self)
		for (const s of o.stages) for (const m of s.reviews) for (const k of ['subject', 'since', 'before']) {
			if (m[k] && m[k] !== 'self' && m[k] !== 'created') assert.ok(crDescriptor.fields[m[k]], `${s.tag}: ${k} names ${m[k]}, not a field`);
		}
		assert.deepEqual(crDescriptor.display.list.columns, ['created', 'status', 'name', 'tags', 'products', 'release']);
	});

	test('a request with stage and free tags checks clean; a tag that breaks the convention is refused', () => {
		const root = rndWorkspace();
		product(root);
		request(root, 'cr-1', 'tags:\n  - designed\n  - client:northwind\n');
		settle(root);
		const ok = run(root, ['check']);
		assert.equal(ok.status, 0, ok.stdout + ok.stderr);
		const list = run(root, ['list', 'rnd/change-requests', '--json']);
		assert.deepEqual(JSON.parse(list.stdout)[0].tags, ['designed', 'client:northwind']);
		const bad = run(root, ['add', 'rnd/change-requests', '--key', 'cr-2', '--name', 'cr-2', '--products', 'rnd/products/portal', '--tags', 'Deployed']);
		assert.notEqual(bad.status, 0, 'an uppercase tag is refused before disk');
	});

	test('the declaration reaches the presentation contract the editor reads, as the field row\'s viewer and viewer_options', async () => {
		const root = rndWorkspace();
		const { presentation } = await import(path.join(ENGINE, 'src', 'records-api.js'));
		const { loadDescriptors } = await import(path.join(ENGINE, 'src', 'runtime.js'));
		const p = presentation(loadDescriptors(root));
		const row = p.fields['rnd/change-requests'].find((f) => f.field === 'tags');
		assert.equal(row.viewer, 'stage-checks');
		assert.deepEqual(row.viewer_options.stages.map((s) => s.tag), STAGES);
		assert.equal(row.viewer_options.reviews_from, 'rnd/reviews');
	});
});
