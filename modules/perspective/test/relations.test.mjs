// RELATIONS, AND WHO OWNS THEM.
//
// The module carried 83 references and NOT ONE inverse. Four relations had both halves declared by
// hand — `activities.deliverables[]` beside `deliverables.activities[]`, and three fields on the
// session mirroring `sources`, `proposals` and `perspectives` — so the two sides could disagree and
// nothing would notice. One guard in check-records.mjs existed for no other purpose than to police
// the last of those pairs, which is a guard whose job the schema should make impossible.
//
// The engine already does this: `x-inverse` on the OWNING field stamps a read-only mirror onto the
// target at compile, maintains it on every `dt` write, and — measured 2026-09-09 — reports
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
import yaml from 'js-yaml';

const COLS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective', 'collections', 'perspective');
const load = (n) => yaml.load(fs.readFileSync(path.join(COLS, `${n}.collection.yaml`), 'utf8'));
/** Every descriptor under `collections/perspective/`, by its name RELATIVE to that folder — so
 *  `users.collection.yaml` is `users`. Recursive, because `compile` enumerates `collections/` recursively. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

const names = descriptorNames(COLS);
const D = new Map(names.map((n) => [n, load(n)]));
const propsOf = (n) => (D.get(n).schema?.properties) ?? {};
const refOf = (spec) => spec?.['x-reference'] ?? (spec?.type === 'array' ? spec?.items?.['x-reference'] : undefined);
/** A reference target may be a scalar OR a union (a list) — `refTargets` normalises both, the way
 *  the engine's own `refTargetsOf` does. `concepts.classifies` is a union that IS mirrored, so a
 *  reader that assumed a scalar here threw rather than failing. */
const targetsOf = (spec) => { const r = refOf(spec); return r == null ? [] : Array.isArray(r) ? r : [r]; };
const invOf = (spec) => spec?.['x-inverse'] ?? spec?.items?.['x-inverse'];

/** owner field → the mirror it must stamp on its target. */
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
};

/**
 * Relations whose mirror is declared on the TARGET (`x-inverse-of`, "spelling B") rather than on the
 * owner. Compile rewrites them onto the owner and stamps the same generated field, so they are the
 * same relation — the difference is only which descriptor a reader sees it in.
 *
 * ⚠ DECLARING BOTH SIDES IS THE THING TO AVOID. It compiles to exactly this, and warns on every run
 * in every consumer ("declared on both sides — keep one"). Two permanent warnings in everybody's
 * compile output is how people learn to skim warnings, which is how the next real one is missed.
 * `no relation is declared on BOTH sides` below is the gate.
 */
const MIRROR_ON_TARGET = {
	'sources.retrospectives': ['retrospective-sessions', 'sources'],
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
	// be a finding writing into somebody else's schema. Soft as well (`x-reference-soft`), so an
	// absent collection and an absent record are both tolerated; `bin/check-records.mjs` warns rather
	// than the engine failing.
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
		if (!refOf(spec)) continue;
		const key = `${n}.${f}`;
		// A field carrying `x-inverse-of` IS a mirror, spelled out where a reader looks — compile
		// deletes it in pass 1 and regenerates it. It is the far half of a relation already classified
		// from its owning side, never a relation of its own.
		if (spec['x-inverse-of'] || spec.items?.['x-inverse-of']) continue;
		if (key in MIRROR_ON_TARGET) continue;                        // mirrored, from the other side
		if ((f === 'retrospective' || f === 'retrospectives') && !(key in MIRRORS)) continue;   // the run link
		if (f === 'last_seen_in') continue;                          // ditto
		if (!(key in MIRRORS) && !(key in ONE_WAY)) unclassified.push(key);
	}
	assert.deepEqual(unclassified, [], `neither mirrored nor justified as one-way:\n  ${unclassified.join('\n  ')}`);
});

for (const [key, mirror] of Object.entries(MIRRORS)) {
	const [owner, field] = key.split('.');
	test(`${key} owns the relation and stamps ${mirror} on its target`, () => {
		const spec = propsOf(owner)[field];
		assert.ok(spec, `${owner} has no field ${field}`);
		// `x-inverse` has two spellings: a bare mirror name, and an object carrying `field` and a
		// description for the generated side. Both are legal and both mean the same relation.
		const inv = invOf(spec);
		assert.equal(typeof inv === 'string' ? inv : inv?.field, mirror);
	});
	test(`${key}'s target does not ALSO declare the mirror by hand`, () => {
		for (const raw of targetsOf(propsOf(owner)[field])) {
			const target = raw.replace(/^perspective\//, '');
			if (!D.has(target)) continue;                              // a core or peer collection
			const theirs = propsOf(target)[mirror];
			// ⚠ `x-inverse-of` is spelling B, and it is legal: the authored field is DELETED in
			// compile's pass 1 and regenerated under the same key, which is how a mirror can be
			// visible in the descriptor a reader actually opens (`rnd/product-design-docs.prototypes`).
			// What is refused is a mirror declared as a SECOND relation — a reference with no
			// `x-inverse-of` — because then the two halves can disagree.
			if (theirs?.['x-inverse-of'] || theirs?.items?.['x-inverse-of']) continue;
			assert.ok(!theirs || !refOf(theirs),
				`${target}.${mirror} is declared by hand AND generated — two halves that can disagree, which is the defect this release removes`);
		}
	});
}

for (const [key, [target, mirror]] of Object.entries(MIRROR_ON_TARGET)) {
	const [owner, field] = key.split('.');
	test(`${key}'s mirror is declared on ${target}.${mirror}, and NOT also on the owner`, () => {
		const spec = propsOf(owner)[field];
		assert.ok(spec, `${owner} has no field ${field}`);
		assert.ok(!invOf(spec), `${key} declares x-inverse AND ${target}.${mirror} declares x-inverse-of — compile warns on every run in every consumer`);
		assert.equal(propsOf(target)[mirror]?.['x-inverse-of'], `perspective/${key}`);
	});
}

test('no count duplicates the length of a mirror', () => {
	// A stored count beside a relation the engine maintains is a second copy of one fact. Counts
	// that SUM across records (a project's commits, a collaborator's evidence) are real work and stay.
	assert.ok(!('activities_count' in propsOf('projects')),
		'projects.activities_count is the length of its activities mirror — the mirror is the count');
});

test('every list_fields entry names a field that exists', () => {
	// A dangling entry compiles CLEAN and puts a dead column in every default listing — the engine
	// warns about a dangling `sort_field` and not about this one. Two sources of real fields beyond
	// the collection's own properties: the provenance TEMPLATE every collection stamps, and the
	// mirrors `x-inverse` generates at compile.
	const fromTemplate = ['author', 'creation_context', 'source', 'confidence'];
	const generated = new Set();
	for (const n of names) for (const spec of Object.values(propsOf(n))) {
		const inv = invOf(spec);
		if (!inv) continue;
		const mirror = typeof inv === 'string' ? inv : inv.field;
		for (const ref of targetsOf(spec)) generated.add(`${ref.replace(/^perspective\//, '')}.${mirror}`);
	}
	const dead = [];
	for (const n of names) {
		const p = propsOf(n);
		for (const f of D.get(n).list_fields ?? []) {
			if (f in p || f === 'id' || fromTemplate.includes(f) || generated.has(`${n}.${f}`)) continue;
			dead.push(`${n}.list_fields: ${f}`);
		}
	}
	assert.deepEqual(dead, [], `a dangling list_fields entry compiles clean and puts a dead column in every listing:\n  ${dead.join('\n  ')}`);
});
