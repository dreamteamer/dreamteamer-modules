// RELATIONS, AND WHO OWNS THEM.
//
// The module carried 83 references and NOT ONE inverse. Four relations had both halves declared by
// hand — `activities.deliverables[]` beside `deliverables.activities[]`, and three fields on the
// session mirroring `sources`, `proposals` and `perspectives` — so the two sides could disagree and
// nothing would notice. One guard in check-records.mjs existed for no other purpose than to police
// the last of those pairs, which is a guard whose job the schema should make impossible.
//
// The engine already does this: a field declared with `mirror_of: <owning field>` on the TARGET is a
// read-only mirror the engine maintains on every `dt` write, and — measured 2026-09-09 — reports
// `activities: stale — run: dreamteamer relations rebuild perspective/projects` when a script writes
// the owner as a raw file. Detected drift with a named repair beats undetected drift.
//
// ⚠ NOT EVERY RELATION SHOULD BE MIRRORED. The inverse is worth having when it reads as a LIST a
// person would want on the target. It is not when the fan-in makes it unreadable: a real workspace
// measured for this release held 1,100 conversations, 933 tickets and 449 activity-weeks pointing at
// a handful of `sources` records, so `sources.conversations[]` would be a 1,100-element array on one
// record — a worse artefact than the query it replaces. Those stay one-way, and this test names them
// so the omission is a decision rather than an oversight.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { shippedDescriptor } from '../skills/running-retrospectives/lib/descriptors.mjs';
import { targetsOf } from '../../../tests/helpers/descriptors.mjs';

const COLS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective', 'collections', 'perspective');
// read with their mixins merged in, so a field a mixin supplies counts as the collection's own
const load = (n) => shippedDescriptor(`perspective/${n}`);
/** Every descriptor under `collections/perspective/`, by its name RELATIVE to that folder — so
 *  `users.collection.yaml` is `users`. Recursive, because `compile` enumerates `collections/` recursively. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

const names = descriptorNames(COLS);
const D = new Map(names.map((n) => [n, load(n)]));
const propsOf = (n) => D.get(n).fields ?? {};
// A reference target may be one collection OR a union (a list) — `targetsOf` normalises both.
// `concepts.classifies` is a union that IS mirrored, on every collection it names.

/** owner field → the mirror its target declares with `mirror_of`. */
const MIRRORS = {
	'activities.project': 'activities',
	'activities.lead': 'led_activities',
	'activities.topics': 'activities',
	'activities.collaborators': 'activities',
	'activities.sessions': 'activities',
	'activities.tickets': 'activities',
	'activities.threads': 'activities',
	'activities.deliverables': 'activities',
	'projects.lead': 'led_projects',
	// The vocabulary pointed at the OBSERVED world. A union, and mirrored — every target is a
	// collection this module owns, so the mirror is not a write into somebody else's schema.
	'concepts.classifies': 'concepts',
	'decisions.project': 'decisions',
	'decisions.topics': 'decisions',
	'decisions.collaborators': 'decisions',
	'decisions.conversations': 'decisions',
	// ⚠ `decided`, not `decisions` — `collaborators` already stamps `decisions` on the same target, and
	// one field cannot hold two relations. The names also carry the distinction: what a person DECIDED
	// against what they were merely IN.
	'decisions.decider': 'decided',
	'decisions.activity': 'decisions',
	'deliverables.project': 'deliverables',
	// the vocabulary pair — a term points at the meaning it expresses, and at the records it is
	// load-bearing in. Both mirrors land on collections this module owns.
	'terms.concept': 'terms',
	'terms.mentions': 'terms',
	'projects.collaborators': 'projects',
	'projects.topics': 'projects',
	'workflows.activities': 'workflows',
	'workflows.collaborators': 'workflows',
	'workflows.proposed_as': 'workflow',
	'goals.projects': 'goals',
	'goals.activities': 'goals',
	'goals.decisions': 'goals',
	'goals.findings': 'goals',
	'goals.topics': 'goals',
	'insights.findings': 'insights',
	'proposals.justified_by': 'proposals',
	'questions.from_finding': 'questions',
	'topics.concepts': 'topics',
	'assumptions.tested_by': 'tests_assumption',
	'deliverables.topics': 'deliverables',
	'users.sources': 'collaborators',
	'tickets.assignee': 'tickets',
	'gates.retrospective': 'gates',
	'proposals.retrospective': 'proposals',
	'perspectives.retrospective': 'perspective',
	'sources.retrospectives': 'sources',
};

/** Deliberately one-way, each for a stated reason. */
const ONE_WAY = {
	'conversations.source': 'a measured workspace had 1,100 conversations on a handful of sources',
	'activity-weeks.source': '449 weeks on the same few sources',
	'tickets.source': '933 tickets on one asana source',
	'threads.source': 'a mailbox source would list every thread',
	'deliverables.source': 'a drive source would list every file',
	'activities.repos': 'repos is a core collection this module does not own',
	'projects.repos': 'same — core owns repos',
	'conversations.repo': 'same',
	'sources.repo': 'same',
	'perspectives.dsl': 'the perspective is one per contributor; a concept already carries `contributor`',
	'perspectives.topics': 'same',
	'perspectives.collaborators': 'same',
	'perspectives.workflows': 'same',
	// PEER references out to the consumer's own world. A peer excuses a REFERENCE, never a MIRROR:
	// stamping a field onto somebody else's collection is this module writing into their schema.
	'concepts.related_to': 'a peer union — the target collections belong to other modules',
	// ── THE OBSERVED WORLD'S JOIN OUT TO THE REAL ONE. One-way BY DESIGN, and it is the whole point:
	// the real world is what a person authored, and stamping `observed_as[]` onto their record would
	// be a finding writing into somebody else's schema. Soft as well (a plain string, not a reference
	// type), so an absent collection and an absent record are both tolerated; `bin/check-records.mjs`
	// warns rather than the engine failing.
	'users.real': 'the real world never points back at a finding',
	'users.company': 'a peer — companies belongs to another module',
	'projects.real': 'same',
	'projects.company': 'same — companies is a peer',
	'activities.real': 'same',
	'goals.real': 'same',
	'decisions.real': 'same',
	'deliverables.real': 'same',
	'users.contact': 'same — contacts is a peer, not ours to mirror onto',
	'retrospective-sessions.contact': 'same field, same target, same reason — the run record points at the same CRM collection the collaborator does',
	'activities.meetings': 'same — `meetings` is a PEER the consumer owns; the meetings source reads it as evidence and may not stamp a field onto somebody else\'s collection',
};

test('every reference is either mirrored or listed as deliberately one-way', () => {
	const unclassified = [];
	for (const n of names) for (const [f, spec] of Object.entries(propsOf(n))) {
		if (!targetsOf(spec).length) continue;
		const key = `${n}.${f}`;
		// A field carrying `mirror_of` IS a mirror: the far half of a relation already classified from
		// its owning side, never a relation of its own.
		if (spec.mirror_of !== undefined) continue;
		if ((f === 'retrospective' || f === 'retrospectives') && !(key in MIRRORS)) continue;   // the run link
		if (f === 'last_seen_in') continue;                          // ditto
		if (!(key in MIRRORS) && !(key in ONE_WAY)) unclassified.push(key);
	}
	assert.deepEqual(unclassified, [], `neither mirrored nor justified as one-way:\n  ${unclassified.join('\n  ')}`);
});

for (const [key, mirror] of Object.entries(MIRRORS)) {
	const [owner, field] = key.split('.');
	test(`${key} owns the relation and every target mirrors it as ${mirror}`, () => {
		const spec = propsOf(owner)[field];
		assert.ok(spec, `${owner} has no field ${field}`);
		const targets = targetsOf(spec).filter((t) => D.has(t.replace(/^perspective\//, '')));
		assert.ok(targets.length, `${key} points at no collection this module owns`);
		for (const raw of targets) {
			const theirs = propsOf(raw.replace(/^perspective\//, ''))[mirror];
			assert.ok(theirs, `${raw} has no ${mirror}`);
			assert.equal(theirs.type, `perspective/${owner}`);
			assert.equal(theirs.mirror_of, field);
		}
	});
	test(`${key}'s target does not ALSO declare the mirror as a relation of its own`, () => {
		// A mirror declared as a SECOND reference — no `mirror_of` — is two halves that can disagree,
		// which is the defect this release removes.
		for (const raw of targetsOf(propsOf(owner)[field])) {
			const target = raw.replace(/^perspective\//, '');
			if (!D.has(target)) continue;                              // a core or peer collection
			const theirs = propsOf(target)[mirror];
			assert.ok(!theirs || theirs.mirror_of !== undefined,
				`${target}.${mirror} is a reference of its own, not a mirror of ${key}`);
		}
	});
}

test('no count duplicates the length of a mirror', () => {
	// A stored count beside a relation the engine maintains is a second copy of one fact. Counts
	// that SUM across records (a project's commits, a collaborator's evidence) are real work and stay.
	assert.ok(!('activities_count' in propsOf('projects')),
		'projects.activities_count is the length of its activities mirror — the mirror is the count');
});

test('every list column names a field that exists', () => {
	// A dangling column puts a dead column in every default listing. The fields are the collection's
	// own, its mixins' and its mirrors, all declared in the descriptor; the engine adds `id`,
	// `created` and `last_modified` to every collection.
	const injected = ['id', 'created', 'last_modified'];
	const dead = [];
	for (const n of names) {
		const p = propsOf(n);
		for (const f of D.get(n).display?.list?.columns ?? []) {
			if (f in p || injected.includes(f)) continue;
			dead.push(`${n}.display.list.columns: ${f}`);
		}
	}
	assert.deepEqual(dead, [], `a dangling list column puts a dead column in every listing:\n  ${dead.join('\n  ')}`);
});
