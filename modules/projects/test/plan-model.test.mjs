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
import { decisionViolationsOf } from '../../../modules/projects/bin/check-records.mjs';
import { ALL, OWNER, targetsOf } from '../../../tests/helpers/descriptors.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const load = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, 'modules', rel), 'utf8'));
/** The fields a person must set: the ones marked `required: true`, in descriptor order. */
const requiredOf = (d) => Object.entries(d.fields).filter(([, s]) => s.required).map(([k]) => k);
/** The fields a person writes — everything but the generated far sides of other collections' references. */
const authored = (d) => Object.keys(d.fields).filter((k) => !d.fields[k].mirror_of);
/**
 * The generated far side of `<coll>.<field>` on `target`: the field there whose `mirror_of` is `field`
 * and whose type is `coll`, with the module that declares it — the target's own descriptor or an
 * overlay. Undefined when nothing mirrors it.
 */
function mirrorOf(coll, field, target) {
	for (const d of ALL.filter((x) => x.doc.name === target)) {
		for (const [name, spec] of Object.entries(d.doc.fields ?? {})) {
			if (spec.mirror_of === field && targetsOf(spec).includes(coll)) return { module: d.module, name, spec };
		}
	}
	return undefined;
}

describe('the addressbook — every owner field resolves to one users record', () => {
	const users = load('users/collections/users.collection.yaml');
	const proj = load('projects/collections/projects.collection.yaml');
	const tasks = load('tasks/collections/tasks.collection.yaml');
	// THE POINT OF THE WHOLE MODEL: a person's own record is the join, so "what is mine" is a record
	// to open rather than four saved searches. Each mirror is a field on `users` with `mirror_of`,
	// declared by the module that owns the pointing collection — an overlay when that is not `users`,
	// so the mirror exists only when its owner is installed.
	const MIRRORS = {
		'projects.lead': 'led_projects',
		'tasks.assignee': 'tasks',
	};
	// ⚠ the plan collections are NAMESPACED (`plan/…`) so a consumer keeps its own bare `projects`
	// and `activities`; a reference to them carries the prefix.
	const REF_OF = { projects: 'plan/projects', tasks: 'users' };
	for (const [key, mirror] of Object.entries(MIRRORS)) {
		const [coll, field] = key.split('.');
		const d = { projects: proj, tasks }[coll];
		test(`${key} points at users and stamps users.${mirror}`, () => {
			const spec = d.fields[field];
			assert.ok(spec, `${coll} has no ${field}`);
			assert.equal(spec.type, 'users', `${key} must point at users, not ${spec.type}`);
			const far = mirrorOf(coll, field, 'users');
			assert.equal(far?.name, mirror);
			assert.equal(far.spec.many, true);
			assert.equal(far.module, OWNER.get(coll), `users.${mirror} must be declared by ${coll}'s own module`);
		});
	}
	test('a user links to a contact rather than being one — the two are joined, never merged', () => {
		assert.equal(users.fields.contact.type, 'contacts');
		assert.equal(requiredOf(users).length, 1);
		assert.deepEqual(requiredOf(users), ['name']);
	});
	test('handles exist, so an importer can match a row to a person without a second table', () => {
		assert.equal(users.fields.handles.many, true);
	});
	// The operator dropped teams on 2026-09-10: a person is the unit work is assigned to.
	// Teams came back on 2026-09-10 after the operator's second look: membership lives on the TEAM, so
	// somebody joins by editing one record and their own page gains the mirror for free. A team is still
	// never the assignee — a task and an activity go to a PERSON.
	// Teams MOVED to users on 2026-10-31 (cr-modules-002): a group of people needs only the people, so a
	// workspace with users and no plan can still group them. Projects keeps `projects.teams`, peers
	// `teams`, and declares the one mirror it owns — `teams.projects` — as an overlay of teams.
	test('a team holds its members, and the mirror lands on the person — both declared by users', () => {
		const teams = load('users/collections/teams.collection.yaml');
		assert.equal(OWNER.get('teams'), 'users', 'teams ships with users');
		assert.equal(teams.fields.members.type, 'users');
		assert.equal(teams.fields.members.many, true);
		assert.equal(mirrorOf('teams', 'members', 'users')?.name, 'teams');
		assert.equal(mirrorOf('teams', 'members', 'users')?.module, 'users', 'users.teams is native to users, not an overlay');
		assert.equal(mirrorOf('teams', 'lead', 'users')?.name, 'led_teams');
		assert.equal(mirrorOf('teams', 'lead', 'users')?.module, 'users');
		assert.ok(!teams.fields.projects, 'users cannot see projects: the far side of projects.teams is projects\' to declare');
	});
	test('projects points at teams as a peer, and stamps only its own mirror onto the team', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/projects/package.json'), 'utf8'));
		assert.ok(pkg.dreamteamer.peer_collections.includes('teams'), 'projects.teams names a collection projects no longer ships');
		assert.equal(proj.fields.teams.type, 'teams');
		const overlay = load('projects/collections/teams.collection.yaml');
		assert.equal(overlay.overlay, true, 'projects ships no teams descriptor of its own');
		assert.deepEqual(Object.keys(overlay.fields), ['projects']);
		assert.equal(mirrorOf('projects', 'teams', 'teams')?.module, 'projects');
		const usersOverlay = load('projects/collections/users.collection.yaml');
		for (const f of ['teams', 'led_teams']) assert.ok(!usersOverlay.fields[f], `projects' users overlay still declares ${f}`);
	});
	// WHERE THE CODE LIVES. `repos` is a CORE collection with two engine verbs bound to it
	// (`dt install repos/<id>`, `dt status`), so the reference goes project → repo and never back:
	// the engine cannot name a collection a module ships. Singular AND plural because they answer
	// different questions — "open the code" vs "what does this project touch".
	test('a project points at repos, singular for the front door and plural for the rest', () => {
		assert.equal(proj.fields.repo.type, 'repos');
		assert.equal(proj.fields.repos.type, 'repos');
		assert.equal(proj.fields.repos.many, true);
		// No mirror: `repos` is the engine's, and a module may not stamp a field onto a collection it
		// does not own — the same rule that stripped every mirror off the perspective overlays.
		assert.equal(mirrorOf('projects', 'repo', 'repos'), undefined, 'a module must not stamp a mirror onto a core collection');
		assert.equal(mirrorOf('projects', 'repos', 'repos'), undefined);
		assert.ok(!ALL.some((d) => d.doc.name === 'repos'), 'no module ships a descriptor for the engine\'s repos');
	});
		test('assignment is still to a person — no owner field takes a team', () => {
		for (const [d, f] of [[tasks, 'assignee'], [proj, 'lead']]) {
			assert.equal(d.fields[f].type, 'users');
		}
		assert.ok(!targetsOf(proj.fields.lead).includes('teams'), 'a project is led by a person; a team is staffed, never accountable');
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
		for (const [f, n] of [['projects', 'projects'], ['decisions', 'decisions']]) {
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
		assert.equal(load('projects/collections/decisions.collection.yaml').storage.path, 'data/decisions');
		assert.equal(load('users/collections/users.collection.yaml').storage.path, 'data/users');
	});
	test('every internal reference is bare too', () => {
		const del = load('projects/collections/deliverables.collection.yaml').fields;
		assert.equal(del.project.type, 'projects');
		assert.equal(del.owner.type, 'users');
		const risk = load('projects/collections/risks.collection.yaml').fields;
		assert.equal(risk.project.type, 'projects');
		assert.equal(risk.owner.type, 'users');
	});
	// ⚠ THE NAV LAYOUT IS A MODULE DECISION, not a namespace one. The extension folds a default-namespace
	// collection under its owning module only when that module owns TWO OR MORE of them — so `projects`
	// (four) becomes a folder, and `users` alone renders at the ROOT, which is where the object every
	// other collection points at belongs. Namespacing the plan instead would have renamed `activities` →
	// `projects/activities` in every consumer that had just migrated onto it. Same nav, no renames.
	test('the plan module ships its four collections, and users is its OWN module so it sits at the root', () => {
		for (const c of ['projects', 'decisions', 'deliverables', 'risks']) {   // tasks: its own module, asserted below; teams: users, above
			assert.ok(fs.existsSync(path.join(ROOT, `modules/projects/collections/${c}.collection.yaml`)), `missing ${c}`);
			assert.equal(OWNER.get(c), 'projects', c);
		}
		assert.ok(fs.existsSync(path.join(ROOT, 'modules/users/collections/users.collection.yaml')), 'users must be its own module');
		// projects carries a users OVERLAY — the mirrors of its own owner fields — and never the collection
		const overlay = path.join(ROOT, 'modules/projects/collections/users.collection.yaml');
		assert.ok(!fs.existsSync(overlay) || yaml.load(fs.readFileSync(overlay, 'utf8')).overlay === true, 'and must not also live in projects');
		assert.equal(OWNER.get('users'), 'users');
		for (const dead of ['modules/org', 'modules/plan']) assert.ok(!fs.existsSync(path.join(ROOT, dead)), `${dead} still exists`);
		// tasks LEFT projects on 2026-10-01 for a module of its own, needing only users
		assert.ok(fs.existsSync(path.join(ROOT, 'modules/tasks/collections/tasks.collection.yaml')), 'tasks must be its own module');
		assert.ok(!fs.existsSync(path.join(ROOT, 'modules/projects/collections/tasks.collection.yaml')), 'and must not also live in projects');
	});
	test('a task hangs off a project and mirrors back; the plan has no rung for it to hang off any more', () => {
		assert.equal(tasks.fields.project.type, 'projects');
		assert.equal(tasks.fields.activity, undefined, 'tasks plan the work; there is no activity to point at');
		// the mirror is an overlay in the tasks module, so a plan without tasks carries none
		const far = mirrorOf('tasks', 'project', 'projects');
		assert.equal(far?.name, 'tasks');
		assert.equal(far.module, 'tasks');
	});
	// ⚠ meetings uses users too, and the SPLIT is the point: `attendees_contacts` is everyone as contacts
	// (the invite's list, resolved), `ours` is the subset who are users — whose work the meeting IS.
	test('a meeting names our own people as users, alongside attendees as contacts', () => {
		const m = load('meetings/collections/meetings.collection.yaml').fields;
		assert.equal(m.attendees_contacts.type, 'contacts');
		assert.equal(m.attendees_contacts.many, true);
		assert.equal(m.ours.type, 'users');
		assert.equal(m.ours.many, true);
		assert.equal(mirrorOf('meetings', 'ours', 'users')?.name, 'meetings');
	});
});

// ── DELIVERABLES: what the plan OWES, and the state that is somebody else's to set ───────────────
describe('deliverables — the thing that changes hands', () => {
	const d = load('projects/collections/deliverables.collection.yaml');
	const p = d.fields;

	test('`accepted_by` is a CONTACT, never a user — acceptance is the receiving side\'s act', () => {
		assert.equal(p.accepted_by.type, 'contacts',
			'a deliverable this workspace accepts for itself has not been accepted');
	});

	test('`delivered` and `accepted` are two states, because the gap between them is where projects stick', () => {
		assert.ok(p.status.enum.includes('delivered'));
		assert.ok(p.status.enum.includes('accepted'));
	});

	test('its `kind` is commercial, and deliberately NOT the observed half\'s MIME enum', () => {
		const observed = load('perspective/collections/perspective/deliverables.collection.yaml');
		assert.ok(p.kind.enum.includes('training'), 'what somebody is buying');
		assert.ok(observed.fields.kind.enum.includes('sheet'), 'what a store read found');
		assert.notDeepEqual(p.kind.enum, observed.fields.kind.enum,
			'spelling them alike would assert a Drive read knows an artefact\'s purpose');
	});
});

// ── DECISIONS: one table for two authorities, and the field that makes that safe ──────────────────
describe('decisions — the fold, and what keeps it honest', () => {
	const d = load('projects/collections/decisions.collection.yaml');
	const p = d.fields;

	test('`decided_by` is REQUIRED and closed to person|agent|unknown', () => {
		assert.ok(requiredOf(d).includes('decided_by'),
			'folding an agent\'s fork in with a person\'s call is only safe while every record says which');
		assert.deepEqual(p.decided_by.enum, ['person', 'agent', 'unknown'],
			'a third value for a row read out of a source that names nobody — gated below, never a default');
		assert.equal(p.decided_by.default, undefined, '`unknown` is a claim about the source, not a value to fall into');
	});

	test('an `unknown` decision must cite its source, and the checker refuses one that also names a decider', () => {
		const sourced = decisionViolationsOf('x', { decided_by: 'unknown', source: 'DECISION-LOG.md, row 4' });
		assert.deepEqual(sourced, []);
		assert.match(decisionViolationsOf('x', { decided_by: 'unknown' }).join('\n'), /needs `source`/);
		assert.match(decisionViolationsOf('x', { decided_by: 'unknown', source: 's', decider: 'users/dana' }).join('\n'), /must not carry/);
		const rule = d.constraints.find((c) => c.if.properties.decided_by.const === 'unknown');
		assert.deepEqual(rule.then.required, ['source']);
	});

	test('the observed half DOES carry `unknown` — same question, different authority', () => {
		const observed = load('perspective/collections/perspective/decisions.collection.yaml');
		assert.ok(observed.fields.decided_by.enum.includes('unknown'),
			'evidence states a choice and names nobody; a run that guessed would attribute it to the wrong person');
	});

	test('the four fields that make a fork reviewable are REQUIRED of a person or an agent, never invented for an unknown', () => {
		assert.ok(requiredOf(d).includes('decision'), 'what was chosen is required of every row');
		const rule = d.constraints.find((c) => c.if.properties.decided_by.enum);
		assert.deepEqual(rule.if.properties.decided_by.enum, ['person', 'agent']);
		assert.deepEqual(rule.if.required, ['decided_by'], 'an if that names no required passes vacuously on a record lacking the field');
		assert.deepEqual(rule.then.required, ['alternatives', 'rationale', 'reversibility'],
			'what turns a description of what happened into a decision — asked of whoever wrote their own fork down');
		for (const f of ['alternatives', 'rationale', 'reversibility']) assert.ok(!requiredOf(d).includes(f), `${f} is conditional, not field-level required`);
	});

	test('`wrong_if` is a prediction about THIS world, and `outcome` is its result', () => {
		assert.ok('wrong_if' in p);
		assert.ok(!requiredOf(d).includes('wrong_if'), 'a fork with no observable tell is a real category; inventing one is worse');
		assert.deepEqual(p.outcome.enum, ['ratified', 'overturned', 'superseded', 'moot']);
	});

	test('`affects` is a PLAIN string, so a decision outlives what it landed on', () => {
		assert.equal(p.affects.type, 'string');
		assert.equal(p.affects.many, true);
		assert.deepEqual(targetsOf(p.affects), [],
			'a record that dangles when its subject is deleted is a record that gets deleted with it');
	});

	test('`decided_on` is a date-time — several calls land in a day and the order is the argument', () => {
		assert.equal(p.decided_on.type, 'datetime');
		// ⚠ AN ORDERED LIST since the `code` → `slug` rename. Only the date part reaches the id, and
		// the handle half prefers the record's `slug` but falls back to the name — which is what
		// lets `slug` be optional. A non-latin name still slugOrHashes to `x000w6xq`, but the engine
		// says so on the write now instead of landing it silently.
		assert.deepEqual(d.ids.from, [
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
	const p = r.fields;
	test('the honesty floor is required: code, project, category, likelihood, impact, owner, evidence, status', () => {
		assert.deepEqual([...requiredOf(r)].sort(),
			['category', 'code', 'evidence', 'impact', 'likelihood', 'name', 'owner', 'project', 'status']);
	});
	test('`unassessed` is a VALUE on both scales — "we looked and the sources do not support a number" is a finding, not a blank', () => {
		assert.ok(p.likelihood.enum.includes('unassessed'));
		assert.ok(p.impact.enum.includes('unassessed'));
	});
	test('a risk carries no gate — the plan has no rungs, so what retires it is written in mitigation', () => {
		assert.equal(p.gate, undefined);
	});
	test('the owner mirror is what makes "what does this person carry" one filter', () => {
		assert.equal(p.owner.type, 'users');
		assert.equal(mirrorOf('risks', 'owner', 'users')?.name, 'risks');
	});
	test('the guard refuses `closed` with nothing quotable behind it', () => {
		const base = { code: 'rk-01', name: 'x', project: 'projects/p', category: 'commercial', likelihood: 'high', impact: 'high', owner: 'users/dana-oren', evidence: 'a review', status: 'closed' };
		assert.equal(riskViolationsOf('rk-01', base).length, 1, 'closed with no mitigation must be refused');
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
	const p = u.fields;
	test('kind is human|agent and defaults to human, so a plain person record needs no ceremony', () => {
		assert.deepEqual(p.kind.enum, ['human', 'agent']);
		assert.equal(p.kind.default, 'human');
	});
	test('human_owner points back at users and mirrors as owned_agents', () => {
		assert.equal(p.human_owner.type, 'users');
		assert.equal(mirrorOf('users', 'human_owner', 'users')?.name, 'owned_agents');
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

// ── `slug` and `code` — one field name used to mean two things ───────────────────────────────────
// `activities.code` (`a-01`) and `risks.code` (`rk-01`) are identifiers a room says out loud and reads
// in ORDER — codes, required. On `tasks`, `decisions` and `deliverables` the field existed
// for one reason: a name in any script has to produce a typeable id, because the engine's `slug`
// filter returns a hash when a value has no latin characters. That is a slug, optional, and the id
// prefers it and falls back to the name.
describe('slug and code — a latin handle is not a plan code', () => {
	const SLUGGED = ['tasks', 'decisions', 'deliverables'];
	const CODED = ['risks'];
	const desc = (c) => load(`${OWNER.get(c)}/collections/${c}.collection.yaml`);

	test('the three latin-handle collections carry an OPTIONAL `slug` and no `code`', () => {
		for (const c of SLUGGED) {
			const d = desc(c);
			assert.ok(d.fields.slug, `${c} has no slug`);
			assert.equal(d.fields.code, undefined, `${c} still has a code`);
			assert.ok(!requiredOf(d).includes('slug'), `${c}.slug must be OPTIONAL — the whole point of the ordered id template`);
			assert.equal(d.fields.slug.pattern, '^[a-z0-9][a-z0-9-]*$');
		}
	});

	test('`risks` KEEPS its code, required', () => {
		// ⚠ The distinction is the point, so it is asserted rather than assumed. A later sweep that
		// "tidies" these into slugs would be undoing a deliberate decision.
		for (const c of CODED) {
			const d = desc(c);
			assert.ok(d.fields.code, `${c} lost its code`);
			assert.equal(d.fields.slug, undefined, `${c} must not have a slug`);
			assert.ok(requiredOf(d).includes('code'), `${c}.code must stay required`);
		}
	});

	test('every ids.from is an ORDERED LIST whose second arm is the name', () => {
		for (const c of SLUGGED) {
			const from = desc(c).ids.from;
			assert.ok(Array.isArray(from), `${c}.ids.from must be a list`);
			assert.equal(from.length, 2, `${c} needs exactly the slug arm and the name arm`);
			assert.match(from[0], /\{\{\s*slug\s*\}\}/, `${c}: the first arm must use the slug FIELD`);
			assert.match(from[1], /\{\{\s*name\s*\|\s*slug\s*\}\}/, `${c}: the second arm must be the name through the slug FILTER`);
			// The two arms must agree on everything except the final segment, or an id would move
			// depending on whether a record happened to carry a slug.
			const shape = (t) => t.replace(/\{\{\s*slug\s*\}\}/, 'X').replace(/\{\{\s*name\s*\|\s*slug\s*\}\}/, 'X');
			assert.equal(shape(from[0]), shape(from[1]), `${c}: the two arms produce differently shaped ids`);
		}
	});
});
