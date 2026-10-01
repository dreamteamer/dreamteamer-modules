// THE OBSERVED WORLD IS EXPRESSED IN THE REAL WORLD'S NOUNS, and joined to it one way and softly.
//
// This is the gate for the `perspective/world` namespace. Everything it asserts would have passed
// vacuously before that namespace existed, and every one of its assertions fails if the world moves
// back out, loses a member, or grows a mirror pointing at somebody's authored records.
//
// The three properties it exists to hold:
//
//   1. THE NOUN SET IS THE SAME. `modules/projects` and `modules/users` model users, projects,
//      phases, activity-lanes, activities, tasks, goals, decisions and deliverables; `perspective/world`
//      models exactly those NINE, under exactly those names. A world collection with no real
//      counterpart is a vocabulary drifting apart again, which is the whole defect this release
//      removes — and a REAL collection in the projects model with no world half is the same drift
//      pointing the other way, which is what moved `decisions` and `deliverables` into the namespace
//      on 2026-09-11 and what minted `world/phases` beside them.
//   2. THEY ARE PARALLEL, NOT OVERLAYS. Not one of them declares `extends:`, and none of them shares
//      a NAME with the real collection — because a merged collection could not tell a record a run
//      FOUND from one a person WROTE, and the module's loudest rule is that nothing here is authored
//      truth.
//   3. THE JOIN IS `real`: ONE-WAY, SOFT, AND POINTED AT ITS OWN COLLECTION. One-way (no
//      `x-inverse`) because the real world must never gain a field pointing at a finding; soft
//      (`x-reference-soft` plus a declared peer) because the target collection may not be installed
//      at all AND the target record may have been deleted since the run judged the match.
//   4. AND `real` IS THE ONLY CROSSING. Every other reference in the layer resolves INSIDE it: an
//      observed activity's `project` is `perspective/world/projects`, its `lane` is
//      `perspective/world/activity-lanes`, its `lead` is `perspective/world/users`. This one is
//      asserted GENERALLY, over every field of every collection in the namespace, rather than
//      per field — so a collection added here later cannot point at a real noun quietly. A
//      reference OUT to a collection the real world has no observed half of (`companies`,
//      `contacts`, `meetings`, `repos`) is legal and always was: that is a peer, not a half of
//      this model.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');
const WORLD = path.join(MODULES, 'perspective', 'collections', 'perspective', 'world');
const PERSPECTIVE_PKG = JSON.parse(fs.readFileSync(path.join(MODULES, 'perspective', 'package.json'), 'utf8'));

/** observed collection → the REAL collection it mirrors, and the module that ships that one. */
const PAIRS = {
	'world/users': { real: 'users', module: 'users' },
	'world/projects': { real: 'projects', module: 'projects' },
	'world/phases': { real: 'phases', module: 'projects' },
	'world/activity-lanes': { real: 'activity-lanes', module: 'projects' },
	'world/activities': { real: 'activities', module: 'projects' },
	'world/tasks': { real: 'tasks', module: 'projects' },
	'world/goals': { real: 'goals', module: 'projects' },
	'world/decisions': { real: 'decisions', module: 'projects' },
	'world/deliverables': { real: 'deliverables', module: 'projects' },
};

const load = (p) => yaml.load(fs.readFileSync(p, 'utf8'));
const observed = Object.fromEntries(Object.keys(PAIRS)
	.map((n) => [n, load(path.join(WORLD, `${n.split('/')[1]}.collection.yaml`))]));
const realOf = (n) => load(path.join(MODULES, PAIRS[n].module, 'collections', `${PAIRS[n].real}.collection.yaml`));
const propsOf = (d) => d.schema?.properties ?? {};
const holder = (spec) => (spec?.items && typeof spec.items === 'object' ? spec.items : spec);

describe('the observed world', () => {
	test('is exactly the nouns the real world models — no more, no fewer', () => {
		const onDisk = fs.readdirSync(WORLD).filter((f) => f.endsWith('.collection.yaml'))
			.map((f) => `world/${f.replace('.collection.yaml', '')}`).sort();
		assert.deepEqual(onDisk, Object.keys(PAIRS).sort(),
			'a world collection with no real counterpart, or a missing one, is the two vocabularies drifting apart again');
	});

	test('every real counterpart actually exists in this package', () => {
		for (const [n, { real, module }] of Object.entries(PAIRS)) {
			const f = path.join(MODULES, module, 'collections', `${real}.collection.yaml`);
			assert.ok(fs.existsSync(f), `${n} claims to mirror ${real}, which ${module} does not ship`);
			assert.equal(realOf(n).name, real);
		}
	});

	test('lives in the perspective/world namespace, which the module declares', () => {
		assert.ok(PERSPECTIVE_PKG.dreamteamer.namespaces.includes('perspective/world'),
			'an undeclared namespace makes every reference split at the first slash and dangle');
		for (const [n, d] of Object.entries(observed)) {
			assert.equal(d.name, `perspective/${n}`);
			assert.equal(d.storage.path, `data/perspective/${n}`, `${n} must store under its own namespace folder`);
		}
	});
});

describe('parallel objects, never overlays', () => {
	test('not one world collection declares extends:', () => {
		for (const [n, d] of Object.entries(observed)) {
			assert.ok(!('extends' in d),
				`${n} extends its base — an overlay merges by NAME, so a record a run FOUND becomes indistinguishable from one a person WROTE`);
		}
	});

	test('no world collection shares a name with the real one it mirrors', () => {
		for (const [n, { real }] of Object.entries(PAIRS)) {
			assert.notEqual(observed[n].name, real);
		}
	});

	test('the observed id is keyed by the contributor; the real id is not', () => {
		// This is why the two cannot be merged even if somebody wanted to: one collection has ONE id
		// shape, and these two disagree by design. The contributor segment is what makes a SECOND
		// retrospective update a person's model instead of writing a copy beside it.
		for (const [n, d] of Object.entries(observed)) {
			assert.ok(d.id.generate.startsWith('{{ contributor }}'), `${n}: ${d.id.generate}`);
			assert.ok(!realOf(n).id.generate.includes('contributor'), `${PAIRS[n].real} must NOT be contributor-keyed`);
		}
	});
});

describe('the `real` join', () => {
	for (const [n, { real, module }] of Object.entries(PAIRS)) {
		test(`${n}.real points at ${real}, one-way and soft`, () => {
			const spec = propsOf(observed[n]).real;
			assert.ok(spec, `${n} has no \`real\` — the observed world with no join to the real one is a second vocabulary again`);
			const h = holder(spec);
			assert.equal(h['x-reference'], real);
			assert.equal(h['x-reference-soft'], true,
				'soft is what lets the target RECORD be gone: a correspondence is a judgement a run made on a date');
			assert.ok(!h['x-inverse'] && !spec['x-inverse'],
				'ONE-WAY: the real world must never gain a field pointing at a finding');
			assert.ok(PERSPECTIVE_PKG.dreamteamer.peerDependencies.includes(real),
				`${real} must be a declared peer — that is what lets the target COLLECTION be absent (module ${module} need not be installed)`);
		});
	}

	test('perspective declares no hard dependency at all, so it still compiles alone', () => {
		assert.deepEqual(PERSPECTIVE_PKG.dreamteamer.dependencies ?? [], [],
			'a hard dependency on projects or users is what the overlay attempt cost, and a retrospective must run in a workspace with no plan');
	});

	test('no world collection writes a mirror onto a collection this module does not own', () => {
		for (const [n, d] of Object.entries(observed)) {
			for (const [field, spec] of Object.entries(propsOf(d))) {
				const h = holder(spec);
				if (!h?.['x-inverse']) continue;
				const targets = Array.isArray(h['x-reference']) ? h['x-reference'] : [h['x-reference']];
				for (const t of targets) {
					assert.ok(String(t).startsWith('perspective/'),
						`${n}.${field} stamps a mirror onto "${t}" — a peer excuses a REFERENCE, never a MIRROR`);
				}
			}
		}
	});
});

describe('the layer resolves within itself — `real` is the only crossing', () => {
	// ⚠ THE RULE, STATED ONCE AND APPLIED TO EVERYTHING. If an observed activity's `lead` pointed at
	// the real `users`, a record a retrospective FOUND would be wired into records a person WROTE and
	// the two layers would stop being separable — which is the entire parallel-object design. So:
	// every reference in `perspective/world/*` either stays in `perspective/`, or names a collection
	// that has NO observed half at all (a peer: companies, contacts, meetings, repos). The single
	// exception is `real`, and it is soft and unmirrored.
	//
	// Asserted over the whole namespace rather than field by field, because the failure this guards
	// is the NEXT collection somebody adds here — a `lane: activity-lanes` that compiles clean,
	// resolves, and silently welds the two worlds together.
	const REAL_NOUNS = new Set(Object.values(PAIRS).map((p) => p.real));
	const targetsOf = (spec) => {
		const r = holder(spec)?.['x-reference'];
		return r == null ? [] : Array.isArray(r) ? r : [r];
	};

	test('no field but `real` points at a noun the observed world has its own half of', () => {
		const crossings = [];
		let checked = 0;
		for (const [n, d] of Object.entries(observed)) {
			for (const [field, spec] of Object.entries(propsOf(d))) {
				for (const t of targetsOf(spec)) {
					checked += 1;
					if (field === 'real') continue;
					if (String(t).startsWith('perspective/')) continue;
					if (!REAL_NOUNS.has(String(t))) continue;     // a peer with no observed half — legal
					crossings.push(`${n}.${field} → ${t}  (want perspective/world/${t})`);
				}
			}
		}
		assert.ok(checked > 20, `the scan saw only ${checked} references — it is not looking where it thinks it is`);
		assert.deepEqual(crossings, [],
			'a reference out of the observed layer into the real one welds a finding to somebody\'s authored records:\n  ' + crossings.join('\n  '));
	});

	test('`real` is the only soft crossing, and every world collection has exactly one', () => {
		for (const [n, d] of Object.entries(observed)) {
			const crossing = Object.entries(propsOf(d))
				.filter(([, spec]) => targetsOf(spec).some((t) => REAL_NOUNS.has(String(t))))
				.map(([field]) => field);
			assert.deepEqual(crossing, ['real'], `${n} crosses into the real world through ${crossing.join(', ') || 'nothing'}`);
		}
	});

	test('the one relation the lanes added re-points on BOTH ends', () => {
		// The concrete case the general rule was written against, kept as its own assertion so a
		// failure names the edge rather than the rule.
		assert.equal(holder(propsOf(observed['world/activities']).lane)['x-reference'], 'perspective/world/activity-lanes',
			'an observed activity may not sit in a band a person authored');
		assert.equal(holder(propsOf(observed['world/activity-lanes']).project)['x-reference'], 'perspective/world/projects',
			'an observed band may not belong to a plan a person authored');
		// And the real half spells the same two edges bare, inside its own module.
		const realAct = propsOf(realOf('world/activities'));
		const realLane = propsOf(realOf('world/activity-lanes'));
		assert.equal(holder(realAct.lane)['x-reference'], 'activity-lanes');
		assert.equal(holder(realLane.project)['x-reference'], 'projects');
	});
});

describe('concepts classify both worlds, and the two halves stay apart', () => {
	const concepts = propsOf(load(path.join(MODULES, 'perspective', 'collections', 'perspective', 'concepts.collection.yaml')));

	test('`classifies` names every observed-world collection, and only those', () => {
		const targets = holder(concepts.classifies)['x-reference'];
		assert.deepEqual([...targets].sort(), Object.keys(PAIRS).map((n) => `perspective/${n}`).sort());
	});

	test('`classifies` is HARD, because those collections are ours', () => {
		assert.ok(!holder(concepts.classifies)['x-reference-soft'],
			'a dangling ref into a collection this module writes itself is a real defect, not a stale judgement');
	});

	test('`related_to` names the real world, and is soft', () => {
		const targets = holder(concepts.related_to)['x-reference'];
		for (const real of Object.values(PAIRS).map((p) => p.real)) {
			assert.ok(targets.includes(real), `related_to should reach the real \`${real}\``);
		}
		assert.equal(holder(concepts.related_to)['x-reference-soft'], true);
		assert.ok(!targets.some((t) => String(t).startsWith('perspective/world/')),
			'the observed world belongs to `classifies`; two fields, because one is ours and one is not');
	});
});

describe('same structure, and the places it deliberately differs', () => {
	// The tense is the distinction, and it is asserted so nobody "tidies" it into agreement: a plan is
	// written AHEAD (`starts`) and an observation is read BEHIND (`started`).
	test('the observed dates are past tense; the real ones are not', () => {
		for (const n of ['world/projects', 'world/activities']) {
			const p = propsOf(observed[n]);
			assert.ok('started' in p && 'ended' in p, `${n} must spell its dates in the past tense`);
			assert.ok(!('starts' in p) && !('ends' in p), `${n} must not carry the PLAN's spelling`);
			assert.ok('starts' in propsOf(realOf(n)), `${PAIRS[n].real} is the plan and keeps \`starts\``);
		}
	});

	test('the relation spine is the real world\'s, in the real world\'s words', () => {
		assert.equal(holder(propsOf(observed['world/activities']).project)['x-reference'], 'perspective/world/projects');
		assert.equal(holder(propsOf(observed['world/activities']).lane)['x-reference'], 'perspective/world/activity-lanes');
		assert.equal(holder(propsOf(observed['world/activity-lanes']).project)['x-reference'], 'perspective/world/projects');
		assert.equal(holder(propsOf(observed['world/activities']).lead)['x-reference'], 'perspective/world/users');
		assert.equal(holder(propsOf(observed['world/projects']).lead)['x-reference'], 'perspective/world/users');
		assert.equal(holder(propsOf(observed['world/tasks']).assignee)['x-reference'], 'perspective/world/users');
		assert.equal(holder(propsOf(observed['world/tasks']).activity)['x-reference'], 'perspective/world/activities');
		assert.equal(holder(propsOf(observed['world/tasks']).project)['x-reference'], 'perspective/world/projects');
	});

	test('an observed goal spells its test the way a declared one does', () => {
		assert.ok('done_when' in propsOf(observed['world/goals']), 'the field was `statement`; the real collection calls it `done_when`');
		assert.ok('done_when' in propsOf(realOf('world/goals')));
		assert.ok(!('statement' in propsOf(observed['world/goals'])) && !('horizon' in propsOf(observed['world/goals'])),
			'the old spellings are gone, not kept beside the new ones');
	});

	test('an observed task is EVIDENCE-BACKED — its ticket is required and unique', () => {
		const tasks = observed['world/tasks'];
		assert.ok(tasks.schema.required.includes('ticket'), 'a task with no ticket behind it is a judgement; this is the mechanical tier');
		assert.equal(holder(propsOf(tasks).ticket)['x-unique'], true, 'one ticket yields exactly one task — that is what makes derive-tasks idempotent');
	});
});
