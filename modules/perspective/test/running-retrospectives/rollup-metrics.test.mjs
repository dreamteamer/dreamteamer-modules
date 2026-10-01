// The rollup's promise: an activity's numbers are the SUM of its sessions', and a ratio is
// re-derived from those sums rather than averaged.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, recordPath, writeRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'rollup-metrics.mjs');
const SESSION = 'perspective/retrospective-sessions/2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run

/** Every reader resolves its key off the run record, so a data root without one cannot be read. */
function seedSession(data) {
	const id = SESSION.split('/').pop();
	writeRecord(recordPath('retrospective-sessions', id, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: id.slice(0, 10), stage: 'installed' });
	return data;
}

function fm(o) {
	return '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\nbody\n';
}

function workspace({ activitySessions }) {
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-rollup-')));
	const convDir = path.join(data, 'perspective', 'conversations', SLUG, 'claude-code', '2026', '09');
	fs.mkdirSync(convDir, { recursive: true });
	// two real sessions with different volumes — a mean and a sum disagree here on purpose
	fs.writeFileSync(path.join(convDir, 'aaa.conversation.md'), fm({
		session_id: 'aaa', active_minutes: 30, turns_user: 20, tokens_input: 1000, tokens_output: 5000,
		tool_calls: 40, files_edited: 6, user_correction: 4, interruptions: 3,
		input_words: 400, output_words: 900, correction_ratio: 0.2,
	}));
	fs.writeFileSync(path.join(convDir, 'bbb.conversation.md'), fm({
		session_id: 'bbb', active_minutes: 5.5, turns_user: 2, tokens_input: 100, tokens_output: 200,
		tool_calls: 3, files_edited: 1, user_correction: 1, interruptions: 0,
		input_words: 50, output_words: 100, correction_ratio: 0.9,
	}));
	const actDir = path.join(data, 'perspective', 'activities', SLUG);
	fs.mkdirSync(actDir, { recursive: true });
	fs.writeFileSync(path.join(actDir, 'a.activity.md'), fm({
		retrospective: SESSION, name: 'ship the parser', started: '2026-09-01',
		sessions: activitySessions, commits: ['abc1234', 'def5678'],
		turns_user: 999, tokens_input: 999, // stale numbers a previous pass left behind
	}));
	return { data, activity: path.join(actDir, 'a.activity.md') };
}

const run = (data, extra = []) => execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, ...extra], { encoding: 'utf8' });

test('every rolled field is the sum of the sessions, and the ratio is re-derived from the sums', () => {
	const { data, activity } = workspace({ activitySessions: [`perspective/conversations/${SLUG}/claude-code/2026/09/aaa`, `perspective/conversations/${SLUG}/claude-code/2026/09/bbb`] });
	const out = run(data);
	assert.match(out, /activities rolled 1 · unchanged 0 · session refs unresolved 0/);
	const { fields } = readRecord(activity);
	assert.equal(fields.turns_user, 22, 'the stale 999 is replaced, not added to');
	assert.equal(fields.tokens_input, 1100);
	assert.equal(fields.tokens_output, 5200);
	assert.equal(fields.active_minutes, 35.5);
	assert.equal(fields.tool_calls, 43);
	assert.equal(fields.files_edited, 7);
	assert.equal(fields.corrections, 5);
	assert.equal(fields.interruptions, 3);
	assert.equal(fields.input_words, 450);
	assert.equal(fields.output_words, 1000);
	assert.equal(fields.session_count, 2);
	assert.equal(fields.commit_count, 2, 'commits are pointers into git; the count is derived here');
	// 0.2×900 + 0.9×100 = 270 corrected words over 1000 produced. The MEAN of the two ratios is 0.55.
	assert.equal(fields.correction_ratio, 0.27, 'summed, not averaged — a 2-turn session must not weigh like a 20-turn one');
});

test('an activity with no resolvable sessions is zeroed, not left carrying a previous pass\'s numbers', () => {
	const { data, activity } = workspace({ activitySessions: [`perspective/conversations/${SLUG}/claude-code/2026/09/gone`] });
	const out = run(data);
	assert.match(out, /session refs unresolved 1/);
	const { fields } = readRecord(activity);
	// Absent, not 0. A stale 999 is a lie the timeline would draw; a 0 is a different lie — it says
	// the work cost nothing measured, when the truth is that nobody measured it.
	assert.equal(fields.turns_user, undefined, 'the stale 999 is REMOVED');
	assert.equal(fields.tokens_input, undefined, 'and not replaced with a fake zero');
	assert.equal(fields.tokens_total, undefined);
	assert.equal(fields.active_minutes, undefined);
	assert.equal(fields.session_count, 0, 'session_count IS 0 — that one is a measured fact about the evidence');
	assert.equal(fields.correction_ratio, undefined);
	assert.equal(fields.commit_count, 2, 'the commits are still real');
});

test('a second run writes nothing', () => {
	const { data } = workspace({ activitySessions: [`perspective/conversations/${SLUG}/claude-code/2026/09/aaa`] });
	run(data);
	assert.match(run(data), /activities rolled 0 · unchanged 1/);
});

// The second tier. Without it a project has a name and a date range and nothing that says what it
// cost — which is the difference between a list of projects and a narratable lifecycle.
test('a project sums its activities, takes its code curves from its repos\' weeks, and keeps absent absent', () => {
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-proj-')));
	const B = '2026-09-08--fx';
	const put = (rel, o) => { const p = path.join(data, 'perspective', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, fm(o)); };

	const convDir = path.join(data, 'perspective', 'conversations', SLUG, 'claude-code', '2026', '09');
	fs.mkdirSync(convDir, { recursive: true });
	fs.writeFileSync(path.join(convDir, 'aaa.conversation.md'), fm({
		session_id: 'aaa', active_minutes: 60, turns_user: 30, tokens_input: 100, tokens_output: 900,
		tokens_cache_read: 9000, tokens_cache_write: 0, tool_calls: 10, files_edited: 2,
		user_correction: 3, interruptions: 1, input_words: 500, output_words: 2000, correction_ratio: 0.1,
	}));

	// two activities in one project, one of them with no sessions at all
	put(`activities/${SLUG}/2026-08-01--with-sessions.activity.md`, {
		retrospective: `perspective/retrospective-sessions/${B}`, name: 'with sessions', started: '2026-08-01', ended: '2026-08-04',
		project: `perspective/projects/${SLUG}/the-engine`, repos: ['repos/engine'],
		sessions: [`perspective/conversations/${SLUG}/claude-code/2026/09/aaa`], commits: ['abc1234'],
		topics: [`perspective/topics/${SLUG}/parsing`],
	});
	put(`activities/${SLUG}/2026-08-20--commits-only.activity.md`, {
		retrospective: `perspective/retrospective-sessions/${B}`, name: 'commits only', started: '2026-08-20', ended: '2026-08-21',
		project: `perspective/projects/${SLUG}/the-engine`, repos: ['repos/engine'],
		commits: ['def5678', 'aaa9999'], topics: [`perspective/topics/${SLUG}/release`],
	});
	// a project nothing points at — left alone, and counted in the receipt
	put(`projects/${SLUG}/the-engine.project.md`, { retrospective: `perspective/retrospective-sessions/${B}`, name: 'the engine', kind: 'product', repo_names: ['engine'] });
	put(`projects/${SLUG}/abandoned-idea.project.md`, { retrospective: `perspective/retrospective-sessions/${B}`, name: 'abandoned idea', kind: 'internal', activities_count: 4 });

	// the repo's weekly code numbers — the only place lines are counted
	put(`activity-weeks/${SLUG}/git-repo--engine/2026-W31.activity-week.md`, { source: 'x', period: '2026-W31', lines_new: 800, lines_modified: 100, commits_bug: 1, commits_change_request: 4 });
	put(`activity-weeks/${SLUG}/git-repo--engine/2026-W34.activity-week.md`, { source: 'x', period: '2026-W34', lines_new: 40, lines_modified: 700, commits_bug: 5, commits_change_request: 1 });

	const out = execFileSync('node', [BIN, '--retrospective', `perspective/retrospective-sessions/${B}`, '--data-root', data], { encoding: 'utf8' });
	assert.match(out, /projects rolled 1 · unchanged 0 · with no activities 1/);

	const p = readRecord(path.join(data, 'perspective', 'projects', SLUG, 'the-engine.project.md')).fields;
	// ⚠ NOT activities_count. 0.2.0 deleted it from `projects` — the count comes off the generated
	// `activities` mirror now — and this script kept writing it, so every rollup put a field back that
	// the schema had removed. `dt set` on such a record then refuses the WHOLE write ("unknown
	// field(s) for this collection: activities_count"), which is how it surfaced: a project could no
	// longer be edited at all (a client workspace, 2026-09-10). `check` does not flag an unknown key, so
	// nothing caught it in between.
	assert.equal(p.activities_count, undefined, 'a field the descriptor deleted must not be written back');
	assert.equal(p.commit_count, 3);
	assert.equal(p.session_count, 1, 'only one activity carried a session');
	assert.equal(p.active_minutes, 60);
	assert.equal(p.turns_user, 30);
	assert.equal(p.tokens_total, 10000, 'all four token components');
	assert.equal(p.correction_ratio, 0.1);
	// ⚠ No commits scratch in this fixture, so there is nothing to sum: the code curves are ABSENT
	// rather than borrowed from the repo's weekly totals. Those totals belong to the repo, not to any
	// one project in it — see the two tests at the bottom of this file.
	assert.equal(p.lines_new, undefined, 'a project with no readable commits claims no lines');
	assert.equal(p.lines_modified, undefined);
	assert.equal(p.commits_bug, undefined);
	assert.equal(p.commits_change_request, undefined);
	assert.equal(p.started, '2026-08-01', 'the earliest activity');
	assert.equal(p.ended, '2026-08-21', 'the latest');
	assert.deepEqual(p.topics.sort(), [`perspective/topics/${SLUG}/parsing`, `perspective/topics/${SLUG}/release`]);

	const orphan = readRecord(path.join(data, 'perspective', 'projects', SLUG, 'abandoned-idea.project.md')).fields;
	assert.equal(orphan.activities_count, 4, 'a project no activity points at is left exactly as it was');
});

// ── the project→repo edge, which nothing wrote ───────────────────────────────────────────────────
// A project's code curves (`lines_new`, `lines_modified`, `commits_bug`, `commits_change_request`)
// are summed out of `activity-weeks`, which are keyed by REPO. So a project only gets them if
// something says which repos it touched — `activities.repos` or its own `repo_names`.
//
// ⚠ Nothing writes `activities.repos`. Grep the whole toolchain and the only match is this script
// READING it. So the union was always just whatever `repo_names` a human had typed: on a real
// workspace 4 of 8 projects had them and showed line curves, and 4 had none and showed blanks —
// including one with 244 commits (a client workspace, 2026-09-10). The evidence was there the whole time:
// `read-git` parks every commit in `<scratch>/commits/<base>/<repo>.jsonl`, so each SHA already
// knows its repo.
test('a project takes its repos from the commits its activities cite, not only from a typed list', () => {
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-repo-')));
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-repo-s-'));
	const B = '2026-09-08--fx';
    const put = (rel, o) => { const p = path.join(data, 'perspective', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, fm(o)); };

	// An activity with commits and NO `repos` — the shape every real activity has.
	put(`activities/${SLUG}/2026-08-01--ship-it.activity.md`, {
		retrospective: `perspective/retrospective-sessions/${B}`, name: 'ship it', started: '2026-08-01',
		project: `perspective/projects/${SLUG}/delivery`, commits: ['abc1234', 'def5678'],
	});
	put(`projects/${SLUG}/delivery.project.md`, { retrospective: `perspective/retrospective-sessions/${B}`, name: 'delivery', kind: 'product' });
	put(`activity-weeks/${SLUG}/git-repo--api/2026-W31.activity-week.md`, { source: 'x', period: '2026-W31', lines_new: 500, lines_modified: 60, commits_bug: 2, commits_change_request: 3 });

	// read-git's parking lot: the SHA→repo map, one file per repo.
	const cdir = path.join(scratch, 'commits', B);
	fs.mkdirSync(cdir, { recursive: true });
	fs.writeFileSync(path.join(cdir, 'api.jsonl'), [
		{ sha: 'abc1234', repo: 'api', subject: 'feat: add the exporter', files: [{ status: 'A', add: 120, del: 0 }, { status: 'M', add: 5, del: 3 }] },
		{ sha: 'def5678', repo: 'api', subject: 'fix: correct the header', files: [{ status: 'M', add: 10, del: 2 }] },
	].map((c) => JSON.stringify(c)).join('\n') + '\n');
	// A commit in the same repo that this project's activities do NOT cite. Under the old repo-total
	// attribution its lines landed here too; they must not.
	fs.writeFileSync(path.join(cdir, 'unrelated.jsonl'),
		JSON.stringify({ sha: '9999999', repo: 'unrelated', subject: 'feat: something else', files: [{ status: 'A', add: 99999, del: 0 }] }) + '\n');

	execFileSync('node', [BIN, '--retrospective', `perspective/retrospective-sessions/${B}`, '--data-root', data, '--scratch-root', scratch], { encoding: 'utf8' });

	const p = readRecord(path.join(data, 'perspective', 'projects', SLUG, 'delivery.project.md')).fields;
	assert.deepEqual(p.repo_names, ['api'], 'the repo its commits actually live in');
	// ⚠ EXACT, from this project's own commits — not the repo's weekly totals. Attributing a whole
	// repo-week to every project that touches the repo gave one 6-commit project 1,775,984 lines_new
	// on a real workspace, identical to three other projects sharing the same repo (a client workspace,
	// 2026-09-10). A number that confident and that wrong is worse than the blank it replaced.
	assert.equal(p.lines_new, 120, 'added files only, from its own two commits');
	assert.equal(p.lines_modified, 20, 'add+del on modified files: 5+3 then 10+2');
	assert.equal(p.commits_bug, 1, 'the fix: commit');
	assert.equal(p.commits_change_request, 1, 'the feat: commit');
});

test('a repo no commit of this project touches contributes nothing', () => {
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-repo2-')));
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-repo2-s-'));
	const B = '2026-09-08--fx';
	const put = (rel, o) => { const p = path.join(data, 'perspective', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, fm(o)); };
	put(`activities/${SLUG}/2026-08-01--ship-it.activity.md`, {
		retrospective: `perspective/retrospective-sessions/${B}`, name: 'ship it', started: '2026-08-01',
		project: `perspective/projects/${SLUG}/delivery`, commits: ['abc1234'],
	});
	put(`projects/${SLUG}/delivery.project.md`, { retrospective: `perspective/retrospective-sessions/${B}`, name: 'delivery', kind: 'product' });
	put(`activity-weeks/${SLUG}/git-repo--other/2026-W31.activity-week.md`, { source: 'x', period: '2026-W31', lines_new: 999 });
	const cdir = path.join(scratch, 'commits', B);
	fs.mkdirSync(cdir, { recursive: true });
	fs.writeFileSync(path.join(cdir, 'api.jsonl'), JSON.stringify({ sha: 'abc1234', repo: 'api', subject: 'chore: tidy', files: [] }) + '\n');
	execFileSync('node', [BIN, '--retrospective', `perspective/retrospective-sessions/${B}`, '--data-root', data, '--scratch-root', scratch], { encoding: 'utf8' });
	const p = readRecord(path.join(data, 'perspective', 'projects', SLUG, 'delivery.project.md')).fields;
	assert.equal(p.lines_new, undefined, 'a repo-week this project has no commit in contributes nothing');
});
