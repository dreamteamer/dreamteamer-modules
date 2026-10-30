// The schema half of the prototype harness: `steps` and `failures` on rnd/user-journeys. What a fixture can
// pin: the engine validates a step's typed references (a dangling screen, a missing screen) and returns the
// object list intact from `dt list --json`, which is the only thing the bridge reads.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { rndWorkspace, seedNorthwind, settle, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';

after(cleanupAll);
const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (rel) => yaml.load(fs.readFileSync(path.join(RND, rel), 'utf8'));

const journey = (steps, extra = '') => `---\nkey: apply-for-a-grant\nname: Apply for a grant\nproducts:\n  - rnd/products/grantee-portal\n  - rnd/products/back-office\n${steps}${extra}---\n`;
const GOOD = 'steps:\n  - screen: rnd/screens/gp-home\n    story: rnd/user-stories/2026-01-10--open-the-portal\n    persona: rnd/personas/applicant\n    caption: The portal opens\n  - screen: rnd/screens/gp-apply\n    story: rnd/user-stories/2026-01-10--submit-an-application\n    scope_rows:\n      - GRT-R-001\n  - screen: rnd/screens/bo-review\n    system: true\n    caption: The system routes the application\n';

describe('the descriptors', () => {
	const uj = load('collections/rnd/user-journeys.collection.yaml');
	test('steps is an ordered object list whose screen is a required typed reference', () => {
		const s = uj.fields.steps;
		assert.equal(s.type, 'object'); assert.equal(s.many, true); assert.equal(s.item_title, '{{ screen }}');
		assert.deepEqual(Object.keys(s.fields), ['screen', 'story', 'persona', 'system', 'caption', 'scope_rows', 'open']);
		assert.equal(s.fields.screen.type, 'rnd/screens'); assert.equal(s.fields.screen.required, true);
		assert.equal(s.fields.story.type, 'rnd/user-stories');
		assert.equal(s.fields.persona.type, 'rnd/personas');
		assert.equal(s.fields.open.type, 'rnd/open-questions'); assert.equal(s.fields.open.many, true);
		assert.equal(s.fields.scope_rows.many, true);
	});
	test('failures is a string list, and the legacy story order says it is legacy', () => {
		assert.deepEqual([uj.fields.failures.type, uj.fields.failures.many], ['string', true]);
		const us = load('collections/rnd/user-stories.collection.yaml');
		for (const f of ['journey', 'step']) assert.match(us.fields[f].description, /legacy/i);
		assert.match(us.fields.journey.description, /rnd\/user-journeys\.steps/);
	});
	test('scope_rows carries a rule-id example and blocks names the metadata layer', () => {
		assert.ok(load('collections/rnd/screens.collection.yaml').fields.scope_rows.examples.includes('GRT-R-062'));
		assert.match(load('collections/rnd/open-questions.collection.yaml').fields.blocks.description, /metadata layer/);
	});
});

describe('the engine over steps', () => {
	test('a journey with valid steps checks clean and lists its steps intact', () => {
		const root = rndWorkspace(); seedNorthwind(root);
		put(root, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md', journey(GOOD, 'failures:\n  - The deadline has passed\n'));
		settle(root);
		const c = run(root, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		const rows = JSON.parse(run(root, ['list', 'rnd/user-journeys', '--json']).stdout);
		assert.equal(rows[0].steps.length, 3);
		assert.deepEqual(rows[0].steps[1], { screen: 'rnd/screens/gp-apply', story: 'rnd/user-stories/2026-01-10--submit-an-application', scope_rows: ['GRT-R-001'] });
		assert.equal(rows[0].steps[2].system, true);
		assert.deepEqual(rows[0].failures, ['The deadline has passed']);
	});
	test('a dangling screen fails check, naming it', () => {
		const root = rndWorkspace(); seedNorthwind(root);
		put(root, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md', journey('steps:\n  - screen: rnd/screens/nowhere\n'));
		settle(root);
		const c = run(root, ['check']);
		assert.notEqual(c.status, 0);
		assert.match(c.stdout + c.stderr, /steps\.screen: dangling reference "rnd\/screens\/nowhere"/);
	});
	test('a step with no screen fails check', () => {
		const root = rndWorkspace(); seedNorthwind(root);
		put(root, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md', journey('steps:\n  - system: true\n'));
		settle(root);
		const c = run(root, ['check']);
		assert.notEqual(c.status, 0);
		assert.match(c.stdout + c.stderr, /must have required property 'screen'/);
	});
});
