// THE PLAN MODEL — the fold (gates ARE activities) and the addressbook edge (owner fields point at
// users, and the mirrors are what make a person's own record answer "what is mine").
//
// ⚠ The fold's whole risk is a shape that can LIE: nothing in JSON Schema stops a `work` row carrying
// `passes_when`, or a gate reaching `done` with nothing behind it. Those rules live in
// modules/projects/bin/check-records.mjs and are the bulk of what is pinned here.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { violationsOf, GATE_ONLY } from '../../../modules/projects/bin/check-records.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const load = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, 'modules', rel), 'utf8'));

describe('the fold — one collection, two kinds', () => {
	const act = load('projects/collections/activities.collection.yaml');
	const p = act.schema.properties;
	test('kind is work|gate and defaults to work, so an ordinary plan row needs no ceremony', () => {
		assert.deepEqual(p.kind.enum, ['work', 'gate']);
		assert.equal(p.kind.default, 'work');
	});
	test('every gate-only field exists and the guard names the same set', () => {
		for (const f of GATE_ONLY) assert.ok(p[f], `activities has no ${f}`);
		assert.deepEqual([...GATE_ONLY].sort(), ['blocking', 'evidence', 'external_owner', 'gate_kind', 'passes_when']);
	});
	// The peer who owns 21 real gates measured that 12 of them are held by someone OUTSIDE the vendor,
	// and that this is the field with no activity equivalent. It must NOT be a user.
	test('external_owner points at contacts, not users — a gate we do not control is not ours to assign', () => {
		assert.equal(p.external_owner['x-reference'], 'contacts');
		assert.equal(p.lead['x-reference'], 'users');
	});
	test('a gate needs no seats and no feeding activity — the schema requires neither', () => {
		assert.deepEqual(act.schema.required, ['code', 'name', 'project', 'kind']);
		assert.ok(!act.schema.required.includes('seats'));
		assert.ok(!act.schema.required.includes('starts'), 'a gate with no date yet is still a gate');
	});
	test('status carries planned, because a plan is authored ahead of anything observed', () => {
		assert.ok(p.status.enum.includes('planned'));
		assert.equal(p.status.default, 'planned');
	});
});

describe('the guard — the rules a schema cannot express', () => {
	const gate = (extra = {}) => ({ kind: 'gate', passes_when: 'the client signs', ...extra });
	test('a passed gate with no evidence is REFUSED — the rule the object exists for', () => {
		const v = violationsOf('g-01', gate({ status: 'done' }));
		assert.equal(v.length, 1);
		assert.match(v[0], /evidence/);
		assert.deepEqual(violationsOf('g-01', gate({ status: 'done', evidence: 'countersigned PDF, 2026-06-01' })), []);
	});
	test('a gate with no passes_when is refused — a test nobody wrote is not a gate', () => {
		assert.match(violationsOf('g-02', { kind: 'gate' })[0], /passes_when/);
	});
	test('a gate spanning days is refused — a gate is judged on one', () => {
		assert.match(violationsOf('g-03', gate({ starts: '2026-01-01', ends: '2026-03-01' }))[0], /same day/);
		assert.deepEqual(violationsOf('g-03', gate({ starts: '2026-01-01', ends: '2026-01-01' })), []);
	});
	// The other half of the fold: a work row wearing gate fields reads as a gate to every view.
	test('a gate-only field on a work row is refused, naming the field and the fix', () => {
		for (const f of GATE_ONLY) {
			const v = violationsOf('a-01', { kind: 'work', [f]: f === 'blocking' ? true : 'x' });
			assert.equal(v.length, 1, `${f} was not caught`);
			assert.match(v[0], new RegExp(f));
			assert.match(v[0], /kind: gate/);
		}
	});
	test('an ordinary work row, and a row with no kind at all, are clean', () => {
		assert.deepEqual(violationsOf('a-02', { kind: 'work', starts: '2026-01-01', ends: '2026-02-01' }), []);
		assert.deepEqual(violationsOf('a-03', { name: 'no kind field' }), [], 'kind defaults to work');
	});
	test('an empty string counts as absent, not as a value', () => {
		assert.match(violationsOf('g-04', { kind: 'gate', passes_when: '' })[0], /passes_when/);
		assert.deepEqual(violationsOf('a-04', { kind: 'work', evidence: '' }), []);
	});

	test('the script runs over a data root, prints a count, and exits 1 only on a violation', () => {
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-plan-'));
		const dir = path.join(ws, 'data', 'activities');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'a-01.activity.md'), '---\ncode: a-01\nkind: work\n---\nbody\n');
		const bin = path.join(ROOT, 'modules', 'projects', 'bin', 'check-records.mjs');
		const run = () => spawnSync(process.execPath, [bin, '--data-root', path.join(ws, 'data')], { encoding: 'utf8' });
		let r = run();
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /1 checked, 0 violations/);
		fs.writeFileSync(path.join(dir, 'g-01.activity.md'), "---\ncode: g-01\nkind: gate\npasses_when: the client signs\nstatus: done\n---\nbody\n");
		r = run();
		assert.equal(r.status, 1);
		assert.match(r.stderr, /evidence/);
		fs.rmSync(ws, { recursive: true, force: true });
	});
	test('a workspace with the module and no plan yet is not a failure', () => {
		const bin = path.join(ROOT, 'modules', 'projects', 'bin', 'check-records.mjs');
		const r = spawnSync(process.execPath, [bin, '--data-root', '/nonexistent/dt'], { encoding: 'utf8' });
		assert.equal(r.status, 0);
	});
});

describe('the addressbook — every owner field resolves to one users record', () => {
	const users = load('users/collections/users.collection.yaml');
	const proj = load('projects/collections/projects.collection.yaml');
	const act = load('projects/collections/activities.collection.yaml');
	const tasks = load('tasks/collections/tasks.collection.yaml');
	// THE POINT OF THE WHOLE MODEL: a person's own record is the join, so "what is mine" is a record
	// to open rather than four saved searches. Each mirror is owned on the far side.
	const MIRRORS = {
		'projects.lead': 'led_projects',
		'activities.lead': 'led_activities',
		'activities.seats': 'activities',
		'tasks.assignee': 'tasks',
	};
	// ⚠ the plan collections are NAMESPACED (`plan/…`) so a consumer keeps its own bare `projects`
	// and `activities`; a reference to them carries the prefix.
	const REF_OF = { projects: 'plan/projects', activities: 'plan/activities', tasks: 'users' };
	for (const [key, mirror] of Object.entries(MIRRORS)) {
		const [coll, field] = key.split('.');
		const d = { projects: proj, activities: act, tasks }[coll];
		test(`${key} points at users and stamps users.${mirror}`, () => {
			const spec = d.schema.properties[field];
			assert.ok(spec, `${coll} has no ${field}`);
			const ref = spec['x-reference'] ?? spec.items?.['x-reference'];
			assert.equal(ref, 'users', `${key} must point at users, not ${ref}`);
			assert.equal(spec['x-inverse'].field, mirror);
		});
	}
	test('a user links to a contact rather than being one — the two are joined, never merged', () => {
		assert.equal(users.schema.properties.contact['x-reference'], 'contacts');
		assert.equal(users.schema.required.length, 1);
		assert.deepEqual(users.schema.required, ['name']);
	});
	test('handles exist, so an importer can match a row to a person without a second table', () => {
		assert.equal(users.schema.properties.handles.type, 'array');
	});
	// The operator dropped teams on 2026-09-10: a person is the unit work is assigned to.
	// Teams came back on 2026-09-10 after the operator's second look: membership lives on the TEAM, so
	// somebody joins by editing one record and their own page gains the mirror for free. A team is still
	// never the assignee — a task and an activity go to a PERSON.
	test('a team holds its members, and the mirror lands on the person', () => {
		const teams = load('projects/collections/teams.collection.yaml');
		assert.equal(teams.schema.properties.members.items['x-reference'], 'users');
		assert.equal(teams.schema.properties.members['x-inverse'].field, 'teams');
		assert.equal(teams.schema.properties.lead['x-inverse'].field, 'led_teams');
	});
	// WHERE THE CODE LIVES. `repos` is a CORE collection with two engine verbs bound to it
	// (`dt install repos/<id>`, `dt status`), so the reference goes project → repo and never back:
	// the engine cannot name a collection a module ships. Singular AND plural because they answer
	// different questions — "open the code" vs "what does this project touch".
	test('a project points at repos, singular for the front door and plural for the rest', () => {
		assert.equal(proj.schema.properties.repo['x-reference'], 'repos');
		assert.equal(proj.schema.properties.repos.type, 'array');
		assert.equal(proj.schema.properties.repos.items['x-reference'], 'repos');
		// No mirror: `repos` is the engine's, and a module may not stamp a field onto a collection it
		// does not own — the same rule that stripped every x-inverse off the perspective overlays.
		assert.ok(!('x-inverse' in proj.schema.properties.repo), 'a module must not stamp a mirror onto a core collection');
		assert.ok(!('x-inverse' in proj.schema.properties.repos));
	});
		test('assignment is still to a person — no owner field takes a team', () => {
		for (const [d, f] of [[tasks, 'assignee'], [act, 'lead'], [proj, 'lead']]) {
			assert.equal(d.schema.properties[f]['x-reference'], 'users');
		}
		assert.equal(act.schema.properties.team['x-reference'], 'teams', 'a rung may be CARRIED by a team');
		assert.ok(!act.schema.properties.seats.items['x-reference'].includes('teams'));
	});
});

describe('one module, bare names — the fold the operator asked for', () => {
	const tasks = load('tasks/collections/tasks.collection.yaml');
	// The plan, the gates and the people are one module because they are one question: "what happens,
	// and who does it". Names are BARE (`projects`, `activities`, `users`) rather than namespaced: a
	// consumer that had its own `projects` converts it to an overlay and uses the canonical model,
	// which is the operator's instruction — the package is the canonical example, not a guest.
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/projects/package.json'), 'utf8'));
	test('the plan module ships four collections bare, and users is its OWN module at the nav root', () => {
		assert.equal(pkg.name, '@dreamteamer/projects');
		assert.ok(!pkg.dreamteamer.namespaces, 'bare names, so a consumer overlays rather than being prefixed around');
		for (const [f, n] of [['projects', 'projects'], ['activities', 'activities'], ['teams', 'teams']]) {
			assert.equal(load(`projects/collections/${f}.collection.yaml`).name, n);
		}
		// tasks is bare too, in its own module since 2026-10-01
		assert.equal(load('tasks/collections/tasks.collection.yaml').name, 'tasks');
		assert.equal(load('users/collections/users.collection.yaml').name, 'users');
	});
	test('org and plan are gone — there is exactly one home for this model', () => {
		for (const dead of ['modules/org', 'modules/plan']) assert.ok(!fs.existsSync(path.join(ROOT, dead)), `${dead} still exists`);
	});
	test('records land where an un-namespaced collection puts them', () => {
		assert.equal(load('projects/collections/projects.collection.yaml').storage.path, 'data/projects');
		assert.equal(load('projects/collections/activities.collection.yaml').storage.path, 'data/activities');
		assert.equal(load('users/collections/users.collection.yaml').storage.path, 'data/users');
	});
	test('every internal reference is bare too', () => {
		const act = load('projects/collections/activities.collection.yaml').schema.properties;
		assert.equal(act.project['x-reference'], 'projects');
		assert.equal(act.depends_on.items['x-reference'], 'activities');
		assert.equal(act.seats.items['x-reference'], 'users');
	});
	// ⚠ THE NAV LAYOUT IS A MODULE DECISION, not a namespace one. The extension folds a default-namespace
	// collection under its owning module only when that module owns TWO OR MORE of them — so `projects`
	// (four) becomes a folder, and `users` alone renders at the ROOT, which is where the object every
	// other collection points at belongs. Namespacing the plan instead would have renamed `activities` →
	// `projects/activities` in every consumer that had just migrated onto it. Same nav, no renames.
	test('the plan module ships its four collections, and users is its OWN module so it sits at the root', () => {
		for (const c of ['teams', 'projects', 'activities']) {   // tasks: its own module since 2026-10-01, asserted below
			assert.ok(fs.existsSync(path.join(ROOT, `modules/projects/collections/${c}.collection.yaml`)), `missing ${c}`);
		}
		assert.ok(fs.existsSync(path.join(ROOT, 'modules/users/collections/users.collection.yaml')), 'users must be its own module');
		assert.ok(!fs.existsSync(path.join(ROOT, 'modules/projects/collections/users.collection.yaml')), 'and must not also live in projects');
		for (const dead of ['modules/org', 'modules/plan']) assert.ok(!fs.existsSync(path.join(ROOT, dead)), `${dead} still exists`);
		// tasks LEFT projects on 2026-10-01 for a module of its own, needing only users
		assert.ok(fs.existsSync(path.join(ROOT, 'modules/tasks/collections/tasks.collection.yaml')), 'tasks must be its own module');
		assert.ok(!fs.existsSync(path.join(ROOT, 'modules/projects/collections/tasks.collection.yaml')), 'and must not also live in projects');
	});
	test('a task can hang off a project or a plan rung, and both mirror back', () => {
		assert.equal(tasks.schema.properties.project['x-inverse'].field, 'tasks');
		assert.equal(tasks.schema.properties.activity['x-inverse'].field, 'tasks');
	});
	// ⚠ meetings uses users too, and the SPLIT is the point: `attendees` is everyone as contacts (what a
	// calendar invite carries), `ours` is the subset who are users — whose work the meeting IS.
	test('a meeting names our own people as users, alongside attendees as contacts', () => {
		const m = load('meetings/collections/meetings.collection.yaml').schema.properties;
		assert.equal(m.attendees.items['x-reference'], 'contacts');
		assert.equal(m.ours.items['x-reference'], 'users');
		assert.equal(m.ours['x-inverse'].field, 'meetings');
	});
});

describe('the views a person actually opens', () => {
	const view = (m, f) => yaml.load(fs.readFileSync(path.join(ROOT, 'modules', m, 'ui-views', f), 'utf8'));
	// ⚠ SEATS, not lead. Measured on a real 31-row plan: one member LED 3 rows and sat on 16, so banding
	// by lead hid three quarters of their work. `lead` stays a column.
	test('the plan bands by SEATS — the array of who is on a rung — with lead kept as a column', () => {
		const v = view('projects', 'plan-by-person.ui-view.yaml');
		assert.equal(v.options.group_rows_by_field, 'seats');
		assert.equal(v.options.show_ungrouped_rows, true);
		assert.ok(v.options.columns.includes('lead'), 'who is accountable is still worth seeing');
	});
	test('the task board bands by assignee, for the same reason', () => {
		const v = view('tasks', 'tasks-by-assignee.ui-view.yaml');
		assert.equal(v.options.group_rows_by_field, 'assignee');
		assert.equal(v.options.show_ungrouped_rows, true);
	});
	test('gates are a saved FILTER over the one collection, not a second collection', () => {
		const v = view('projects', 'gates.ui-view.yaml');
		assert.equal(v.collection, 'collections/activities');
		assert.deepEqual(v.filter, { kind: { _eq: 'gate' } });
	});
	test('the gantt draws a gate as a point by taking starts and ends from the row', () => {
		const v = view('projects', 'plan-gantt.ui-view.yaml');
		assert.equal(v.options.start_field, 'starts');
		assert.equal(v.options.end_field, 'ends');
	});
});

// ── LANES: the bands a plan is read in ───────────────────────────────────────────────────────────
//
// ⚠ THE QUESTION THIS BLOCK EXISTS TO KEEP ANSWERED: why is a lane a COLLECTION when `phase` is a
// string that already groups, and when `gates` went the other way on 2026-09-10 (a collection
// deleted, folded into `kind: gate`, because a plan reads as one ordered list)? Exactly one property
// survives that test — ORDER. A board draws its bands top to bottom; a free-text value has no order
// but its own spelling, so a plan running Discovery → Build → Hardening → Launch bands as Build ·
// Discovery · Hardening · Launch. The number is a property of the BAND and there are many activities
// per band, so a field on the activity cannot hold it without being restated on every row.
//
// Everything below pins that argument as shape: `order` REQUIRED (the forcing field), `project`
// OPTIONAL (the cross-project workstream, the second thing a string cannot do), and the one rule a
// schema cannot express — a rung may not sit in a band belonging to another plan.
describe('lanes — the grouping axis, as a record rather than a string', () => {
	const lanes = load('projects/collections/activity-lanes.collection.yaml');
	const act = load('projects/collections/activities.collection.yaml');
	const p = lanes.schema.properties;

	test('`order` is REQUIRED — it is the whole reason this is not a second free-text field', () => {
		assert.ok(lanes.schema.required.includes('order'),
			'an unordered lane is `phase` with extra ceremony; ordering is the property that earns the collection');
		assert.equal(p.order.type, 'integer', 'a board sorts on a number, not on a spelling');
	});

	test('`project` is OPTIONAL, because a lane may span plans — and it mirrors back', () => {
		assert.ok(!lanes.schema.required.includes('project'),
			'empty project IS the cross-project workstream — the other thing a field on the activity cannot express');
		assert.equal(p.project['x-reference'], 'projects');
		assert.equal(p.project['x-inverse'].field, 'lanes');
	});

	test('the id is flat, which is the price of an optional project', () => {
		// An id generator throws on a missing field, so an OPTIONAL field cannot be an id segment —
		// `{{ project }}/{{ name | slug }}` would refuse every cross-project lane. Flat it is, and lane
		// names are therefore unique across the workspace.
		assert.equal(lanes.id.generate, '{{ name | slug }}');
		assert.ok(!lanes.id.generate.includes('project'));
	});

	test('nothing was invented beyond the argument — no colour, no lead, no status, no code', () => {
		// Fields that were considered and refused. `color` fights `plan-gantt`'s own
		// `color_by_field: status`; `lead` would make a band an accountability object beside
		// `activities.lead`; `status` belongs to the work in the band, not the band; `code` is what the
		// id already is. A lane carrying five fields nobody sets is worse than one carrying two.
		for (const dead of ['color', 'colour', 'lead', 'status', 'code', 'starts', 'ends']) {
			assert.ok(!(dead in p), `activity-lanes.${dead} was invented — the argument for this collection is ORDER, nothing else`);
		}
		// What it DOES carry, and all of it: the entity shape plus the provenance quad.
		assert.deepEqual(Object.keys(p), ['name', 'order', 'project', 'tags', 'content']);
		assert.deepEqual(lanes.templates, ['collection-templates/projects-provenance']);
	});

	test('a rung points at a lane, and the lane gains the rungs in it', () => {
		assert.equal(act.schema.properties.lane['x-reference'], 'activity-lanes');
		assert.equal(act.schema.properties.lane['x-inverse'].field, 'activities');
	});

	test('`phase` is the OTHER axis and is now a REFERENCE, not free text', () => {
		// Two axes, two questions: `lane` is which TRACK, `phase` is WHEN. It was free text until
		// 2026-09-11 on the grounds that "every shop names its phases differently" — which is true and
		// is an argument for not shipping an ENUM, not for shipping a string. The thing a string could
		// not do is carry the stretch's own DATES, so "when does Build end" could only be answered by
		// taking the max of whatever pointed at it. `bin/migrate-plan.mjs` converts the old form.
		assert.ok('phase' in act.schema.properties, 'phase is the time band and stays');
		assert.equal(act.schema.properties.phase['x-reference'], 'phases');
		assert.equal(act.schema.properties.phase['x-inverse'].field, 'activities');
	});

	test('the swimlane board bands by lane, and shows the residue', () => {
		const v = yaml.load(fs.readFileSync(path.join(ROOT, 'modules/projects/ui-views/plan-by-lane.ui-view.yaml'), 'utf8'));
		assert.equal(v.collection, 'collections/activities');
		assert.equal(v.options.group_rows_by_field, 'lane');
		assert.equal(v.options.show_ungrouped_rows, true, 'a rung with no lane is the residue; hiding it makes an unbanded plan look finished');
		// The gantt keeps banding by phase — a plan that never grew lanes keeps the view it had.
		const g = yaml.load(fs.readFileSync(path.join(ROOT, 'modules/projects/ui-views/plan-gantt.ui-view.yaml'), 'utf8'));
		assert.equal(g.options.group_rows_by_field, 'phase');
	});
});

describe('the guard — a rung may not sit in another plan\'s band', () => {
	// The one lane rule JSON Schema cannot reach: both fields are typed and both resolve, so
	// `dreamteamer check` passes while the board draws this plan's rung inside somebody else's lane.
	const LANES = new Map([['discovery', 'projects/atlas'], ['security', undefined]]);
	const rung = (extra) => ({ kind: 'work', project: 'projects/atlas', ...extra });

	test('a lane belonging to another project is REFUSED, naming both plans', () => {
		const v = violationsOf('a-09', rung({ project: 'projects/beacon', lane: 'activity-lanes/discovery' }), LANES);
		assert.equal(v.length, 1);
		assert.match(v[0], /discovery/);
		assert.match(v[0], /atlas/);
		assert.match(v[0], /beacon/);
	});

	test('the matching project is clean, and so is a lane that spans plans', () => {
		assert.deepEqual(violationsOf('a-10', rung({ lane: 'activity-lanes/discovery' }), LANES), []);
		assert.deepEqual(violationsOf('a-11', rung({ lane: 'activity-lanes/security' }), LANES), [],
			'a lane with no project is the cross-project workstream and matches everything, by design');
	});

	test('an unknown lane is left to the engine, and no lane at all is silent', () => {
		// A dangling `lane` is a hard reference — `dreamteamer check` refuses it, and a guard that
		// duplicated the rule would report the same defect twice under two different words.
		assert.deepEqual(violationsOf('a-12', rung({ lane: 'activity-lanes/nowhere' }), LANES), []);
		assert.deepEqual(violationsOf('a-13', rung({}), LANES), []);
		assert.deepEqual(violationsOf('a-14', rung({ lane: 'activity-lanes/discovery' })), [],
			'with no lanes loaded the rule is inert, so every existing two-argument caller keeps working');
	});

	test('the script loads the lane records itself and exits 1 on the mismatch', () => {
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-lane-'));
		const data = path.join(ws, 'data');
		fs.mkdirSync(path.join(data, 'activities'), { recursive: true });
		fs.mkdirSync(path.join(data, 'activity-lanes'), { recursive: true });
		fs.writeFileSync(path.join(data, 'activity-lanes', 'discovery.activity-lane.md'), '---\nname: Discovery\norder: 10\nproject: projects/atlas\n---\nbody\n');
		fs.writeFileSync(path.join(data, 'activity-lanes', 'security.activity-lane.md'), '---\nname: Security\norder: 20\n---\nbody\n');
		fs.writeFileSync(path.join(data, 'activities', 'a-01.activity.md'), '---\ncode: a-01\nkind: work\nproject: projects/atlas\nlane: activity-lanes/discovery\n---\nbody\n');
		fs.writeFileSync(path.join(data, 'activities', 'a-02.activity.md'), '---\ncode: a-02\nkind: work\nproject: projects/beacon\nlane: activity-lanes/security\n---\nbody\n');
		const bin = path.join(ROOT, 'modules', 'projects', 'bin', 'check-records.mjs');
		const run = () => spawnSync(process.execPath, [bin, '--data-root', data], { encoding: 'utf8' });
		let r = run();
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /2 checked, 0 violations/);
		// Now put a rung of `beacon` into `atlas`'s band.
		fs.writeFileSync(path.join(data, 'activities', 'a-03.activity.md'), '---\ncode: a-03\nkind: work\nproject: projects/beacon\nlane: activity-lanes/discovery\n---\nbody\n');
		r = run();
		assert.equal(r.status, 1);
		assert.match(r.stderr, /a-03/);
		assert.match(r.stderr, /lane/);
		fs.rmSync(ws, { recursive: true, force: true });
	});
});

// ── PHASES: WHEN, as a record — the half of the two-axis argument that was still a string ────────
//
// The lane block above pins ORDER as the thing that earns `activity-lanes` a collection. Run the same
// test on a phase and a DIFFERENT thing comes back, which is why these are two collections: a phase
// has DATES and needs no order (the start IS the order), a lane has an order and no dates. Everything
// below pins that as shape, including the field that is deliberately ABSENT.
describe('phases — WHEN, as a record with its own dates', () => {
	const ph = load('projects/collections/phases.collection.yaml');
	const act = load('projects/collections/activities.collection.yaml');
	const p = ph.schema.properties;

	test('`starts` is REQUIRED and `order` does not exist — the start IS the order', () => {
		assert.ok(ph.schema.required.includes('starts'),
			'a phase without a start is a lane wearing the wrong name');
		assert.ok(!('order' in p),
			'an `order` beside dates lets a plan say Build runs before Discovery while the dates say otherwise, and nothing could adjudicate');
	});

	test('`project` is REQUIRED — unlike a lane, a stretch of calendar belongs to one plan', () => {
		assert.ok(ph.schema.required.includes('project'),
			'a lane may span plans; one plan\'s own calendar may not');
		assert.equal(p.project['x-reference'], 'projects');
		assert.equal(p.project['x-inverse'].field, 'phases');
	});

	test('the id is project-scoped, which a required project is what permits', () => {
		// An id generator throws on a missing field, so only a REQUIRED field can be a segment. That is
		// exactly why `activity-lanes` is flat and this is not — and it lets two plans each have a
		// "Discovery" without a collision.
		assert.equal(ph.id.generate, '{{ project | basename }}/{{ name | slug }}');
	});

	test('`ends` is optional, because the era now running has no decided end', () => {
		assert.ok(!ph.schema.required.includes('ends'));
	});

	test('nothing was invented beyond the argument', () => {
		assert.deepEqual(Object.keys(p), ['name', 'project', 'description', 'starts', 'ends', 'status', 'tags', 'content']);
		assert.deepEqual(ph.templates, ['collection-templates/projects-provenance']);
	});

	test('a rung points at a phase, and the phase gains the rungs in it', () => {
		assert.equal(act.schema.properties.phase['x-reference'], 'phases');
	});
});

// ── DELIVERABLES: what the plan OWES, and the state that is somebody else's to set ───────────────
describe('deliverables — the thing that changes hands', () => {
	const d = load('projects/collections/deliverables.collection.yaml');
	const p = d.schema.properties;

	test('`accepted_by` is a CONTACT, never a user — acceptance is the receiving side\'s act', () => {
		assert.equal(p.accepted_by['x-reference'], 'contacts',
			'a deliverable this workspace accepts for itself has not been accepted');
	});

	test('`delivered` and `accepted` are two states, because the gap between them is where projects stick', () => {
		assert.ok(p.status.enum.includes('delivered'));
		assert.ok(p.status.enum.includes('accepted'));
	});

	test('`activity` is OPTIONAL — several rungs routinely build one artefact', () => {
		assert.ok(!d.schema.required.includes('activity'),
			'naming the nearest rung would be a guess the board then reads as a fact');
		assert.equal(p.activity['x-inverse'].field, 'deliverables');
	});

	test('its `kind` is commercial, and deliberately NOT the observed half\'s MIME enum', () => {
		const observed = load('perspective/collections/perspective/world/deliverables.collection.yaml');
		assert.ok(p.kind.enum.includes('training'), 'what somebody is buying');
		assert.ok(observed.schema.properties.kind.enum.includes('sheet'), 'what a store read found');
		assert.notDeepEqual(p.kind.enum, observed.schema.properties.kind.enum,
			'spelling them alike would assert a Drive read knows an artefact\'s purpose');
	});
});

// ── DECISIONS: one table for two authorities, and the field that makes that safe ──────────────────
describe('decisions — the fold, and what keeps it honest', () => {
	const d = load('projects/collections/decisions.collection.yaml');
	const p = d.schema.properties;

	test('`decided_by` is REQUIRED and closed to person|agent — no "unknown"', () => {
		assert.ok(d.schema.required.includes('decided_by'),
			'folding an agent\'s fork in with a person\'s call is only safe while every record says which');
		assert.deepEqual(p.decided_by.enum, ['person', 'agent'],
			'a decision nobody can attribute is a rumour; the OBSERVED half is where `unknown` is honest');
	});

	test('the observed half DOES carry `unknown` — same question, different authority', () => {
		const observed = load('perspective/collections/perspective/world/decisions.collection.yaml');
		assert.ok(observed.schema.properties.decided_by.enum.includes('unknown'),
			'evidence states a choice and names nobody; a run that guessed would attribute it to the wrong person');
	});

	test('the four fields that make a fork reviewable are REQUIRED, not optional', () => {
		for (const f of ['alternatives', 'rationale', 'reversibility', 'decision']) {
			assert.ok(d.schema.required.includes(f), `${f} is what turns a description of what happened into a decision`);
		}
	});

	test('`wrong_if` is a prediction about THIS world, and `outcome` is its result', () => {
		assert.ok('wrong_if' in p);
		assert.ok(!d.schema.required.includes('wrong_if'), 'a fork with no observable tell is a real category; inventing one is worse');
		assert.deepEqual(p.outcome.enum, ['ratified', 'overturned', 'superseded', 'moot']);
	});

	test('`affects` is a PLAIN string, so a decision outlives what it landed on', () => {
		assert.equal(p.affects.items.type, 'string');
		assert.ok(!p.affects.items['x-reference'],
			'a record that dangles when its subject is deleted is a record that gets deleted with it');
	});

	test('`decided_on` is a date-time — several calls land in a day and the order is the argument', () => {
		assert.equal(p.decided_on.format, 'date-time');
		// ⚠ AN ORDERED LIST since the `code` → `slug` rename. Only the date part reaches the id, and
		// the handle half prefers the record's `slug` but falls back to the name — which is what
		// lets `slug` be optional. A non-latin name still slugOrHashes to `x000w6xq`, but the engine
		// says so on the write now instead of landing it silently.
		assert.deepEqual(d.id.generate, [
			'{{ decided_on | date }}--{{ slug }}',
			'{{ decided_on | date }}--{{ name | slug }}',
		], 'the decision id must prefer the slug and fall back to the name');
	});
});

// ── the risk register — an owner, an indicator, and a gate instead of optimism ──────────────────
// Born in a consuming workspace on 2026-09-12, where 29 risks lived as table rows in a dated note:
// unqueryable, unlinkable to the gates that retire them, invisible on any member's page.
import { riskViolationsOf } from '../../../modules/projects/bin/check-records.mjs';
// the users rule moved with users into its own module; the plan guard no longer carries it
import { userViolationsOf } from '../../../modules/users/bin/check-records.mjs';

describe('risks — what could go wrong, carried with an owner', () => {
	const r = load('projects/collections/risks.collection.yaml');
	const p = r.schema.properties;
	test('the honesty floor is required: code, project, category, likelihood, impact, owner, evidence, status', () => {
		assert.deepEqual([...r.schema.required].sort(),
			['category', 'code', 'evidence', 'impact', 'likelihood', 'name', 'owner', 'project', 'status']);
	});
	test('`unassessed` is a VALUE on both scales — "we looked and the sources do not support a number" is a finding, not a blank', () => {
		assert.ok(p.likelihood.enum.includes('unassessed'));
		assert.ok(p.impact.enum.includes('unassessed'));
	});
	test('a risk is retired by a gate — `gate` points at activities and mirrors back as retires_risks', () => {
		assert.equal(p.gate['x-reference'], 'activities');
		assert.equal(p.gate['x-inverse'].field, 'retires_risks');
	});
	test('the owner mirror is what makes "what does this person carry" one filter', () => {
		assert.equal(p.owner['x-reference'], 'users');
		assert.equal(p.owner['x-inverse'].field, 'risks');
	});
	test('the guard refuses `closed` with nothing quotable behind it', () => {
		const base = { code: 'rk-01', name: 'x', project: 'projects/p', category: 'commercial', likelihood: 'high', impact: 'high', owner: 'users/dana-oren', evidence: 'a review', status: 'closed' };
		assert.equal(riskViolationsOf('rk-01', base).length, 1, 'closed with neither gate nor mitigation must be refused');
		assert.deepEqual(riskViolationsOf('rk-01', { ...base, gate: 'activities/g-01' }), []);
		assert.deepEqual(riskViolationsOf('rk-01', { ...base, mitigation: 'retired by the 2026-10 replan' }), []);
	});
	test('`accepted` is somebody\'s authority — mitigation must say whose', () => {
		const base = { code: 'rk-02', name: 'x', status: 'accepted' };
		assert.equal(riskViolationsOf('rk-02', base).length, 1);
		assert.deepEqual(riskViolationsOf('rk-02', { ...base, mitigation: 'Dana accepted it 2026-09-12' }), []);
	});
});

// ── agents are users too, and every agent has a babysitter ─────────────────────────────────────
describe('users — the agent fold', () => {
	const u = load('users/collections/users.collection.yaml');
	const p = u.schema.properties;
	test('kind is human|agent and defaults to human, so a plain person record needs no ceremony', () => {
		assert.deepEqual(p.kind.enum, ['human', 'agent']);
		assert.equal(p.kind.default, 'human');
	});
	test('human_owner points back at users and mirrors as owned_agents', () => {
		assert.equal(p.human_owner['x-reference'], 'users');
		assert.equal(p.human_owner['x-inverse'].field, 'owned_agents');
	});
	test('an agent with no owner is unsupervised automation — refused', () => {
		assert.equal(userViolationsOf('helper', { name: 'helper', kind: 'agent' }).length, 1);
		assert.deepEqual(userViolationsOf('helper', { name: 'helper', kind: 'agent', human_owner: 'users/dana-oren' },
			new Map([['dana-oren', { kind: 'human' }]])), []);
	});
	test('an agent owned by an agent is a loop with nobody at the end — refused', () => {
		const v = userViolationsOf('helper', { name: 'helper', kind: 'agent', human_owner: 'users/other-bot' },
			new Map([['other-bot', { kind: 'agent' }]]));
		assert.equal(v.length, 1);
	});
	test('a human carrying agent-only fields is a modelling mistake, not a superpower', () => {
		assert.equal(userViolationsOf('dana-oren', { name: 'Dana', human_owner: 'users/x' }).length, 1);
		assert.equal(userViolationsOf('dana-oren', { name: 'Dana', agent: 'agents/helper' }).length, 1);
	});
});
