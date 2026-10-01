// THE 0.7.0 MIGRATION — the observed world into the `perspective/world` namespace.
//
// ⚠ WHAT MAKES IT CHEAP, and what this suite exists to hold: NO ID CHANGES. Every record keeps
// `<contributor>/<slug>` exactly as it was, so nothing has to be re-derived and no retrospective has
// to be repeated. That matters because re-running a retrospective is measurably the WRONG migration
// instrument — a consumer counted its 205 perspective records by writer and found 72 were script
// output (those come back) and 133 were a model pass or rows a person dictated (a re-run produces
// DIFFERENT ones, at the cost of the original run). None of that applies here, and these tests are
// what keeps it that way: if an id ever moves, the first test fails.
//
// ⚠ AND WHY THE PACKAGE SHIPS THIS AT ALL. `dt rename collections/<old> <new>` is the engine's own
// reference-carrying rename and it REFUSES a package-shipped collection outright — "ships from
// node_modules — a write there is erased by the next `npm install`". A collection whose descriptor
// belongs to a package has to be migrated by that package.
//
// Every fixture here is authored in this file and synthetic.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, apply, editFrontmatter, rewriteRefs, scanSources, rewriteSources, main, MOVES } from '../bin/migrate-world.mjs';

const SLUG = 'dana-o';
const RUN = 'perspective/retrospective-sessions/2026-09-08--dana-o';
const RUN2 = 'perspective/retrospective-sessions/2026-11-02--dana-o';

function workspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
	const put = (rel, text) => {
		const f = path.join(root, 'data', 'perspective', rel);
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, text);
		return f;
	};
	put(`activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: rewrote auth\nstarted: "2026-03-04"\n`
		+ `project: perspective/projects/${SLUG}/northwind-api\n`
		+ `collaborators:\n  - perspective/collaborators/${SLUG}/sam-diaz\n---\n`
		+ `Followed on from perspective/activities/${SLUG}/2026-02-01--spiked-auth.\n`);
	put(`activities/${SLUG}/2026-02-01--spiked-auth.activity.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: spiked auth\nstarted: "2026-02-01"\n---\n`);
	put(`projects/${SLUG}/northwind-api.project.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: northwind api\nkind: product\n---\n`);
	put(`collaborators/${SLUG}/sam-diaz.collaborator.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: Sam Diaz\nhandles:\n  - sam.d@bright.example\n---\n`);
	put(`goals/${SLUG}/auth-survives-a-restart.goal.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: auth survives a restart\n`
		+ `statement: |\n  A session outlives a redeploy.\n  Nobody signs in twice in a day.\n`
		+ `horizon: in-flight\nevidence_count: 3\nstanding: corroborated\n`
		+ `activities:\n  - perspective/activities/${SLUG}/2026-03-04--rewrote-auth\n---\n`
		+ 'Read backwards out of the work. (3 decisions)\n');
	put(`sources/${SLUG}/git-repo--northwind-api.source.md`,
		`---\nretrospective: ${RUN}\nlast_seen_in: ${RUN2}\ncontributor: ${SLUG}\nkind: git-repo\n`
		+ 'label: northwind-api\nreach: available\n---\n');
	// A record OUTSIDE the moved collections that still cites one — the sweep has to reach it.
	put(`findings/${SLUG}/pattern--auth-churn.finding.md`,
		`---\nretrospective: ${RUN}\ncontributor: ${SLUG}\nname: auth churn\nkind: process\n`
		+ `evidence:\n  - perspective/activities/${SLUG}/2026-03-04--rewrote-auth\nevidence_count: 1\nstanding: anecdote\n---\n`
		+ `See also perspective/projects/${SLUG}/northwind-api. (1 activity)\n`);
	return root;
}

const read = (root, rel) => fs.readFileSync(path.join(root, 'data', 'perspective', rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, 'data', 'perspective', rel));

describe('the move', () => {
	test('planning writes nothing at all', () => {
		const root = workspace();
		const before = fs.readFileSync(path.join(root, 'data', 'perspective', 'activities', SLUG, '2026-02-01--spiked-auth.activity.md'), 'utf8');
		const p = plan(root);
		assert.ok(p.moves.length >= 5);
		assert.equal(fs.readFileSync(path.join(root, 'data', 'perspective', 'activities', SLUG, '2026-02-01--spiked-auth.activity.md'), 'utf8'), before);
	});

	test('every record lands in the world namespace, keeping the id it had', () => {
		const root = workspace();
		apply(plan(root));
		// ⚠ THE ASSERTION THE WHOLE DESIGN RESTS ON: the id is byte-identical on both sides of the
		// move. Only the folder changed, so nothing needs re-deriving and no run is repeated.
		assert.ok(exists(root, `world/activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`));
		assert.ok(exists(root, `world/projects/${SLUG}/northwind-api.project.md`));
		assert.ok(exists(root, `world/goals/${SLUG}/auth-survives-a-restart.goal.md`));
		assert.ok(!exists(root, `activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`));
		assert.ok(!fs.existsSync(path.join(root, 'data', 'perspective', 'projects')), 'the emptied folder is removed');
	});

	test('collaborators become users, and the record file is re-suffixed with them', () => {
		const root = workspace();
		apply(plan(root));
		assert.ok(exists(root, `world/users/${SLUG}/sam-diaz.user.md`), 'the suffix must follow the collection name');
		assert.ok(!exists(root, `world/users/${SLUG}/sam-diaz.collaborator.md`));
	});
});

describe('the references', () => {
	test('a reference follows the record it names — frontmatter AND body', () => {
		const root = workspace();
		apply(plan(root));
		const a = read(root, `world/activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`);
		assert.match(a, new RegExp(`^project: perspective/world/projects/${SLUG}/northwind-api$`, 'm'));
		assert.match(a, new RegExp(`- perspective/world/users/${SLUG}/sam-diaz`));
		assert.match(a, new RegExp(`perspective/world/activities/${SLUG}/2026-02-01--spiked-auth`), 'the body reference followed too');
	});

	test('a record outside the moved collections is swept as well', () => {
		const root = workspace();
		apply(plan(root));
		const f = read(root, `findings/${SLUG}/pattern--auth-churn.finding.md`);
		assert.match(f, new RegExp(`- perspective/world/activities/${SLUG}/2026-03-04--rewrote-auth`));
		assert.match(f, new RegExp(`perspective/world/projects/${SLUG}/northwind-api`), 'the body too');
	});

	test('a longer collection name is never matched inside a shorter one', () => {
		// `perspective/activities/` must not be found inside `perspective/activity-weeks/`, which is a
		// different collection that did NOT move.
		const before = `perspective/activity-weeks/${SLUG}/git-repo--api/2026-W31`;
		assert.equal(rewriteRefs(before), before);
	});
});

describe('the field renames', () => {
	test('an observed goal spells its test and its state the way a declared one does', () => {
		const root = workspace();
		apply(plan(root));
		const g = read(root, `world/goals/${SLUG}/auth-survives-a-restart.goal.md`);
		assert.match(g, /^done_when: \|$/m, 'statement → done_when, and the block scalar survives');
		assert.match(g, /^ {2}A session outlives a redeploy\.$/m);
		assert.match(g, /^ {2}Nobody signs in twice in a day\.$/m);
		assert.match(g, /^status: in-flight$/m, 'horizon → status');
		assert.doesNotMatch(g, /^statement:/m);
		assert.doesNotMatch(g, /^horizon:/m);
	});

	test('a rename is scoped to its collection — nothing else grows the new key', () => {
		const root = workspace();
		apply(plan(root));
		assert.doesNotMatch(read(root, `world/projects/${SLUG}/northwind-api.project.md`), /^done_when:/m);
	});
});

describe('sources become many-to-many with the run', () => {
	test('both scalars fold into one list, first run first', () => {
		const root = workspace();
		apply(plan(root));
		const s = read(root, `sources/${SLUG}/git-repo--northwind-api.source.md`);
		assert.match(s, new RegExp(`^retrospectives:\\n  - ${RUN}\\n  - ${RUN2}$`, 'm'),
			'`retrospective` was the FIRST run and `last_seen_in` the most recent — that IS the order a sorted list gives');
		assert.doesNotMatch(s, /^retrospective:/m, 'the scalar is gone, not kept beside the list');
		assert.doesNotMatch(s, /^last_seen_in:/m);
	});

	test('a source already migrated is left exactly as it is', () => {
		const fm = `retrospectives:\n  - ${RUN}\n  - ${RUN2}\ncontributor: ${SLUG}\nkind: git-repo`;
		assert.equal(editFrontmatter(fm, 'sources'), fm);
	});

	test('the fold does not touch any other collection', () => {
		const fm = `retrospective: ${RUN}\ncontributor: ${SLUG}`;
		assert.equal(editFrontmatter(fm, 'world/activities'), fm);
	});
});

describe('the guarantees', () => {
	test('a second run finds nothing — it is idempotent', () => {
		const root = workspace();
		apply(plan(root));
		const p2 = plan(root);
		assert.deepEqual(p2.moves, []);
		assert.deepEqual(p2.refusals, []);
		const before = read(root, `world/goals/${SLUG}/auth-survives-a-restart.goal.md`);
		apply(p2);
		assert.equal(read(root, `world/goals/${SLUG}/auth-survives-a-restart.goal.md`), before, 'the second pass changed a byte');
	});

	test('it refuses rather than merging into a destination that already exists', () => {
		const root = workspace();
		fs.mkdirSync(path.join(root, 'data', 'perspective', 'world', 'projects'), { recursive: true });
		const p = plan(root);
		assert.ok(p.refusals.some((r) => /world\/projects already exists/.test(r)), p.refusals.join('\n'));
		assert.throws(() => apply(p), /refusing to migrate/);
	});

	test('it refuses a record whose suffix is not the one its collection uses', () => {
		const root = workspace();
		fs.writeFileSync(path.join(root, 'data', 'perspective', 'activities', SLUG, 'stray.note.md'), '---\n---\n');
		const p = plan(root);
		assert.ok(p.refusals.some((r) => /does not carry the \.activity\.md suffix/.test(r)), p.refusals.join('\n'));
	});

	test('it NEVER writes `real` — the join to the real world is a person\'s judgement', () => {
		const root = workspace();
		apply(plan(root));
		for (const m of MOVES) {
			const dir = path.join(root, 'data', 'perspective', ...m.to.split('/'));
			if (!fs.existsSync(dir)) continue;
			const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
				.flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
			for (const f of walk(dir)) {
				assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /^real:/m,
					'a migration that guessed the correspondence would be authoring truth into a record whose whole contract is that it is a finding');
			}
		}
	});

	test('a workspace with no perspective records is a no-op, not an error', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-empty-'));
		const p = plan(root);
		assert.deepEqual(p.moves, []);
		assert.deepEqual(p.refusals, []);
	});
});

// ── THE CONSUMER'S OWN SOURCES ──────────────────────────────────────────────────────────────────
// ⚠ EVERY CASE HERE IS A REPRODUCTION, not a hypothesis. A real consumer was migrated on 2026-09-11
// and BRICKED: it shipped its own overlay carrying `extends: perspective/activities`, so after the
// rename `compile` hard-failed with "every descriptor declares 'extends' — no base found" — a message
// naming a compile internal, not the file to edit. The same class bit again immediately with a
// workspace ui-view carrying `collection: collections/perspective/activities`. Neither is a record,
// so nothing swept them, and both had to be found by reading an error that pointed elsewhere.
describe("the consumer's own source files", () => {
	const withSources = (files) => {
		const root = workspace();
		for (const [rel, text] of Object.entries(files)) {
			const f = path.join(root, rel);
			fs.mkdirSync(path.dirname(f), { recursive: true });
			fs.writeFileSync(f, text);
		}
		return root;
	};

	test('an overlay naming a renamed collection is FOUND — the case that bricked a real workspace', () => {
		const root = withSources({
			'modules/default/collections/team-activities.collection.yaml':
				"name: perspective/activities\nextends: 'perspective/perspective/activities'\nschema:\n  properties:\n    squad: { type: string }\n",
		});
		const hits = scanSources(root);
		assert.equal(hits.length, 2, 'both the name and the extends target name the collection');
		assert.ok(hits.every((h) => h.file.endsWith('team-activities.collection.yaml')));
	});

	test('a ui-view naming a renamed collection is FOUND — the case that bit second', () => {
		const root = withSources({
			'modules/default/ui-views/our-timeline.ui-view.yaml':
				'path: /ours\ntarget: list\ncollection: collections/perspective/activities\nlayout: gantt\n',
		});
		const hits = scanSources(root);
		assert.equal(hits.length, 1);
		assert.match(hits[0].fixed, /collections\/perspective\/world\/activities/);
	});

	test('the report names the FILE, the LINE and the exact edit — never a compile internal', () => {
		const root = withSources({
			'modules/default/ui-views/our-timeline.ui-view.yaml':
				'path: /ours\ntarget: list\ncollection: collections/perspective/activities\nlayout: gantt\n',
		});
		const [h] = scanSources(root);
		assert.equal(h.lineNo, 3);
		assert.equal(h.line, 'collection: collections/perspective/activities');
		assert.equal(h.fixed, 'collection: collections/perspective/world/activities');
	});

	test('it REFUSES up front, before anything is written or compiled', () => {
		const root = withSources({
			'modules/default/ui-views/our-timeline.ui-view.yaml':
				'path: /ours\ntarget: list\ncollection: collections/perspective/activities\nlayout: gantt\n',
		});
		const said = [];
		const realLog = console.log, realErr = console.error;
		console.log = (...a) => said.push(a.join(' '));
		console.error = (...a) => said.push(a.join(' '));
		let code;
		try { code = main(['--allow-dirty'], root); } finally { console.log = realLog; console.error = realErr; }
		assert.equal(code, 1);
		assert.match(said.join('\n'), /our-timeline\.ui-view\.yaml:3/, 'the message must name the file and line');
		// ⚠ AND NOTHING MOVED. A refusal that has already half-migrated is worse than no refusal.
		assert.ok(exists(root, `activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`),
			'records must not move while a source still names the old collection');
		assert.ok(!fs.existsSync(path.join(root, 'data', 'perspective', 'world')));
	});

	test('--rewrite-sources applies exactly the edit it printed, and then the migration runs', () => {
		const root = withSources({
			'modules/default/ui-views/our-timeline.ui-view.yaml':
				'path: /ours\ntarget: list\ncollection: collections/perspective/activities\nlayout: gantt\n',
		});
		rewriteSources(scanSources(root));
		const after = fs.readFileSync(path.join(root, 'modules/default/ui-views/our-timeline.ui-view.yaml'), 'utf8');
		assert.match(after, /^collection: collections\/perspective\/world\/activities$/m);
		assert.match(after, /^path: \/ours$/m, 'nothing else about the file moved');
		assert.deepEqual(scanSources(root), [], 'and a second scan finds nothing');
	});

	test('a collection that did NOT move is never touched', () => {
		// `perspective/activity-weeks` shares a prefix with `perspective/activities` and stays put.
		const root = withSources({
			'modules/default/ui-views/weeks.ui-view.yaml':
				'path: /w\ntarget: list\ncollection: collections/perspective/activity-weeks\nlayout: table\n',
		});
		assert.deepEqual(scanSources(root), []);
	});

	test("the package's own sources never match — they already carry the new spelling", () => {
		// The scan needs no knowledge of which module belongs to whom: it looks for the OLD names, and
		// after the upgrade only an un-migrated consumer file still has one.
		const root = withSources({
			'modules/perspective/collections/perspective/world/activities.collection.yaml':
				'name: perspective/world/activities\nstorage: { path: data/perspective/world/activities }\n',
		});
		assert.deepEqual(scanSources(root), []);
	});

	test('node_modules and git_modules are never scanned', () => {
		const root = withSources({
			'node_modules/@dreamteamer/extensions/modules/x/ui-views/v.ui-view.yaml': 'collection: collections/perspective/activities\n',
			'git_modules/extensions/modules/x/ui-views/v.ui-view.yaml': 'collection: collections/perspective/activities\n',
		});
		assert.deepEqual(scanSources(root), []);
	});

	test('a clean workspace reports no source hits at all', () => {
		assert.deepEqual(plan(workspace()).sourceHits, []);
	});
});
