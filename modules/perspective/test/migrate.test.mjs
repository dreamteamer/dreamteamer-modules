// THE MIGRATION, MEASURED BY THE ENGINE — not by its own summary.
//
// `bin/migrate.mjs` is the one place in this package where the old spelling is legal, because
// matching it on disk is its whole job. The fixture is a miniature of the 5,521 live records across
// the three workspaces that carry them, built from what those records actually hold (measured
// 2026-09-09, not imagined): one run per workspace, `contributor` an email on every one, `contact`
// set on none, and every non-run-layer record keying cleanly off its own first segment.
//
// ⚠ The last test is the only one that proves anything. The other twelve assert what the script
// says it did; that one copies the module into a virgin workspace on the pinned engine, migrates,
// and asks `dreamteamer check` — which is the instrument that caught all five defects a green suite
// missed during this release.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, apply, main } from '../bin/migrate.mjs';
import { virginWorkspace, installCopied as installModules, run } from '../../../tests/helpers/workspace.mjs';

const RUN = '2026-09-08--dana-o';
const SLUG = 'dana-o';

/** A workspace in the pre-0.2.0 shape, carrying one record of every shape the live data has. */
function oldWorkspace(base = null) {
	const ws = base ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ext-mig-'));
	const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(ws, p)), { recursive: true }); fs.writeFileSync(path.join(ws, p), s); };
	if (!fs.existsSync(path.join(ws, 'package.json'))) w('package.json', JSON.stringify({ name: 'old', dreamteamer: {} }));
	if (!fs.existsSync(path.join(ws, 'package-lock.json'))) w('package-lock.json', '{}');
	const D = 'data/introspection';

	// The run: `label` is the slug, `contributor` is the ADDRESS, `perspective` is the old back-pointer.
	w(`${D}/introspectives/${RUN}.introspective.md`,
		`---\nlabel: dana-o\nstarted: '2026-09-08'\nstage: synthesised\ncontributor: dana.o@northwind.example\n`
		+ `perspective: introspection/perspectives/${RUN}\nauthor: agents/dreamteamer\n---\nThe run log.\n`);

	// Model records, keyed by the RUN, linked through `introspective`, one citing the other in its body.
	w(`${D}/activities/${RUN}/2026-03-04--rewrote-auth.activity.md`,
		`---\nintrospective: introspection/introspectives/${RUN}\nname: rewrote auth\nstarted: '2026-03-04'\n`
		+ `project: introspection/projects/${RUN}/northwind-api\nconfidence: normal\n---\n`
		+ `Followed on from introspection/activities/${RUN}/2026-02-01--spiked-auth.\n`);
	w(`${D}/activities/${RUN}/2026-02-01--spiked-auth.activity.md`,
		`---\nintrospective: introspection/introspectives/${RUN}\nname: spiked auth\nstarted: '2026-02-01'\n---\n`);
	w(`${D}/projects/${RUN}/northwind-api.project.md`,
		`---\nintrospective: introspection/introspectives/${RUN}\nname: northwind api\nkind: product\nactivities_count: 2\n---\n`);
	w(`${D}/collaborators/${RUN}/dana-oren.collaborator.md`,
		`---\nintrospective: introspection/introspectives/${RUN}\nname: Dana Oren\nhandles:\n  - dana.o@northwind.example\n---\n`);

	// The four collections that reached the run through `session` rather than `introspective`.
	w(`${D}/sources/${RUN}/git-repo--northwind-api.source.md`,
		`---\nsession: introspection/introspectives/${RUN}\nkind: git-repo\nlabel: northwind-api\nreach: available\n---\n`);
	w(`${D}/findings/${RUN}/workflow--ships-on-fridays.finding.md`,
		`---\nsession: introspection/introspectives/${RUN}\nname: ships on fridays\nkind: workflow\n`
		+ `evidence:\n  - introspection/activities/${RUN}/2026-03-04--rewrote-auth\nevidence_count: 1\nstanding: pattern\n---\n`);

	// Run-layer: the id does NOT change.
	// ⚠ `'n'` is QUOTED on disk, because `n` is a YAML 1.1 boolean token and the writer quotes it.
	// A frontmatter editor that only recognises a bare key reads this as a CONTINUATION of the line
	// above — and when that line is the run link being rewritten, the quoted key goes with it. That is
	// how 51 live questions across two workspaces lost their `n`, silently, on the first real run.
	w(`${D}/questions/${RUN}/001.question.md`,
		`---\nsession: introspection/introspectives/${RUN}\n'n': 1\ntext: what is the hardest part\nbank: role\n---\n`);
	w(`${D}/proposals/${RUN}/collection--deploy-log.proposal.md`,
		`---\nsession: introspection/introspectives/${RUN}\nname: deploy log\nkind: collection\n`
		+ `justified_by:\n  - introspection/findings/${RUN}/workflow--ships-on-fridays\nbasis: evidence-only\nstatus: proposed\n---\n`);

	// Evidence keyed by its SOURCE, with no run link at all — the contributor comes through `source`.
	w(`${D}/activity-weeks/git-repo--northwind-api/2026-W09.activity-week.md`,
		`---\nsource: introspection/sources/${RUN}/git-repo--northwind-api\nperiod: 2026-W09\ncommits: 4\n---\n`);
	w(`${D}/conversations/claude-code/2026/03/abcd1234efgh.conversation.md`,
		`---\nsession_id: abcd1234efgh\nharness: claude-code\ntitle: auth work\n`
		+ `transcript_path: '\${userHome}/.claude/projects/-x/abcd1234efgh.jsonl'\ndepth: minimal\n`
		+ `inspected_at: '2026-03-04T00:00:00.000Z'\ninspector_version: metrics/3\n`
		+ `source: introspection/sources/${RUN}/git-repo--northwind-api\nstarted_at: '2026-03-04T09:00:00.000Z'\nturns_user: 12\n---\n`);

	// The whole-id case: one perspective per run becomes one per contributor.
	w(`${D}/perspectives/${RUN}.perspective.md`,
		`---\nintrospective: introspection/introspectives/${RUN}\ncontributor: dana.o@northwind.example\nrole: backend\n---\n`);
	return ws;
}
const read = (ws, p) => fs.readFileSync(path.join(ws, p), 'utf8');
const exists = (ws, p) => fs.existsSync(path.join(ws, p));

test('the contributor is the run id with the leading date stripped', () => {
	assert.equal(plan(oldWorkspace()).contributor, SLUG);
});

test('--contributor overrides it', () => {
	assert.equal(plan(oldWorkspace(), { contributor: 'dana' }).contributor, 'dana');
});

test('planning writes nothing at all', () => {
	const ws = oldWorkspace();
	plan(ws);
	assert.ok(exists(ws, `data/introspection/activities/${RUN}/2026-03-04--rewrote-auth.activity.md`));
	assert.ok(!exists(ws, 'data/perspective'));
});

test('model records re-key to the contributor; run-layer records keep the id they have', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	assert.ok(exists(ws, `data/perspective/activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`));
	assert.ok(exists(ws, `data/perspective/questions/${RUN}/001.question.md`));
	assert.ok(exists(ws, `data/perspective/proposals/${RUN}/collection--deploy-log.proposal.md`));
	assert.ok(!exists(ws, 'data/introspection'), 'the old tree is gone, not copied');
});

test('the run record is renamed, re-suffixed, and keeps the id it had', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	assert.ok(exists(ws, `data/perspective/retrospective-sessions/${RUN}.retrospective-session.md`));
});

test('the perspective, whose whole id was the run, becomes the contributor', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	assert.ok(exists(ws, `data/perspective/perspectives/${SLUG}.perspective.md`));
});

test('both old link fields become retrospective, and contributor is inserted beside it', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const a = read(ws, `data/perspective/activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`);
	assert.match(a, new RegExp(`^retrospective: perspective/retrospective-sessions/${RUN}$`, 'm'));
	assert.match(a, new RegExp(`^contributor: ${SLUG}$`, 'm'));
	assert.doesNotMatch(a, /^introspective:/m);
	// ⚠ `sources` is the ONE collection that folds the run link into a LIST — it is many-to-many with
	// the run, because a source is durable and every run re-reads it.
	const s = read(ws, `data/perspective/sources/${SLUG}/git-repo--northwind-api.source.md`);
	assert.match(s, new RegExp(`^retrospectives:\n  - perspective/retrospective-sessions/${RUN}$`, 'm'));
	assert.doesNotMatch(s, /^retrospective:/m, 'the scalar is gone, not kept beside the list');
	assert.match(s, new RegExp(`^contributor: ${SLUG}$`, 'm'));
	assert.doesNotMatch(s, /^session:/m);
});

test('a quoted frontmatter key survives — the line editor must recognise it as a key', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const q = read(ws, `data/perspective/questions/${RUN}/001.question.md`);
	assert.match(q, /^'?n'?: 1$/m, 'the question number is what orders the interview; losing it is silent data loss');
	assert.match(q, /^bank: role$/m);
});

test('a run-layer record gets the run link but NOT a contributor of its own', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const q = read(ws, `data/perspective/questions/${RUN}/001.question.md`);
	assert.match(q, new RegExp(`^retrospective: perspective/retrospective-sessions/${RUN}$`, 'm'));
	assert.doesNotMatch(q, /^contributor:/m, 'the run names the contributor; a question does not repeat it');
});

test('the run record loses label and perspective, and its address moves to handles', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const r = read(ws, `data/perspective/retrospective-sessions/${RUN}.retrospective-session.md`);
	assert.doesNotMatch(r, /^label:/m);
	assert.doesNotMatch(r, /^perspective:/m, 'a generated mirror now — a hand-written value collides with it');
	assert.match(r, /^contributor: dana-o$/m, 'the slug, never the address');
	assert.match(r, /^handles:\n {2}- dana\.o@northwind\.example$/m);
});

test('a field the descriptors no longer declare is dropped, and the drop is reported', () => {
	const ws = oldWorkspace();
	const p = plan(ws);
	apply(ws, p);
	assert.doesNotMatch(read(ws, `data/perspective/projects/${SLUG}/northwind-api.project.md`), /^activities_count:/m);
	assert.ok(p.drops['projects.activities_count'] >= 1, `expected the drop to be counted: ${JSON.stringify(p.drops)}`);
});

test('a reference to a re-keyed record follows it, in the body as well as the frontmatter', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const a = read(ws, `data/perspective/activities/${SLUG}/2026-03-04--rewrote-auth.activity.md`);
	assert.match(a, new RegExp(`perspective/activities/${SLUG}/2026-02-01--spiked-auth`), 'the body reference followed');
	assert.match(a, new RegExp(`^project: perspective/projects/${SLUG}/northwind-api$`, 'm'));
	const f = read(ws, `data/perspective/findings/${SLUG}/workflow--ships-on-fridays.finding.md`);
	assert.match(f, new RegExp(`- perspective/activities/${SLUG}/2026-03-04--rewrote-auth`));
});

test('evidence keyed by its source gains the contributor segment, derived through that source', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	assert.ok(exists(ws, `data/perspective/activity-weeks/${SLUG}/git-repo--northwind-api/2026-W09.activity-week.md`));
	assert.ok(exists(ws, `data/perspective/conversations/${SLUG}/claude-code/2026/03/abcd1234efgh.conversation.md`));
	const c = read(ws, `data/perspective/conversations/${SLUG}/claude-code/2026/03/abcd1234efgh.conversation.md`);
	assert.match(c, new RegExp(`^retrospective: perspective/retrospective-sessions/${RUN}$`, 'm'),
		'a collection with no run link of its own still gets one — retrospective is REQUIRED on all 19');
});

test('a collection named in prose follows the rename; the WORD in prose does not', () => {
	const ws = oldWorkspace();
	// A body that cites a collection, globs a run's records, and names a topic the person actually
	// worked on. The first two are the old world; the third is the record's own subject.
	const f = path.join(ws, `data/introspection/activities/${RUN}/2026-02-01--spiked-auth.activity.md`);
	fs.appendFileSync(f, `See introspection/deliverables and introspection/questions/${RUN}/* — filed under the introspection module work.\n`);
	apply(ws, plan(ws));
	const out = read(ws, `data/perspective/activities/${SLUG}/2026-02-01--spiked-auth.activity.md`);
	assert.match(out, /perspective\/deliverables/,
		'a collection cited in prose follows the rename all the way to its CURRENT name — `deliverables` moved into the world namespace in 0.9.0, and a migration that lands a workspace on an intermediate spelling has not migrated it');
	assert.match(out, new RegExp(`perspective/questions/${RUN}/\\*`), 'a run-layer glob keeps the run id it is keyed by');
	assert.match(out, /the introspection module work/, 'the WORD in prose is the subject of the work, not a reference');
});

test('no path and no reference in the fixture still says introspection', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const hits = [];
	(function walk(d) {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (/introspect/i.test(p) || /introspect/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ws, p));
		}
	})(path.join(ws, 'data'));
	assert.deepEqual(hits, []);
});

test('running it twice is a no-op — there is nothing left to migrate', () => {
	const ws = oldWorkspace();
	apply(ws, plan(ws));
	const before = JSON.stringify(fs.readdirSync(path.join(ws, 'data/perspective')).sort());
	const second = plan(ws);
	assert.deepEqual(second.moves, [], 'a second plan moves nothing');
	assert.equal(second.refusals.length, 0);
	apply(ws, second);
	assert.equal(JSON.stringify(fs.readdirSync(path.join(ws, 'data/perspective')).sort()), before);
});

test('an unknown frontmatter key REFUSES rather than being silently discarded', () => {
	const ws = oldWorkspace();
	fs.appendFileSync(path.join(ws, `data/introspection/activities/${RUN}/2026-02-01--spiked-auth.activity.md`), '');
	const p0 = path.join(ws, `data/introspection/activities/${RUN}/2026-02-01--spiked-auth.activity.md`);
	fs.writeFileSync(p0, fs.readFileSync(p0, 'utf8').replace('name: spiked auth', 'name: spiked auth\nwidgets_frobnicated: 3'));
	const p = plan(ws);
	assert.ok(p.refusals.some((r) => /widgets_frobnicated/.test(r)),
		`a key no descriptor declares is data the operator has to decide about:\n${p.refusals.join('\n')}`);
});

// ── the incident the real workspaces found ───────────────────────────────────────────────────────
test('a workspace that does not compile stops the migration instead of reporting a clean check', { timeout: 180_000 }, () => {
	const ws = virginWorkspace();
	installModules(ws, ['perspective']);
	oldWorkspace(ws);
	// A ui-view name collision — exactly what the first real workspace had, and nothing whatever to do
	// with the migration. Before this test, compile failed, every `relations rebuild` failed against
	// the stale schema, and `check` then reported a clean tick over the 63 records the OLD schema
	// still recognised, out of 282. The tick was true and meaningless at the same time.
	fs.mkdirSync(path.join(ws, 'modules', 'probe', 'ui-views'), { recursive: true });
	fs.writeFileSync(path.join(ws, 'modules', 'probe', 'package.json'),
		JSON.stringify({ name: 'probe', dreamteamer: { description: 'a colliding module' } }, null, '\t'));
	fs.writeFileSync(path.join(ws, 'modules', 'probe', 'ui-views', 'projects.ui-view.yaml'),
		'path: /projects\ntarget: list\ncollection: collections/perspective/projects\nlayout: table\nnav: { label: Projects, order: 99 }\n');

	// ⚠ The exit code alone does not discriminate: a broken workspace can fail `check` too, and then
	// a migration with no compile guard at all still returns 1 — for the wrong reason, having already
	// run every rebuild against a stale schema. What must be asserted is the REFUSAL, by name.
	const said = [];
	const realLog = console.log, realErr = console.error;
	console.log = (...a) => said.push(a.join(' '));
	console.error = (...a) => said.push(a.join(' '));
	let code;
	try { code = main(['--allow-dirty'], ws); } finally { console.log = realLog; console.error = realErr; }
	const out = said.join('\n');

	assert.equal(code, 1, 'a workspace that cannot compile must not report success');
	assert.match(out, /does not COMPILE — stopping here/, `it went past the failed compile:\n${out.slice(-1200)}`);
	assert.doesNotMatch(out, /THIS is the result that says whether the migration worked/,
		'it must not run check at all — a tick from a stale schema is what made this incident expensive');

	// And the records ARE moved — the migration is idempotent, so the fix is to repair the collision
	// and run it again, not to unpick anything.
	assert.ok(fs.existsSync(path.join(ws, 'data', 'perspective', 'activities')));
	fs.rmSync(ws, { recursive: true, force: true });
});

// ── the only test that measures ──────────────────────────────────────────────────────────────────
// ⚠ It drives `main()`, the actual CLI, rather than a bespoke sequence of plan/apply. The whole
// point of an end-to-end test is that it runs what the operator runs — and the step this catches is
// the one plan/apply does NOT do: 33 generated mirrors go stale the moment the migration writes a
// file directly, and `check` refuses all of them until `relations rebuild` has run. Rebuilding is
// part of the migration, not a chore for the operator to discover from an error message.
test('the migrated records compile and check clean on the pinned engine', { timeout: 180_000 }, () => {
	const ws = virginWorkspace();
	installModules(ws, ['perspective']);
	oldWorkspace(ws);

	const code = main(['--allow-dirty'], ws);
	assert.equal(code, 0, 'the migration reports failure');

	// And again, independently — the migration's own exit code is not the measurement.
	const checked = run(ws, ['check']);
	assert.match(checked.stdout + checked.stderr, /0 violations/,
		`THE MEASUREMENT. check on the migrated records:\n${checked.stdout}\n${checked.stderr}`);
	assert.equal(checked.status, 0);

	fs.rmSync(ws, { recursive: true, force: true });
});
