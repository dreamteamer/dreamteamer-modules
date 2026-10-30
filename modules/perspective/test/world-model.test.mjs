// THE OBSERVED WORLD IS EXPRESSED IN THE REAL WORLD'S NOUNS, and joined to it one way and softly.
//
// The properties this file holds:
//
//   1. THE OBSERVED SET. `users`, `projects`, `activities`, `decisions` and `deliverables` each
//      have an authored counterpart of the same name in `users` or `projects`, and live in the
//      `perspective` namespace beside the rest of the module. `perspective/goals` has none: the
//      authored `goals` left the projects module, so an inferred goal is joined to nothing.
//   2. THEY ARE PARALLEL, NOT OVERLAYS. None declares `overlay: true`, because a merged collection could
//      not tell a record a run FOUND from one a person WROTE.
//   3. THE JOIN IS `real`: ONE-WAY, SOFT, AND POINTED AT ITS OWN COLLECTION. Soft means a plain
//      string rather than a reference type, so the engine's `check` never resolves it; the module's
//      own guard (`bin/check-records.mjs`) holds the target and reports one that resolves to nothing.
//   4. AND `real` IS THE ONLY CROSSING. Every other reference resolves inside `perspective/`, or names
//      a peer with no observed half (`companies`, `contacts`, `meetings`, `repos`).
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { shippedDescriptor } from '../skills/running-retrospectives/lib/descriptors.mjs';
import { fieldsOf, targetsOf } from '../../../tests/helpers/descriptors.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const MODULES = path.join(ROOT, 'modules');
const COLS = path.join(MODULES, 'perspective', 'collections', 'perspective');
const PERSPECTIVE_PKG = JSON.parse(fs.readFileSync(path.join(MODULES, 'perspective', 'package.json'), 'utf8'));

/** observed collection → the REAL collection it mirrors, and the module that ships that one. */
const PAIRS = {
	users: { real: 'users', module: 'users' },
	projects: { real: 'projects', module: 'projects' },
	activities: { real: 'activities', module: 'projects' },
	decisions: { real: 'decisions', module: 'projects' },
	deliverables: { real: 'deliverables', module: 'projects' },
};

/** The whole observed world: every PAIRS collection plus `goals`, which is observed and joined to nothing. */
const WORLD = [...Object.keys(PAIRS), 'goals'];
const load = (p) => yaml.load(fs.readFileSync(p, 'utf8'));
// each observed descriptor with its mixins merged in, so a mixin's field counts as its own
const observed = Object.fromEntries(Object.keys(PAIRS).map((n) => [n, shippedDescriptor(`perspective/${n}`)]));
const realOf = (n) => load(path.join(MODULES, PAIRS[n].module, 'collections', `${PAIRS[n].real}.collection.yaml`));
const propsOf = (d) => d.fields ?? {};
/** The real collection's fields once installed: its own, its mixins' and every overlay's. */
const realFieldsOf = (n) => Object.fromEntries(fieldsOf(PAIRS[n].real));

describe('the observed world', () => {
	test('is exactly the descriptors that carry `real`', () => {
		const withReal = fs.readdirSync(COLS).filter((f) => f.endsWith('.collection.yaml'))
			.map((f) => f.replace('.collection.yaml', ''))
			.filter((n) => 'real' in propsOf(shippedDescriptor(`perspective/${n}`)))
			.sort();
		assert.deepEqual(withReal, Object.keys(PAIRS).sort());
	});

	test('every real counterpart actually exists in this package', () => {
		for (const [n, { real, module }] of Object.entries(PAIRS)) {
			const f = path.join(MODULES, module, 'collections', `${real}.collection.yaml`);
			assert.ok(fs.existsSync(f), `${n} claims to mirror ${real}, which ${module} does not ship`);
			assert.equal(realOf(n).name, real);
		}
	});

	test('lives in the perspective namespace, and the module declares no other', () => {
		assert.deepEqual(PERSPECTIVE_PKG.dreamteamer.namespaces, ['perspective']);
		assert.ok(!fs.existsSync(path.join(COLS, 'world')), 'collections/perspective/world/ is gone');
		for (const [n, d] of Object.entries(observed)) {
			assert.equal(d.name, `perspective/${n}`);
			assert.equal(d.storage.path, `data/perspective/${n}`, `${n} must store under its own namespace folder`);
		}
	});
});

describe('parallel objects, never overlays', () => {
	test('no observed collection is an overlay', () => {
		for (const [n, d] of Object.entries(observed)) {
			assert.ok(!d.overlay,
				`${n} extends its base — an overlay merges by NAME, so a record a run FOUND becomes indistinguishable from one a person WROTE`);
		}
	});

	test('no observed collection shares a name with the real one it mirrors', () => {
		for (const [n, { real }] of Object.entries(PAIRS)) {
			assert.notEqual(observed[n].name, real);
		}
	});

	test('the observed id is keyed by the contributor; the real id is not', () => {
		// This is why the two cannot be merged even if somebody wanted to: one collection has ONE id
		// shape, and these two disagree by design. The contributor segment is what makes a SECOND
		// retrospective update a person's model instead of writing a copy beside it.
		for (const [n, d] of Object.entries(observed)) {
			assert.ok(d.ids.from.startsWith('{{ contributor }}'), `${n}: ${d.ids.from}`);
			assert.ok(![realOf(n).ids.from].flat().some((t) => t.includes('contributor')), `${PAIRS[n].real} must NOT be contributor-keyed`);
		}
	});
});

describe('the `real` join', () => {
	for (const [n, { real, module }] of Object.entries(PAIRS)) {
		test(`${n}.real points at ${real}, one-way and soft`, () => {
			const spec = propsOf(observed[n]).real;
			assert.ok(spec, `${n} has no \`real\` — the observed world with no join to the real one is a second vocabulary again`);
			assert.deepEqual(targetsOf(spec), [real], `${n}.real must point at ${real}`);
			assert.equal(spec.soft, true,
				'soft is what lets the target RECORD be gone: a correspondence is a judgement a run made on a date');
			assert.ok(!spec.many, `${n}.real is one record`);
			assert.ok(spec.description.startsWith(`The \`${real}\` record`), `${n}.real must name the collection it points at`);
			const realMirrors = Object.entries(realFieldsOf(n)).filter(([, f]) => targetsOf(f).includes(`perspective/${n}`));
			assert.deepEqual(realMirrors, [], 'ONE-WAY: the real world must never gain a field pointing at a finding');
			assert.ok(PERSPECTIVE_PKG.dreamteamer.peer_collections.includes(real),
				`${real} must be a declared peer — that is what lets the target COLLECTION be absent (module ${module} need not be installed)`);
		});
	}

	test('perspective declares no hard dependency at all, so it still compiles alone', () => {
		assert.deepEqual(PERSPECTIVE_PKG.dreamteamer.dependencies ?? [], [],
			'a hard dependency on projects or users is what the overlay attempt cost, and a retrospective must run in a workspace with no plan');
	});

	test('no observed collection writes a mirror onto a collection this module does not own', () => {
		// A mirror is a `mirror_of` field on the collection that holds it, so a mirror on somebody
		// else's collection would have to arrive as an overlay this module ships.
		const all = fs.readdirSync(COLS).filter((f) => f.endsWith('.collection.yaml')).map((f) => load(path.join(COLS, f)));
		for (const d of all) {
			assert.ok(!d.overlay, `${d.name} is an overlay — a peer excuses a REFERENCE, never a MIRROR`);
			assert.ok(d.name.startsWith('perspective/'), `${d.name} is not a perspective collection`);
		}
		for (const [n, d] of Object.entries(observed)) {
			for (const [field, spec] of Object.entries(propsOf(d))) {
				if (spec?.mirror_of === undefined) continue;
				for (const t of targetsOf(spec)) {
					assert.ok(String(t).startsWith('perspective/'),
						`${n}.${field} mirrors "${t}" — a peer excuses a REFERENCE, never a MIRROR`);
				}
			}
		}
	});
});

describe('the layer resolves within itself — `real` is the only crossing', () => {
	// ⚠ THE RULE, STATED ONCE AND APPLIED TO EVERYTHING. If an observed activity's `lead` pointed at
	// the real `users`, a record a retrospective FOUND would be wired into records a person WROTE and
	// the two layers would stop being separable — which is the entire parallel-object design. So:
	// every reference in `perspective/*` either stays in `perspective/`, or names a collection
	// that has NO observed half at all (a peer: companies, contacts, meetings, repos). The single
	// exception is `real`, and it is soft and unmirrored.
	//
	// Asserted over every observed collection rather than field by field, so the next field added
	// here cannot weld the two worlds together quietly.
	const REAL_NOUNS = new Set(Object.values(PAIRS).map((p) => p.real));

	test('no field but `real` points at a noun the observed world has its own half of', () => {
		const crossings = [];
		let checked = 0;
		for (const [n, d] of Object.entries(observed)) {
			for (const [field, spec] of Object.entries(propsOf(d))) {
				for (const t of targetsOf(spec)) {
					checked += 1;
					if (spec.soft) continue;                         // `real` and the soft unions cross by design
					if (String(t).startsWith('perspective/')) continue;
					if (!REAL_NOUNS.has(String(t))) continue;     // a peer with no observed half — legal
					crossings.push(`${n}.${field} → ${t}  (want perspective/${t})`);
				}
			}
		}
		assert.ok(checked > 20, `the scan saw only ${checked} references — it is not looking where it thinks it is`);
		assert.deepEqual(crossings, [],
			'a reference out of the observed layer into the real one welds a finding to somebody\'s authored records:\n  ' + crossings.join('\n  '));
	});

	test('`real` is the only crossing, it is soft, and every observed collection has exactly one', () => {
		for (const [n, d] of Object.entries(observed)) {
			const crossing = Object.entries(propsOf(d))
				.filter(([, spec]) => !spec.soft && targetsOf(spec).some((t) => REAL_NOUNS.has(String(t))))
				.map(([field]) => field);
			assert.deepEqual(crossing, [], `${n} crosses into the real world through a hard reference: ${crossing.join(', ')}`);
			assert.equal(propsOf(d).real?.soft, true, `${n} has no soft \`real\``);
		}
	});
});

describe('concepts classify both worlds, and the two halves stay apart', () => {
	const concepts = propsOf(shippedDescriptor('perspective/concepts'));

	test('`classifies` names every observed-world collection, and only those', () => {
		assert.ok(concepts.classifies.many);
		assert.deepEqual([...targetsOf(concepts.classifies)].sort(), WORLD.map((n) => `perspective/${n}`).sort());
	});

	test('`classifies` is HARD, because those collections are ours', () => {
		assert.ok(Array.isArray(concepts.classifies.type) && concepts.classifies.type.every((t) => t.startsWith('perspective/')),
			'a dangling ref into a collection this module writes itself is a real defect, not a stale judgement');
	});

	test('`related_to` is a soft list into the real world', () => {
		assert.equal(concepts.related_to.soft, true, 'soft: a deleted real record must not turn a concept red');
		assert.ok(concepts.related_to.many);
		assert.ok(targetsOf(concepts.related_to).length > 0, 'related_to names the real collections it may point at');
		assert.deepEqual(targetsOf(concepts.related_to).filter((t) => String(t).startsWith('perspective/')), [],
			'the observed world belongs to `classifies`; two fields, because one is ours and one is not');
	});
});

describe('same structure, and the places it deliberately differs', () => {
	// The tense is the distinction, and it is asserted so nobody "tidies" it into agreement: a plan is
	// written AHEAD (`starts`) and an observation is read BEHIND (`started`).
	test('the observed dates are past tense; the real ones are not', () => {
		for (const n of ['projects', 'activities']) {
			const p = propsOf(observed[n]);
			assert.ok('started' in p && 'ended' in p, `${n} must spell its dates in the past tense`);
			assert.ok(!('starts' in p) && !('ends' in p), `${n} must not carry the PLAN's spelling`);
			assert.ok('starts' in realFieldsOf(n), `${PAIRS[n].real} is the plan and keeps \`starts\``);
		}
	});

	test('the relation spine is the real world\'s, in the real world\'s words', () => {
		assert.equal(propsOf(observed.activities).project.type, 'perspective/projects');
		assert.equal(propsOf(observed.activities).lead.type, 'perspective/users');
		assert.equal(propsOf(observed.projects).lead.type, 'perspective/users');
		assert.ok(!('lane' in propsOf(observed.activities)) && !('phase' in propsOf(observed.activities)),
			'lanes and phases are not observed — those collections are gone');
	});

	test('an observed goal spells its test as `done_when`, and carries no `real` — there is no declared goal to join', () => {
		const goals = shippedDescriptor('perspective/goals');
		assert.ok('done_when' in propsOf(goals));
		assert.ok(!('real' in propsOf(goals)), 'the authored goals collection is gone from projects; a join to it would resolve to nothing');
		assert.ok(!('statement' in propsOf(goals)) && !('horizon' in propsOf(goals)));
	});
});
