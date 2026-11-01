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
		assert.deepEqual(crDescriptor.display.list.columns, ['created', 'status', 'stage', 'name', 'tags', 'products', 'release']);
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

describe('dt check: deployed and deployed_on agree, as a warning', async () => {
	const { stageTagWarnings, checkStageTags } = await import(path.join(RND, 'lib', 'stage-tags.mjs'));
	const engineApi = await import(path.join(ENGINE, 'src', 'api.js'));
	const HAS_CHANNEL = engineApi.CHECK_WARNINGS === true;

	test('the rule: both directions warn, a consistent pair and a look-alike tag do not', () => {
		const w = stageTagWarnings([
			{ id: 'a', tags: ['designed', 'deployed'], file: 'a.md' },
			{ id: 'b', tags: ['implemented'], deployed_on: '2026-03-02T10:00:00+02:00', file: 'b.md' },
			{ id: 'c', tags: ['deployed'], deployed_on: '2026-03-02T10:00:00+02:00', file: 'c.md' },
			{ id: 'd', tags: ['deployed-staging'], file: 'd.md' },
			{ id: 'e', file: 'e.md' },
		]);
		assert.deepEqual(w.map((x) => [x.file, x.warning]), [['a.md', true], ['b.md', true]]);
		assert.match(w[0].message, /^tagged deployed but deployed_on is empty/);
		assert.match(w[1].message, /^deployed_on is set but the record is not tagged deployed/);
	});

	test('on an engine without the warning channel the check returns nothing — never a violation', () => {
		let read = false;
		const dt = { Store: class { constructor() { read = true; } } };
		assert.deepEqual(checkStageTags({ ws: { root: '/x' }, dt }), []);
		assert.equal(read, false, 'the store is not even opened');
	});

	test('dt check end to end, on the engine under test', { skip: false }, () => {
		const root = rndWorkspace();
		product(root);
		request(root, 'cr-tagged', 'tags:\n  - deployed\n');
		request(root, 'cr-dated', 'deployed_on: \'2026-03-02T10:00:00+02:00\'\nstatus: implemented\n');
		request(root, 'cr-both', 'tags:\n  - deployed\n  - client:northwind\ndeployed_on: \'2026-03-02T10:00:00+02:00\'\n');
		settle(root);
		const r = run(root, ['check']);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		if (!HAS_CHANNEL) {
			// published engines before the channel: the rule is silent rather than red
			assert.doesNotMatch(r.stdout, /deployed_on/);
			test.diagnostic?.(`engine ${engineApi.engineVersion?.()} has no CHECK_WARNINGS — the warning half runs with DT_ENGINE_DIR at the check-warnings branch`);
			return;
		}
		assert.match(r.stdout, /⚠ data\/rnd\/change-requests\/cr-tagged\.change-request\.md — tagged deployed but deployed_on is empty — set deployed_on, or remove the tag \(@dreamteamer\/rnd\)/);
		assert.match(r.stdout, /⚠ data\/rnd\/change-requests\/cr-dated\.change-request\.md — deployed_on is set but the record is not tagged deployed/);
		// cr-both is consistent on the tag rule; rnd's stage rule (lib/cr-stage.mjs) may still name it, for its empty stage
		assert.doesNotMatch(r.stdout, /cr-both\.change-request\.md — (tagged deployed|deployed_on is set)/);
		assert.match(r.stdout, /✔ 0 violations/);
	});
});

describe('the lifecycle skills set the stage tags, keeping every other tag', () => {
	const skill = (s) => fs.readFileSync(path.join(RND, 'skills', s, 'SKILL.md'), 'utf8');
	const KEEP = /tags=<each existing>/;
	const REPLACES = /replaces the list/;
	for (const [s, tag] of [['rnd-design', 'designed'], ['rnd-implement', 'implemented'], ['rnd-test', 'tested'], ['rnd-deploy', 'deployed']]) {
		test(`${s} adds ${tag}, read-then-write, never a bare tags=${tag} or a +=`, () => {
			const text = skill(s);
			assert.match(text, new RegExp(`tags=<each existing> tags=${tag}\\b`), `${s} spells the write keeping the existing tags`);
			assert.match(text, KEEP);
			assert.match(text, REPLACES, `${s} says a dt set of tags replaces the list`);
			assert.doesNotMatch(text, /tags\+=/);
			assert.doesNotMatch(text, new RegExp(`\\stags=${tag}\\b(?<!<each existing> tags=${tag})`), 'no write of the stage tag alone');
		});
	}
	test('rnd-deploy writes deployed in the same dt set as deployed_on, before any live review', () => {
		const text = skill('rnd-deploy');
		assert.match(text, /dt set rnd\/change-requests\/<id> deployed_on=<now> tags=<each existing> tags=deployed/);
		assert.match(text, /before (you file |filing )?(a|any) live acceptance review/i);
	});
	test('rnd-release stamps deployed with deployed_on on every request a published release carries', () => {
		assert.match(skill('rnd-release'), /dt set rnd\/change-requests\/<cr> deployed_on=<published_on> tags=<each existing> tags=deployed/);
	});
	test('rnd-test writes tested in the same dt set as tested_on', () => {
		assert.match(skill('rnd-test'), /dt set rnd\/change-requests\/<id> tested_on=<now> tags=<each existing> tags=tested/);
	});
	/* code review finding stage-rerun-duplicates-the-tag: a stage run again (a fix after changes-requested) must not list its
	   tag twice, so every write says the existing tags are taken WITHOUT the stage's own */
	for (const [s2, tag] of [['rnd-design', 'designed'], ['rnd-implement', 'implemented'], ['rnd-test', 'tested'], ['rnd-deploy', 'deployed'], ['rnd-release', 'deployed']]) {
		test(`${s2}: a re-run lists ${tag} once — the existing tags are taken without it`, () => {
			assert.match(skill(s2), new RegExp(`<each existing>\` is every tag it already has except \`${tag}\``));
		});
	}
	/* code review finding clearing-a-stamp-keeps-the-tag: the inverse steps take the tag off with the stamp */
	test('rnd-release rollback drops deployed with deployed_on', () => {
		assert.match(skill('rnd-release'), /deployed_on= tags=<each existing> release=/);
		assert.match(skill('rnd-release'), /drops `deployed` with `deployed_on`/);
	});
	test('rnd-test clearing a stale tested_on drops tested with it', () => {
		assert.match(skill('rnd-test'), /clear a stale one \(`tested_on= tags=<each existing>`/);
	});
	test('rnd-test: a manual test the request names as a person\'s, left planned, does not withhold tested', () => {
		assert.match(skill('rnd-test'), /`manual` test[^.]*left `planned`[^.]*does not withhold `tested`/);
	});
});

describe('the 0.7.0 release', () => {
	const read = (f) => fs.readFileSync(path.join(RND, f), 'utf8');
	test('released as 0.7.0, with UPDATING.md and the README release note, the engine floor unmoved', () => {
		const pkg = JSON.parse(read('package.json'));
		// the warning is silent on an engine without CHECK_WARNINGS, so the floor does not move
		assert.equal(pkg.dreamteamer.engine, '>=0.38.0');
		assert.match(read('UPDATING.md'), /## 0\.7\.0 — /);
		assert.doesNotMatch(read('UPDATING.md'), /## Unreleased/);
		assert.match(read('README.md'), /## 0\.7\.0 — from 0\.6\.0/);
	});
});
