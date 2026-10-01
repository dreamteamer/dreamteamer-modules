// synthesize-perspective's promise: it fills the countable half of the perspective and leaves the
// model's half alone. The fixture pins both halves — `uses` must be counted from the conversations
// (not copied, not left at whatever init wrote), and a `role` and a body written by a model before
// this ran must come out the other side byte-identical. The second run asserts idempotence, which is
// the whole point of the v2 runner: every stage is re-runnable.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord, readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'synthesize-perspective.mjs');
const RUN = 'perspective/retrospective-sessions/2026-09-07--fx';
const BASE = '2026-09-07--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const SOURCE = `perspective/sources/${SLUG}/claude-transcripts--default`;
const PROJECT = `perspective/projects/${SLUG}/invoice-parser`;
const BODY = '# the perspective\n\nWritten by the model. This paragraph must survive the script.';

// A description longer than the 200 chars the inline `collections` entry keeps — the cut is asserted.
const LONG = 'The alpha collection, described at length so the truncation has something to bite on. '.repeat(4);

function fixture() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-perspective-'));
	const data = path.join(tmp, 'data');
	// Every stage runs inside a session, and reads its contributor key off that record.
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['fx@x.test'], started: BASE.slice(0, 10), stage: 'installed' });
	const ws = path.join(tmp, 'ws');
	const scratch = path.join(tmp, 'scratch');

	// The skeleton stage 1 leaves behind, plus the model's own `role` and body already in place.
	writeRecord(recordPath('perspectives', SLUG, 'perspective', data), {
		retrospective: RUN,
		contributor: SLUG,
		role: 'x',
		commands: [{ name: 'foo', description: 'the foo command' }],
		skills: [{ name: 'bar', description: 'the bar skill' }],
		routines: [{ name: 'weekly sweep', description: 'every monday', recurrence: 'RRULE:FREQ=WEEKLY' }],
	}, BODY);

	const conversation = (sid, extra) =>
		writeRecord(recordPath('conversations', `claude-code/2026/08/${sid}`, 'conversation', data), {
			session_id: sid, harness: 'claude-code', title: sid,
			transcript_path: `\${userHome}/.claude/projects/-x/${sid}.jsonl`, depth: 'minimal',
			inspected_at: '2026-09-07T00:00:00.000Z', inspector_version: 'metrics/1', source: SOURCE,
			started_at: '2026-08-03T09:00:00.000Z', turns_user: 1, ...extra,
		});
	conversation('one', { commands_invoked: ['foo'] });
	conversation('two', { commands_invoked: ['foo', 'other'] });
	conversation('three', { skills_loaded: ['bar'] });

	// Two activities belong to the project, one does not — that is what `projects[].activities` counts.
	writeRecord(recordPath('activities', `${SLUG}/2026-08-01--invoice-parser`, 'activity', data), { retrospective: RUN, name: 'invoice parser', started: '2026-08-01', ended: '2026-08-04', project: PROJECT });
	writeRecord(recordPath('activities', `${SLUG}/2026-08-03--parser-tests`, 'activity', data), { retrospective: RUN, name: 'parser tests', started: '2026-08-03', ended: '2026-08-04', project: PROJECT });
	writeRecord(recordPath('activities', `${SLUG}/2026-08-10--dashboard`, 'activity', data), { retrospective: RUN, name: 'dashboard', started: '2026-08-10', ended: '2026-08-12' });
	writeRecord(recordPath('projects', `${SLUG}/invoice-parser`, 'project', data), { retrospective: RUN, name: 'invoice parser', kind: 'product', commit_count: 12, ticket_count: 3 },
		'# invoice parser\n\nThe parser that eats supplier PDFs. A second sentence that must not travel.');

	// The contributor's git identities, as read-git's collaborator merge left them.
	writeRecord(recordPath('users', `${SLUG}/fx`, 'user', data), { retrospective: RUN, name: 'FX', handles: ['FX', 'fx@x.test'] });

	// Two git-repo sources; only one of them has a commits scratch file, and only one carries a remote.
	writeRecord(recordPath('sources', `${SLUG}/git-repo--parser`, 'source', data),
		{ retrospective: RUN, contributor: SLUG, kind: 'git-repo', label: 'parser', reach: 'available', location: '${env:REPOS_FOLDER}/acme/parser', counts: { remote: 'yes' } },
		'Cloned from git@github.com:acme/parser.git — the remote is only in the body.');
	writeRecord(recordPath('sources', `${SLUG}/git-repo--dashboard`, 'source', data),
		{ retrospective: RUN, contributor: SLUG, kind: 'git-repo', label: 'dashboard', reach: 'available', location: '${env:REPOS_FOLDER}/acme/dashboard' });
	// read-git names the file after the source id's `git-repo--<slug>` suffix; the other repo has none.
	const commit = (sha, day, email) => JSON.stringify({ sha, date: `${day}T10:00:00.000Z`, author_name: 'x', author_email: email, files: [], repo: 'parser' });
	fs.mkdirSync(path.join(scratch, 'commits', BASE), { recursive: true });
	fs.writeFileSync(path.join(scratch, 'commits', BASE, 'parser.jsonl'),
		[commit('a1', '2026-08-02', 'fx@x.test'), commit('b2', '2026-08-05', 'other@x.test'), commit('c3', '2026-08-09', 'fx@x.test')].join('\n') + '\n');

	// The workspace whose descriptors become the inline `collections`: one countable, one runtime-base
	// system collection, and this module's own — the last two must not appear.
	const descriptor = (file, doc) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, doc); };
	const colls = path.join(ws, '.dreamteamer', 'collections');
	descriptor(path.join(colls, 'alpha.collection.yaml'), `name: alpha\ndescription: "${LONG.trim()}"\nstorage:\n  path: data/alpha\n  suffix: alpha\n  base: workspace\n`);
	descriptor(path.join(colls, 'skills.collection.yaml'), 'name: skills\ndescription: the engine\'s own\nstorage:\n  path: .dreamteamer/skills\n  suffix: skill\n  base: runtime\n');
	descriptor(path.join(colls, 'perspective', 'topics.collection.yaml'), 'name: perspective/topics\ndescription: this module does not list itself\nstorage:\n  path: data/perspective/topics\n  suffix: topic\n  base: workspace\n');
	fs.mkdirSync(path.join(ws, 'data', 'alpha', 'nested'), { recursive: true });
	fs.writeFileSync(path.join(ws, 'data', 'alpha', 'one.alpha.md'), 'x');
	fs.writeFileSync(path.join(ws, 'data', 'alpha', 'nested', 'two.alpha.md'), 'x');
	fs.writeFileSync(path.join(ws, 'data', 'alpha', 'README.md'), 'not a record');
	writeRecord(recordPath('decisions', `${SLUG}/2026-08-02--keep-the-parser`, 'decision', data), { retrospective: RUN, decision: 'keep the parser', source_kind: 'git-commit', source_ref: 'aaaaaaa' });
	writeRecord(recordPath('topics', `${SLUG}/invoice-parsing`, 'topic', data), { retrospective: RUN, name: 'invoice parsing' });
	// Two concepts, one of which was never actually seen used — only the observed one is DSL.
	writeRecord(recordPath('concepts', `${SLUG}/artifact`, 'concept', data), { retrospective: RUN, name: 'artifact', evidence_count: 4 });
	writeRecord(recordPath('concepts', `${SLUG}/never-said`, 'concept', data), { retrospective: RUN, name: 'never said', evidence_count: 0 });

	return { tmp, data, ws, scratch };
}

const run = ({ data, ws, scratch }, extra = []) =>
	spawnSync('node', [BIN, '--retrospective', RUN, '--data-root', data, '--workspace-root', ws, '--scratch-root', scratch, ...extra], { encoding: 'utf8' });
const perspective = (data) => readRecord(recordPath('perspectives', SLUG, 'perspective', data));

test('counts uses from the conversations, joins the run\'s records, and leaves the model\'s half alone', () => {
	const fx = fixture();
	const { tmp, data } = fx;
	const r = run(fx);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /✔ perspective 2026-09-07--fx · commands 1 \(used 1\) · skills 1 \(used 1\) · routines 1 · activities 3 · decisions 1 · meetings 0 · topics 1 · collaborators 1 · workflows 0/);
	assert.match(r.stdout, / · projects 1 · repos 2 \(commits 3\) · collections 1/);
	// ⚠ There is no back-link and no warning about one any more. This assertion used to pin
	// `back-link not set` on stderr — it was pinning the BROKEN behaviour: the write it warned about
	// is refused by the engine, because the field is a generated mirror. See the two tests at the
	// bottom of this file.
	assert.equal(r.stderr, '', r.stderr);

	const { fields, body } = perspective(data);
	assert.equal(fields.commands[0].uses, 2, 'two conversations invoked foo');
	assert.equal(fields.skills[0].uses, 1, 'one conversation loaded bar');
	assert.equal(fields.routines[0].recurrence, 'RRULE:FREQ=WEEKLY');
	assert.equal(fields.activities_count, 3);
	assert.equal(fields.decisions_count, 1);
	assert.deepEqual(fields.topics, [`perspective/topics/${SLUG}/invoice-parsing`]);
	assert.equal(fields.workflows, undefined, 'an empty ref list is absent, not []');
	assert.deepEqual(fields.dsl, [`perspective/concepts/${SLUG}/artifact`], 'only a concept with evidence is DSL');
	// The period comes from the activities, not the conversations, when there are activities.
	assert.equal(fields.period_start, '2026-08-01');
	assert.equal(fields.period_end, '2026-08-12');

	assert.equal(fields.role, 'x', "the model's role must survive");
	assert.equal(body.trim(), BODY.trim(), "the model's body must survive");

	fs.rmSync(tmp, { recursive: true, force: true });
});

// The three inline joins: the projects the activities point at, the repos counted from read-git's
// commits scratch, and the collections this workspace offers.
test('fills the inline projects, repos and collections', () => {
	const fx = fixture();
	const { tmp, data } = fx;
	assert.equal(run(fx).status, 0);
	const { fields } = perspective(data);

	assert.deepEqual(fields.projects, [{
		name: 'invoice parser', kind: 'product',
		description: 'The parser that eats supplier PDFs.',
		activities: 2, commits: 12, tickets: 3, ref: PROJECT,
	}], 'two of the three activities point at it; commits and tickets are copied from the record');

	assert.deepEqual(fields.repos, [
		// No scratch file for this one — 0 commits and no dates, not a crash.
		{ name: 'dashboard', commits: 0, contributor_commits: 0 },
		{
			name: 'parser', url: 'git@github.com:acme/parser.git',
			commits: 3, contributor_commits: 2, first: '2026-08-02', last: '2026-08-09',
		},
	], 'counted from the commits JSONL read-git names after the source id\'s git-repo--<slug> suffix');

	assert.equal(fields.collections.length, 1, 'the runtime-base and perspective/* descriptors are skipped');
	assert.equal(fields.collections[0].name, 'alpha');
	assert.equal(fields.collections[0].records, 2, 'both record files, nested included; the README is not one');
	assert.equal(fields.collections[0].description.length, 200, 'the description is cut at 200 chars');
	assert.equal(fields.collections[0].description, LONG.trim().slice(0, 200));

	fs.rmSync(tmp, { recursive: true, force: true });
});

test('running twice is stable — the record is byte-identical', () => {
	const fx = fixture();
	const { tmp, data } = fx;
	assert.equal(run(fx).status, 0);
	const first = fs.readFileSync(recordPath('perspectives', SLUG, 'perspective', data), 'utf8');
	const second = run(fx);
	assert.equal(second.status, 0, second.stderr);
	assert.equal(fs.readFileSync(recordPath('perspectives', SLUG, 'perspective', data), 'utf8'), first);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// With no activities yet — the normal state before stage 3 has been named — the period falls back to
// the conversations, so the perspective is never dateless while evidence exists.
test('with no activities the period falls back to the conversations, and a missing record is created', () => {
	const fx = fixture();
	const { tmp, data } = fx;
	fs.rmSync(path.join(data, 'perspective', 'activities'), { recursive: true, force: true });
	fs.rmSync(recordPath('perspectives', SLUG, 'perspective', data));

	const r = run(fx);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /commands 0 \(used 0\) · skills 0 \(used 0\) · routines 0 · activities 0 · decisions 1/);
	assert.match(r.stdout, /CREATED/);

	const { fields } = perspective(data);
	assert.equal(fields.period_start, '2026-08-03');
	assert.equal(fields.period_end, '2026-08-03');
	assert.equal(fields.contributor, SLUG, 'the contributor key the record is filed under, read off the retrospective');

	fs.rmSync(tmp, { recursive: true, force: true });
});

test('--dry-run writes nothing', () => {
	const fx = fixture();
	const { tmp, data } = fx;
	const before = fs.readFileSync(recordPath('perspectives', SLUG, 'perspective', data), 'utf8');
	const r = run(fx, ['--dry-run']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /DRY RUN/);
	assert.equal(fs.readFileSync(recordPath('perspectives', SLUG, 'perspective', data), 'utf8'), before);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// ── the mirror, and why the fixture could not see this ───────────────────────────────────────────
// `retrospective-sessions.perspective` became a GENERATED MIRROR of `perspectives.retrospective` in
// 0.2.0, and the engine refuses a direct write to a generated field. This script kept writing one,
// guarded by "does a compiled runtime exist beside dataRoot" — which is false in every fixture, so
// the guard skipped the broken line in every test, while a real workspace would see the whole
// synthesise stage die at the last line after doing all its work.
//
// A source-level assertion, deliberately: the failure is a call that a fixture cannot reach, so the
// only place a test can stand is on the code that would make it.
test('it writes no back-link — the run record\'s perspective field is the engine\'s to generate', () => {
	const src = fs.readFileSync(fileURLToPath(new URL('../../skills/running-retrospectives/bin/synthesize-perspective.mjs', import.meta.url)), 'utf8');
	const offenders = src.split('\n')
		.map((l, i) => [i + 1, l])
		.filter(([, l]) => !/^\s*(\/\/|\*)/.test(l))
		.filter(([, l]) => /dt\(\s*\[\s*'set'/.test(l) && /retrospective/.test(l));
	assert.deepEqual(offenders, [],
		`the engine refuses this write:\n  ${offenders.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  ')}`);
});

test('the perspective carries the run link the mirror is generated FROM', () => {
	const fx = fixture();
	run(fx);
	assert.equal(perspective(fx.data).fields.retrospective, RUN,
		'without this the mirror has nothing to mirror and the edge disappears');
});
