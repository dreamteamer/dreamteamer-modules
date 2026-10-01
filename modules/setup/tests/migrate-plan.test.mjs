// `activities.phase` BECOMES A REFERENCE, AND THE DATA FOLLOWS — or the migration refuses by name.
//
// The moment `phase` carries `x-reference: phases`, every existing free-text value is a reference to
// a record that does not exist and `dreamteamer check` fails on every activity that has one. There
// is no gradual path. So this file pins the two halves that make the conversion safe:
//
//   1. WHAT IT DERIVES. One `phases` record per (project, value) pair, dated from the activities that
//      carried the value — earliest `starts`, latest `ends`. PROJECT-SCOPED, so two plans that both
//      said "Discovery" get two records rather than colliding.
//   2. WHAT IT REFUSES TO INVENT. A group with no `starts` anywhere cannot be dated, and a date
//      invented here would draw a bar on a gantt indistinguishable from one somebody chose. It is
//      refused BY NAME, with the hand-written command that fixes it — and its activities are left
//      pointing at nothing rather than at a record that does not exist.
//
// Every assertion below fails against the pre-0.9.0 script, because there was none.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, apply, slug, setScalar, scalar } from '../bin/migrate-plan.mjs';

/** A throwaway workspace holding just the activity records a case needs. */
function workspace(records) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-plan-'));
	for (const [id, fm, body = ''] of records) {
		const f = path.join(root, 'data', 'activities', `${id}.activity.md`);
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, `---\n${fm.trim()}\n---\n${body}`);
	}
	return root;
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

describe('what it derives', () => {
	test('one phase record per (project, value), dated from the activities that carried it', () => {
		const ws = workspace([
			['a-01', 'name: scope it\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-02-01\nends: 2026-02-20'],
			['a-02', 'name: interview\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-01-15\nends: 2026-03-01'],
			['a-03', 'name: build it\nproject: projects/atlas\nphase: Build\nstarts: 2026-03-02\nends: 2026-06-30'],
		]);
		const p = plan(ws);
		assert.deepEqual(p.refusals, []);
		assert.equal(p.counts.phases, 2);
		assert.equal(p.counts.activities, 3);
		apply(p);

		const discovery = read(ws, 'data/phases/atlas/discovery.phase.md');
		assert.match(discovery, /^starts: '2026-01-15'$/m, 'the EARLIEST start among the group');
		assert.match(discovery, /^ends: '2026-03-01'$/m, 'the LATEST end among the group');
		assert.match(discovery, /^project: projects\/atlas$/m);
		assert.match(discovery, /derived, not decided/i, 'a reader must not take a derived date for a commitment');
		assert.match(discovery, /^source: migration:migrate-plan$/m);
	});

	test('the activity now carries a reference, and nothing else in its frontmatter moved', () => {
		const ws = workspace([
			['a-01', "name: scope it\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-02-01\nlead: users/dana\ntags:\n  - alpha\n  - beta", 'Body prose survives.\n'],
		]);
		apply(plan(ws));
		const out = read(ws, 'data/activities/a-01.activity.md');
		assert.match(out, /^phase: phases\/atlas\/discovery$/m);
		// EDITED BY LINE: a YAML round-trip would requote every string and reflow the list.
		assert.match(out, /^tags:\n  - alpha\n  - beta$/m, 'a nested list under an untouched key survives byte for byte');
		assert.match(out, /^lead: users\/dana$/m);
		assert.match(out, /Body prose survives\./);
	});

	test('two plans that both said "Discovery" get TWO records — a phase is one plan\'s own calendar', () => {
		const ws = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-02-01'],
			['b-01', 'name: y\nproject: projects/beacon\nphase: Discovery\nstarts: 2026-05-01'],
		]);
		apply(plan(ws));
		assert.ok(exists(ws, 'data/phases/atlas/discovery.phase.md'));
		assert.ok(exists(ws, 'data/phases/beacon/discovery.phase.md'));
		assert.match(read(ws, 'data/activities/a-01.activity.md'), /phases\/atlas\/discovery/);
		assert.match(read(ws, 'data/activities/b-01.activity.md'), /phases\/beacon\/discovery/);
	});

	test('a group with no `ends` anywhere mints a phase with no `ends` — the era still running', () => {
		const ws = workspace([['a-01', 'name: x\nproject: projects/atlas\nphase: Hardening\nstarts: 2026-07-01']]);
		apply(plan(ws));
		const rec = read(ws, 'data/phases/atlas/hardening.phase.md');
		assert.match(rec, /^starts: '2026-07-01'$/m);
		assert.ok(!/^ends:/m.test(rec), 'absent is the honest state of the stretch nobody has decided the end of');
	});
});

describe('what it refuses to invent', () => {
	test('a group with no `starts` anywhere is refused BY NAME, with the command that fixes it', () => {
		const ws = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: Someday'],
			['a-02', 'name: y\nproject: projects/atlas\nphase: Someday'],
		]);
		const p = plan(ws);
		assert.equal(p.refusals.length, 1);
		assert.match(p.refusals[0], /phase "Someday" in project `atlas`/);
		assert.match(p.refusals[0], /2 activities/, 'says how much rests on it');
		assert.match(p.refusals[0], /dt add phases --name "Someday" --project projects\/atlas --starts/, 'hands over the hand-written fix');
		assert.throws(() => apply(p), /refusing to migrate/);
	});

	test('a refused group leaves its activities ALONE — a re-point would dangle', () => {
		const ws = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: Someday'],
			['a-02', 'name: y\nproject: projects/atlas\nphase: Build\nstarts: 2026-03-01'],
		]);
		const p = plan(ws);
		// One group is datable and one is not: only the datable one may be re-pointed, and `apply`
		// refuses the whole run anyway. The plan must not even PROPOSE the dangling edit.
		assert.equal(p.counts.activities, 1);
		assert.deepEqual(p.rewrites.map((r) => r.ref), ['phases/atlas/build']);
	});

	test('a phase with no project is refused — it cannot be scoped, and a guess would be filed as fact', () => {
		const ws = workspace([['a-01', 'name: x\nphase: Discovery\nstarts: 2026-02-01']]);
		const p = plan(ws);
		assert.match(p.refusals[0], /has phase "Discovery" and no `project`/);
	});

	test('a name that slugs to nothing is refused, not filed under a hash', () => {
		// The engine's `slug` filter is `slugOrHash`: a value with no a-z0-9 in it becomes a
		// deterministic `x1a2b3c4`, so the write SUCCEEDS and the id is unreadable — worse than a
		// failure, because nobody notices.
		// ⚠ The fixture is CYRILLIC and not Hebrew, deliberately: this is a public package and the leak
		// gate refuses Hebrew outside the files whose SUBJECT is Hebrew. Any script with no a-z0-9 in it
		// exercises the same branch, so the check costs nothing to relocate.
		assert.equal(slug('абв'), '');
		const ws = workspace([['a-01', 'name: x\nproject: projects/atlas\nphase: "абв"\nstarts: 2026-02-01']]);
		const p = plan(ws);
		assert.equal(p.counts.phases, 0);
		assert.match(p.refusals[0], /slugs to nothing/);
		assert.match(p.refusals[0], /dt add phases --id/, 'names the escape hatch the engine itself recommends');
	});

	// ⚠ THE ONE FOUND BY RUNNING IT ON A REAL PLAN, and the most expensive kind of bug: silent.
	// The engine's `slug` filter keeps only `a-z0-9`, so a non-Latin phase name does not slug to
	// nothing — it slugs to whatever Latin fragment is embedded in it. The first consumer's eight
	// Hebrew phase names collapsed onto four ids; two pairs differed only in the Hebrew. Without this
	// refusal both groups planned, both wrote, and the second overwrote the first: one phase record
	// where two belonged, half the rungs banded under the wrong stretch, and nothing said a word.
	test('two names that collapse onto one id are REFUSED, not silently merged', () => {
		const ws = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: "Stage A - alpha"\nstarts: 2026-02-01'],
			['a-02', 'name: y\nproject: projects/atlas\nphase: "Stage A - beta"\nstarts: 2026-04-01'],
		]);
		// Both slug to the same thing only if the distinguishing part is non-Latin, so use the real
		// shape: Cyrillic tails, one shared Latin fragment.
		const ws2 = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: "Stage A -- альфа"\nstarts: 2026-02-01'],
			['a-02', 'name: y\nproject: projects/atlas\nphase: "Stage A -- бета"\nstarts: 2026-04-01'],
		]);
		assert.equal(slug('Stage A -- альфа'), slug('Stage A -- бета'), 'the fixture must actually collide');
		const p = plan(ws2);
		assert.equal(p.counts.phases, 0, 'neither is written — a collision is refused, never resolved by writing order');
		assert.equal(p.counts.activities, 0, 'and neither activity is re-pointed');
		assert.match(p.refusals[0], /collapse onto the single id/);
		assert.match(p.refusals[0], /--id "Stage A -- альфа=<handle>"/, 'hands over the exact flag that fixes it');
		// The distinct-name case is unaffected.
		assert.deepEqual(plan(ws).refusals, []);
	});

	test('an explicit --id overrides the slug, which is how a non-Latin plan migrates at all', () => {
		const ws = workspace([
			['a-01', 'name: x\nproject: projects/atlas\nphase: "Stage A -- альфа"\nstarts: 2026-02-01'],
			['a-02', 'name: y\nproject: projects/atlas\nphase: "Stage A -- бета"\nstarts: 2026-04-01'],
		]);
		const ids = new Map([['Stage A -- альфа', 'stage-a-alpha'], ['Stage A -- бета', 'stage-a-beta']]);
		const p = plan(ws, { ids });
		assert.deepEqual(p.refusals, []);
		assert.equal(p.counts.phases, 2);
		apply(p);
		assert.ok(exists(ws, 'data/phases/atlas/stage-a-alpha.phase.md'));
		assert.ok(exists(ws, 'data/phases/atlas/stage-a-beta.phase.md'));
		assert.match(read(ws, 'data/activities/a-01.activity.md'), /^phase: phases\/atlas\/stage-a-alpha$/m);
		// And the NAME on the record is still the person's own words, never the handle.
		assert.match(read(ws, 'data/phases/atlas/stage-a-alpha.phase.md'), /^name: "Stage A -- альфа"$/m);
	});

	test('an existing phase record is never overwritten', () => {
		const ws = workspace([['a-01', 'name: x\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-02-01']]);
		const f = path.join(ws, 'data/phases/atlas/discovery.phase.md');
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, '---\nname: Discovery\n---\nhand written\n');
		const p = plan(ws);
		assert.match(p.refusals[0], /already exists/);
		assert.match(read(ws, 'data/phases/atlas/discovery.phase.md'), /hand written/);
	});
});

describe('idempotence', () => {
	test('a second run finds nothing — a value that already reads as a reference is left alone', () => {
		const ws = workspace([['a-01', 'name: x\nproject: projects/atlas\nphase: Discovery\nstarts: 2026-02-01']]);
		apply(plan(ws));
		const second = plan(ws);
		assert.deepEqual(second.refusals, []);
		assert.equal(second.counts.phases, 0);
		assert.equal(second.counts.activities, 0);
		assert.equal(second.counts.already, 1, 'the reference is counted as already-migrated, not as absent');
	});

	test('an activity with no phase at all is untouched and uncounted', () => {
		const ws = workspace([['a-01', 'name: x\nproject: projects/atlas\nstarts: 2026-02-01']]);
		const p = plan(ws);
		assert.equal(p.counts.scanned, 1);
		assert.equal(p.counts.activities, 0);
		assert.equal(p.counts.already, 0);
	});
});

describe('the frontmatter editor, which everything above rests on', () => {
	test('setScalar replaces only the value, at the head of a line', () => {
		const fm = 'name: x\nphase: Discovery\nnotes: mentions phase: elsewhere';
		const out = setScalar(fm, 'phase', 'phases/atlas/discovery');
		assert.equal(out, 'name: x\nphase: phases/atlas/discovery\nnotes: mentions phase: elsewhere');
	});

	test('scalar reads a quoted value and treats an empty one as absent', () => {
		assert.equal(scalar("phase: 'Discovery'", 'phase'), 'Discovery');
		assert.equal(scalar('phase:', 'phase'), undefined, 'an empty value is absent, not the empty string');
	});
});
