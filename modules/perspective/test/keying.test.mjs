// Three layers, and the layer decides the key.
//
// A model id that began with the RUN — `activities/2026-09-08--dana-o/…` — would make a
// retrospective three months later write a SECOND copy of the same person's projects, topics and
// goals beside the first: idempotent per record, not per model. Evidence and model records are keyed by the CONTRIBUTOR and updated in place by every later
// session. Questions and proposals stay keyed by the run, because they ARE the sitting: an interview
// belongs to the day it happened and a proposal is what THAT session recommended.
//
// The keying table below is the one the readers use; a reader that disagreed would write ids
// the descriptors reject, so keep them in one place: this test is that place.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective', 'collections', 'perspective');
const load = (n) => yaml.load(fs.readFileSync(path.join(DIR, `${n}.collection.yaml`), 'utf8'));

/** Every descriptor under `collections/perspective/`, keyed by its name RELATIVE to that folder —
 *  so `users.collection.yaml` is `users`. ⚠ Recursive: `compile` enumerates
 *  `collections/` recursively so a namespaced descriptor can be authored at `collections/<ns>/<c>`,
 *  and a flat readdir here would silently stop testing five collections. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}


// A gate is about ONE sitting — what THAT run measured before advancing — so it is run-layer
// beside the interview and the proposals, not contributor-layer beside the model.
const RUN_LAYER = ['retrospective-sessions', 'questions', 'proposals', 'gates'];
const C = '[a-z0-9-]+';                       // a contributor slug
const D = '\\\\d{4}-\\\\d{2}-\\\\d{2}';       // a date segment, as it appears in the YAML source

const EXPECTED = {
	'retrospective-sessions': ["{{ started | date }}--{{ contributor }}", `^${D}--${C}$`],
	perspectives: ["{{ contributor }}", `^${C}$`],
	sources: ["{{ contributor }}/{{ kind }}--{{ label | slug }}", `^${C}/[a-z-]+--[a-z0-9-]+$`],
	conversations: ["{{ contributor }}/{{ harness }}/{{ started_at | date:YYYY/MM }}/{{ session_id }}", `^${C}/[a-z-]+/\\\\d{4}/\\\\d{2}/[0-9a-zA-Z_-]{8,64}$`],
	'activity-weeks': ["{{ contributor }}/{{ source | basename }}/{{ period }}", `^${C}/[a-z-]+--[a-z0-9-]+/\\\\d{4}-W\\\\d{2}$`],
	tickets: ["{{ contributor }}/{{ source | basename }}/{{ external_id }}", `^${C}/[a-z-]+--[a-z0-9-]+/[A-Za-z0-9_-]+$`],
	threads: ["{{ contributor }}/{{ source | basename }}/{{ external_id }}", `^${C}/[a-z-]+--[a-z0-9-]+/[A-Za-z0-9_-]+$`],
	deliverables: ["{{ contributor }}/{{ last_touched_on | date }}--{{ name | slug }}", `^${C}/${D}--[a-z0-9-]+$`],
	activities: ["{{ contributor }}/{{ started | date }}--{{ name | slug }}", `^${C}/${D}--[a-z0-9-]+$`],
	decisions: ["{{ contributor }}/{{ decided_on | date }}--{{ name | slug }}", `^${C}/${D}--[a-z0-9-]+$`],
	findings: ["{{ contributor }}/{{ kind }}--{{ name | slug }}", `^${C}/[a-z-]+--[a-z0-9-]+$`],
	assumptions: ["{{ contributor }}/{{ kind }}--{{ name | slug }}", `^${C}/[a-z-]+--[a-z0-9-]+$`],
	projects: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	topics: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	concepts: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	// `key`, not `name | slug`: a term's name is VERBATIM and may be in any script, and the engine's
	// slug filter is slugOrHash — a non-Latin name slugs to a hash, not a refusal. Measured in a
	// consuming workspace 2026-09-12: 22 of 35 terms hashed on the first write.
	terms: ["{{ contributor }}/{{ key }}", `^${C}/[a-z0-9-]+$`],
	users: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	goals: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	insights: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	workflows: ["{{ contributor }}/{{ name | slug }}", `^${C}/[a-z0-9-]+$`],
	gates: ["{{ retrospective | basename }}/{{ gate }}", `^${D}--${C}/[a-z-]+$`],
	questions: ["{{ retrospective | basename }}/{{ n | pad:3 }}", `^${D}--${C}/\\\\d{3}$`],
	proposals: ["{{ retrospective | basename }}/{{ kind }}--{{ name | slug }}", `^${D}--${C}/[a-z-]+--[a-z0-9-]+$`],
};

test('the table covers every collection, and nothing else', () => {
	const on_disk = descriptorNames(DIR).sort();
	assert.deepEqual(Object.keys(EXPECTED).sort(), on_disk);
});

for (const [name, [generate, pattern]] of Object.entries(EXPECTED)) {
	test(`${name} generates its id as the design says`, () => {
		assert.equal(load(name).id.generate.replace(/\s+/g, ' ').trim(), generate);
	});
	test(`${name} accepts exactly that shape`, () => {
		assert.equal(load(name).id.pattern, pattern.replace(/\\\\/g, '\\'));
	});
}

test('outside the run layer, no id names the run', () => {
	for (const [name, [generate]] of Object.entries(EXPECTED)) {
		if (RUN_LAYER.includes(name)) continue;
		assert.ok(!/retrospective/.test(generate), `${name} is still keyed by the run: ${generate}`);
		assert.ok(generate.startsWith('{{ contributor }}'), `${name} must lead with the contributor: ${generate}`);
	}
});

test('the run layer keeps the session in the id', () => {
	for (const name of ['questions', 'proposals', 'gates']) {
		assert.ok(EXPECTED[name][0].startsWith('{{ retrospective | basename }}'), name);
	}
});
