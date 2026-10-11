// read-git's promise: a real git history collapses into one mechanical record per ISO WEEK — and the
// week boundary is the trap. The fixture straddles it deliberately (Tue 2026-09-01 and Wed 2026-09-09
// are adjacent ISO weeks), so a reader that bucketed by month or by calendar-week-of-year fails here.
// The repo is built with git itself rather than a fixture tree: --numstat output is the thing under test.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, listRecords, recordPath, writeRecord } from '../../skills/running-retrospectives/lib/records.mjs';
import { commitIntent } from '../../skills/running-retrospectives/lib/commit-intent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'read-git.mjs');
const SESSION = 'perspective/retrospective-sessions/2026-09-07--fx';
// The fixtures commit on fixed September 2026 dates, and the reader's default window is the last four
// weeks from TODAY — so without an explicit --since these tests went red on 2026-09-30, when the
// window stopped reaching 2026-09-01. The default window has its own test below.
const SINCE = ['--since', '2026-08-01'];
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run

/** Every reader resolves its contributor key off the session record, so a data root without one is a
 *  workspace no stage could have run in. Returns the root so it can wrap an expression. */
function seedSession(data) {
	const id = SESSION.split('/').pop();
	writeRecord(recordPath('retrospective-sessions', id, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: id.slice(0, 10), stage: 'installed' });
	return data;
}

/** git with the developer's own global config kept out of it — a fixture must not read ~/.gitconfig. */
const git = (dir, args, when) =>
	execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@x.test', '-C', dir, ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_SYSTEM: '/dev/null',
			...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
		},
	});

test('counts commits, lines and authors into one activity-week per ISO week', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-'));
	// The basename is the source label, so it must be slug-stable: --repo-path derives the id from it.
	const repo = path.join(tmp, 'acme-portal');
	fs.mkdirSync(repo);
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

	const file = path.join(repo, 'notes.txt');
	const commit = (line, when) => {
		fs.appendFileSync(file, line + '\n');
		git(repo, ['add', 'notes.txt'], when);
		git(repo, ['commit', '-q', '-m', line], when);
	};
	commit('one', '2026-09-01T10:00:00Z');
	commit('two', '2026-09-01T10:00:00Z');
	commit('three', '2026-09-09T10:00:00Z');

	// The source record the reader would normally resolve. `location` is an absolute path, which no
	// real record may carry — allowed here because --repo-path bypasses rendering entirely.
	const data = seedSession(path.join(tmp, 'data'));
	writeRecord(recordPath('sources', 'fx/git-repo--acme-portal', 'source', data), {
		retrospective: SESSION,
		kind: 'git-repo',
		label: 'acme-portal',
		reach: 'available',
		location: repo,
	});

	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--repo-path', repo, '--data-root', data, ...SINCE], { encoding: 'utf8' });
	assert.match(out, /windows 2 · commits 3/);

	const windows = Object.fromEntries(
		listRecords(path.join(data, 'perspective', 'activity-weeks')).map((f) => {
			const { fields } = readRecord(f);
			return [fields.period, fields];
		}),
	);
	assert.deepEqual(Object.keys(windows).sort(), ['2026-W36', '2026-W37']);

	const w36 = windows['2026-W36'];
	assert.equal(w36.commits, 2);
	assert.equal(w36.lines_added, 2);
	assert.deepEqual(w36.authors, ['Fixture']);
	assert.equal(w36.source, 'perspective/sources/fx/git-repo--acme-portal');
	assert.equal(w36.files_changed, 1);

	assert.equal(windows['2026-W37'].commits, 1);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// Regression, found on the first dogfood pass: `git log` EXITS 128 on a checkout with no commits
// ("your current branch 'main' does not have any commits yet"), which killed the reader outright and
// cost every repo after it in the list. An unreadable repo is a line on stderr and a count, never the run.
test('a repo with no commits is skipped, counted, and does not stop the repos after it', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-empty-'));
	const empty = path.join(tmp, 'empty-repo');
	fs.mkdirSync(empty);
	execFileSync('git', ['init', '-q', empty], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	const data = seedSession(path.join(tmp, 'data'));
	const r = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', empty, '--data-root', data], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /windows 0 · commits 0 · unreadable 1/);
	assert.match(r.stderr, /skipped .*does not have any commits/);
});

// ── v2: --retrospective turns on attribution and the two convergence curves ────────────────────────
// The trap this fixture exists for: a RENAME. Without -M git reports one as an add of N lines plus a
// delete of N, so a refactor that moves a 50-line file would print a 50-line convergence spike in the
// week nothing was written. W39 below is exactly that commit and must read lines_new 0.
const V2 = 'perspective/retrospective-sessions/2026-09-07--fx';

/** git as a NAMED author, with the developer's own global config kept out of it. */
const gitAs = (dir, who, args, when) =>
	execFileSync('git', ['-c', `user.name=${who.name}`, '-c', `user.email=${who.email}`, '-C', dir, ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_SYSTEM: '/dev/null',
			...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
		},
	});

const ADA = { name: 'Ada Lovelace', email: 'ada@x.test' };
const BO = { name: 'Bo Peep', email: 'bo@x.test' };

function v2Fixture() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-v2-'));
	const repo = path.join(tmp, 'acme-portal');
	fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
	fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	const commit = (who, msg, when) => { gitAs(repo, who, ['add', '-A'], when); gitAs(repo, who, ['commit', '-q', '-m', msg], when); };

	// W36 — Ada adds a NEW 3-line file.
	fs.writeFileSync(path.join(repo, 'src', 'new.txt'), 'a\nb\nc\n');
	commit(ADA, 'add src/new.txt', '2026-09-01T10:00:00Z');
	// W37 — Bo MODIFIES it: one line replaced, two appended → 3 insertions + 1 deletion.
	fs.writeFileSync(path.join(repo, 'src', 'new.txt'), 'a\nX\nc\nd\ne\n');
	commit(BO, 'edit src/new.txt', '2026-09-09T10:00:00Z');
	// W38 — Ada adds a 50-line file, so the rename in W39 has something big to move.
	fs.writeFileSync(path.join(repo, 'lib', 'big.txt'), Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n');
	commit(ADA, 'add lib/big.txt', '2026-09-16T10:00:00Z');
	// W39 — Ada RENAMES it and touches nothing else.
	gitAs(repo, ADA, ['mv', 'lib/big.txt', 'lib/renamed.txt'], '2026-09-23T10:00:00Z');
	commit(ADA, 'rename lib/big.txt', '2026-09-23T10:00:00Z');

	return { tmp, repo, data: seedSession(path.join(tmp, 'data')), scratch: path.join(tmp, 'scratch') };
}

const weeksIn = (data) =>
	Object.fromEntries(
		listRecords(path.join(data, 'perspective', 'activity-weeks')).map((f) => {
			const { fields } = readRecord(f);
			return [fields.period, fields];
		}),
	);

test('v2 splits insertions into the new-code and changed-code curves, and a rename is never new code', () => {
	const { tmp, repo, data, scratch } = v2Fixture();
	const out = execFileSync('node', [BIN, '--retrospective', V2, '--repo-path', repo, '--data-root', data, '--scratch-root', scratch, '--contributor', ADA.email, ...SINCE], { encoding: 'utf8' });
	assert.match(out, /repos 1 · windows 4 · commits 4 · unreadable 0 · authors 2 \(\+2 new collaborators\) · contributor commits 3/);

	const w = weeksIn(data);
	assert.deepEqual(Object.keys(w).sort(), ['2026-W36', '2026-W37', '2026-W38', '2026-W39']);

	assert.equal(w['2026-W36'].lines_new, 3, 'a brand-new file is new code');
	assert.equal(w['2026-W36'].lines_modified, 0);
	assert.equal(w['2026-W36'].lines_added, 3, 'lines_added keeps counting every insertion');
	assert.deepEqual(w['2026-W36'].modules_touched, ['src']);
	assert.deepEqual(w['2026-W36'].authors, ['Ada Lovelace']);

	assert.equal(w['2026-W37'].lines_new, 0, 'editing an existing file is never new code');
	assert.equal(w['2026-W37'].lines_modified, 4, '3 insertions + 1 deletion inside a file that existed');
	assert.deepEqual(w['2026-W37'].authors, ['Bo Peep']);

	assert.equal(w['2026-W38'].lines_new, 50);
	assert.deepEqual(w['2026-W38'].modules_touched, ['lib']);

	// THE REGRESSION. Without -M this week reads lines_new 50 and fakes a convergence spike.
	assert.equal(w['2026-W39'].lines_new, 0, 'a rename must not register as new code');
	assert.equal(w['2026-W39'].lines_modified, 0);
	assert.equal(w['2026-W39'].commits, 1);
	assert.deepEqual(w['2026-W39'].modules_touched, ['lib']);

	// Commits are deliberately NOT records (design §8) — the cluster stage reads this file instead.
	const jsonl = path.join(scratch, 'commits', SESSION.split('/').pop(), 'acme-portal.jsonl');
	const lines = fs.readFileSync(jsonl, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	assert.equal(lines.length, 4, 'one JSON line per commit');
	const renameLine = lines.find((l) => l.subject === 'rename lib/big.txt');
	assert.equal(renameLine.author_email, ADA.email);
	assert.match(renameLine.sha, /^[0-9a-f]{40}$/);
	assert.deepEqual(renameLine.files.map((f) => [f.path, f.status]), [['lib/renamed.txt', 'R100']]);
	assert.equal(renameLine.repo, 'acme-portal');
	assert.ok(Array.isArray(renameLine.branches));

	fs.rmSync(tmp, { recursive: true, force: true });
});

test('v2 writes one collaborator per distinct git identity, and a second run adds no records', () => {
	const { tmp, repo, data, scratch } = v2Fixture();
	const run = () => execFileSync('node', [BIN, '--retrospective', V2, '--repo-path', repo, '--data-root', data, '--scratch-root', scratch, ...SINCE], { encoding: 'utf8' });
	run();

	const load = () =>
		Object.fromEntries(
			listRecords(path.join(data, 'perspective', 'users')).map((f) => {
				const { fields } = readRecord(f);
				return [path.basename(f), fields];
			}),
		);

	const first = load();
	assert.deepEqual(Object.keys(first).sort(), ['ada-lovelace.user.md', 'bo-peep.user.md']);
	const ada = first['ada-lovelace.user.md'];
	assert.deepEqual(ada.handles, ['Ada Lovelace', 'ada@x.test'], 'both the address and the display name are merge keys');
	assert.equal(ada.retrospective, V2);
	assert.equal(ada.evidence_count, 3);
	assert.equal(ada.first_seen, '2026-09-01');
	assert.equal(ada.last_seen, '2026-09-23');
	assert.deepEqual(ada.roles_observed, ['author']);
	assert.deepEqual(ada.sources, ['perspective/sources/fx/git-repo--acme-portal']);
	assert.equal(first['bo-peep.user.md'].evidence_count, 1);

	// Idempotent in RECORDS AND COUNTS: no third record, no duplicated handle, and evidence_count is a
	// snapshot (max of existing and this run), so re-running the same window cannot inflate it.
	run();
	const second = load();
	assert.deepEqual(Object.keys(second).sort(), ['ada-lovelace.user.md', 'bo-peep.user.md'], 'two identities stay two records');
	assert.deepEqual(second['ada-lovelace.user.md'].handles, ['Ada Lovelace', 'ada@x.test']);
	assert.equal(second['ada-lovelace.user.md'].evidence_count, 3, 'a second run over the same window does not double the count');
	assert.deepEqual(second['ada-lovelace.user.md'].sources, ['perspective/sources/fx/git-repo--acme-portal']);

	// And the JSONL is truncated and rewritten, never appended to.
	const jsonl = path.join(scratch, 'commits', SESSION.split('/').pop(), 'acme-portal.jsonl');
	assert.equal(fs.readFileSync(jsonl, 'utf8').trim().split('\n').length, 4);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// Regression: a bridging identity arriving AFTER two groups
// exist left one person in two records — Sam Diaz, under a work email and a personal one.
// A<e1>, then B<e2>, then B<e1>: the third author matches A by email and B by name, and without a
// transitive union A and B never meet. check-records catches the result; the reader must not produce it.
test('identities that meet only through a third one still become ONE collaborator', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-union-'));
	const repo = path.join(tmp, 'acme-portal'); fs.mkdirSync(repo);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
	execFileSync('git', ['init', '-q', repo], { env });
	const commit = (name, email, file, day) => {
		fs.writeFileSync(path.join(repo, file), `${day}\n`);
		execFileSync('git', ['-C', repo, 'add', file], { env });
		execFileSync('git', ['-C', repo, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `${file} on ${day}`], { env: { ...env, GIT_AUTHOR_DATE: `2026-09-${day}T10:00:00Z`, GIT_COMMITTER_DATE: `2026-09-${day}T10:00:00Z` } });
	};
	// most commits first, so the sort processes A before either B identity
	commit('Ada Work', 'ada@work.test', 'a1.txt', '01');
	commit('Ada Work', 'ada@work.test', 'a2.txt', '02');
	commit('Ada Lovelace', 'ada@home.test', 'b1.txt', '03');   // B<e2> — no shared handle yet
	commit('Ada Lovelace', 'ada@work.test', 'b2.txt', '04');   // B<e1> — the bridge
	const data = seedSession(path.join(tmp, 'data'));
	const r = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', repo, '--data-root', data, '--scratch-root', path.join(tmp, 'scratch'), ...SINCE], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	const files = fs.readdirSync(path.join(data, 'perspective', 'users', 'fx'));
	assert.equal(files.length, 1, `one person, one record — got ${files.join(', ')}`);
	const { fields } = readRecord(path.join(data, 'perspective', 'users', 'fx', files[0]));
	assert.deepEqual(fields.handles, ['Ada Lovelace', 'Ada Work', 'ada@home.test', 'ada@work.test']);
	assert.equal(fields.evidence_count, 4);
});

// The default window is the last activity_weeks_back weeks (4), not all of history — 1,019 weekly
// records across 51 repos was the wrong first artefact. An explicit --since still reaches back.
test('with no --since, a commit older than four weeks writes no week; --since reaches it', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-window-'));
	const repo = path.join(tmp, 'acme-portal'); fs.mkdirSync(repo);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
	execFileSync('git', ['init', '-q', repo], { env });
	fs.writeFileSync(path.join(repo, 'old.txt'), 'old\n');
	execFileSync('git', ['-C', repo, 'add', 'old.txt'], { env });
	execFileSync('git', ['-C', repo, '-c', 'user.name=Old Hand', '-c', 'user.email=old@x.test', 'commit', '-q', '-m', 'ancient'], { env: { ...env, GIT_AUTHOR_DATE: '2025-01-15T10:00:00Z', GIT_COMMITTER_DATE: '2025-01-15T10:00:00Z' } });
	const data = seedSession(path.join(tmp, 'data'));
	const a = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', repo, '--data-root', data, '--scratch-root', path.join(tmp, 's1')], { encoding: 'utf8' });
	assert.equal(a.status, 0, a.stderr);
	assert.match(a.stdout, /windows 0 · commits 0/, 'the default four-week window excludes a 2025 commit');
	const b = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', repo, '--data-root', data, '--scratch-root', path.join(tmp, 's2'), '--since', '2024-01-01'], { encoding: 'utf8' });
	assert.match(b.stdout, /windows 1 · commits 1/, 'an explicit --since reaches it');
});

// check-records compares handles lowercased; the reader must too, or `Sam.D@Example.com` and
// `sam.d@example.com` stay two records that the guard then refuses.
test('emails differing only in case are one handle and one collaborator', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-case-'));
	const repo = path.join(tmp, 'acme-portal'); fs.mkdirSync(repo);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
	execFileSync('git', ['init', '-q', repo], { env });
	const commit = (name, email, file) => {
		fs.writeFileSync(path.join(repo, file), `${file}\n`);
		execFileSync('git', ['-C', repo, 'add', file], { env });
		execFileSync('git', ['-C', repo, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', file], { env: { ...env, GIT_AUTHOR_DATE: '2026-09-05T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-05T10:00:00Z' } });
	};
	commit('Sam D', 'Sam.D@Example.com', 'a.txt');
	commit('Sam Diaz', 'sam.d@example.com', 'b.txt');
	const data = seedSession(path.join(tmp, 'data'));
	const r = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', repo, '--data-root', data, '--scratch-root', path.join(tmp, 's'), ...SINCE], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	const files = fs.readdirSync(path.join(data, 'perspective', 'users', 'fx'));
	assert.equal(files.length, 1, files.join(', '));
	const { fields } = readRecord(path.join(data, 'perspective', 'users', 'fx', files[0]));
	assert.ok(fields.handles.includes('sam.d@example.com') && !fields.handles.some((h) => h === 'Sam.D@Example.com'), fields.handles.join(','));
});

// Regression, found on the first fresh-workspace run: with --repo-path nobody had written the `sources`
// record, so every activity-week and collaborator the reader wrote dangled — 77 violations.
test('--repo-path writes the sources record its weeks and collaborators point at', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-git-src-'));
	const repo = path.join(tmp, 'acme-portal'); fs.mkdirSync(repo);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
	execFileSync('git', ['init', '-q', repo], { env });
	fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); execFileSync('git', ['-C', repo, 'add', 'a.txt'], { env });
	execFileSync('git', ['-C', repo, '-c', 'user.name=Ada', '-c', 'user.email=ada@x.test', 'commit', '-q', '-m', 'a'], { env: { ...env, GIT_AUTHOR_DATE: '2026-09-05T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-05T10:00:00Z' } });
	const data = seedSession(path.join(tmp, 'data'));
	const r = spawnSync('node', [BIN, '--retrospective', 'perspective/retrospective-sessions/2026-09-07--fx', '--repo-path', repo, '--data-root', data, '--scratch-root', path.join(tmp, 's'), ...SINCE], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	const src = recordPath('sources', 'fx/git-repo--acme-portal', 'source', data);
	assert.ok(fs.existsSync(src), 'the sources record exists');
	const { fields } = readRecord(src);
	assert.equal(fields.kind, 'git-repo'); assert.equal(fields.reach, 'available'); assert.equal(fields.label, 'acme-portal');
	const week = readRecord(recordPath('activity-weeks', `${SLUG}/git-repo--acme-portal/2026-W36`, 'activity-week', data)).fields;
	assert.equal(week.source, 'perspective/sources/fx/git-repo--acme-portal');
});

// The contributor gate. Without it, an inventory that includes cloned third-party repos yields a
// collaborator record for every open-source contributor to a vendored theme the contributor never
// opened. Sharing a checkout is not collaborating.
test('a collaborator is only kept when they share a repo with the contributor', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-gate-'));
	const data = seedSession(path.join(tmp, 'data'));
	const mk = (name, commits) => {
		const repo = path.join(tmp, name);
		fs.mkdirSync(repo, { recursive: true });
		execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
		for (const [who, email, msg] of commits) {
			fs.appendFileSync(path.join(repo, 'f.txt'), msg + '\n');
			const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
			execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'add', 'f.txt'], { env });
			execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'commit', '-q', '-m', msg], { env });
		}
		writeRecord(recordPath('sources', `${SLUG}/git-repo--${name}`, 'source', data), { retrospective: SESSION, kind: 'git-repo', label: name, reach: 'available', location: repo });
	};
	// one repo the contributor works in with a real teammate, one vendored clone they never touched
	mk('our-api', [['Me', 'me@work.test', 'ours one'], ['Team Mate', 'mate@work.test', 'ours two']]);
	mk('vendored-theme', [['Stranger One', 's1@oss.test', 'theirs one'], ['Stranger Two', 's2@oss.test', 'theirs two']]);

	const run = (extra = []) => execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', ...extra], { encoding: 'utf8' });
	const ungated = run();
	assert.match(ungated, /authors 4/);
	assert.equal(listRecords(path.join(data, 'perspective', 'users')).length, 4, 'without a contributor, every author is recorded');

	const gated = run(['--contributor', 'me@work.test']);
	assert.match(gated, /gated out 2 \(deleted 2\)/, 'the strangers are dropped AND their stale records removed');
	const kept = listRecords(path.join(data, 'perspective', 'users')).map((f) => readRecord(f).fields.name).sort();
	assert.deepEqual(kept, ['Me', 'Team Mate']);
});

test('the gate refuses to fire when the contributor is not in the window, rather than deleting everyone', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-gate2-'));
	const data = seedSession(path.join(tmp, 'data'));
	const repo = path.join(tmp, 'solo');
	fs.mkdirSync(repo, { recursive: true });
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
	execFileSync('git', ['-c', 'user.name=Someone', '-c', 'user.email=someone@work.test', '-C', repo, 'add', 'f.txt'], { env });
	execFileSync('git', ['-c', 'user.name=Someone', '-c', 'user.email=someone@work.test', '-C', repo, 'commit', '-q', '-m', 'only commit'], { env });
	writeRecord(recordPath('sources', 'fx/git-repo--solo', 'source', data), { retrospective: SESSION, kind: 'git-repo', label: 'solo', reach: 'available', location: repo });

	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', '--contributor', 'typo@work.test'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
	assert.match(out, /gated out 0/);
	assert.equal(listRecords(path.join(data, 'perspective', 'users')).length, 1, 'a mistyped contributor must not empty the collection');
});

// The other half of staleness, and the one that survived the gate: a record written by an earlier,
// WIDER run whose person does not appear in this window at all. `groups` never sees them, so nothing
// else in this script can. A 52-week re-read that found 57 authors left 120 records standing.
test('a collaborator absent from the whole window is pruned, but only when the script wrote them', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-stale-'));
	const data = seedSession(path.join(tmp, 'data'));
	const repo = path.join(tmp, 'our-api');
	fs.mkdirSync(repo, { recursive: true });
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
	execFileSync('git', ['-c', 'user.name=Me', '-c', 'user.email=me@work.test', '-C', repo, 'add', 'f.txt'], { env });
	execFileSync('git', ['-c', 'user.name=Me', '-c', 'user.email=me@work.test', '-C', repo, 'commit', '-q', '-m', 'one'], { env });
	writeRecord(recordPath('sources', 'fx/git-repo--our-api', 'source', data), { retrospective: SESSION, kind: 'git-repo', label: 'our-api', reach: 'available', location: repo });

	const stale = { retrospective: SESSION, name: 'Long Gone', handles: ['gone@old.test'], first_seen: '2019-01-01', last_seen: '2019-06-01', author: 'scripts/read-git@2' };
	writeRecord(recordPath('users', 'fx/long-gone', 'user', data), stale);
	writeRecord(recordPath('users', 'fx/hand-written', 'user', data), { ...stale, name: 'Hand Written', handles: ['hand@old.test'], author: 'agents/claude-code' });

	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', '--contributor', 'me@work.test'], { encoding: 'utf8' });
	assert.match(out, /gated out 1 \(deleted 1\)/);
	const kept = listRecords(path.join(data, 'perspective', 'users')).map((f) => readRecord(f).fields.name).sort();
	assert.deepEqual(kept, ['Hand Written', 'Me'], 'a hand-written record is never deleted by a script');
});

// One developer, five git identities, all declared in their own ~/.gitconfig via includeIf. Without
// this the person's largest "collaborator" is themselves — measured at 5,977 commits on the first
// real run, under a venture address they had wired to one project folder.
test('the contributor\'s other declared git identities are adopted, not counted as collaborators', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-ident-'));
	const data = seedSession(path.join(tmp, 'data'));
	const fakeHome = path.join(tmp, 'home');
	fs.mkdirSync(fakeHome);
	fs.writeFileSync(path.join(fakeHome, '.gitconfig-side'), '[user]\n\tname = sidekick\n\temail = me@side.test\n');
	fs.writeFileSync(path.join(fakeHome, '.gitconfig'),
		'[user]\n\tname = Me\n\temail = me@work.test\n\n[includeIf "gitdir:/x/side/"]\n\tpath = ~/.gitconfig-side\n');

	const repo = path.join(tmp, 'mixed');
	fs.mkdirSync(repo);
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	const commit = (who, email, msg) => {
		fs.appendFileSync(path.join(repo, 'f.txt'), msg + '\n');
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
		execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'add', 'f.txt'], { env });
		execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'commit', '-q', '-m', msg], { env });
	};
	commit('Me', 'me@work.test', 'one');
	commit('sidekick', 'me@side.test', 'two');
	commit('sidekick', 'me@side.test', 'three');
	commit('Real Teammate', 'mate@work.test', 'four');
	writeRecord(recordPath('sources', 'fx/git-repo--mixed', 'source', data), { retrospective: SESSION, kind: 'git-repo', label: 'mixed', reach: 'available', location: repo });

	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', '--contributor', 'me@work.test', '--home', fakeHome], { encoding: 'utf8' });
	assert.match(out, /own identities adopted 1/);
	assert.match(out, /contributor commits 3/, 'their own three commits, across both addresses');
	const kept = listRecords(path.join(data, 'perspective', 'users')).map((f) => readRecord(f).fields);
	assert.deepEqual(kept.map((f) => f.name).sort(), ['Me', 'Real Teammate']);
	const me = kept.find((f) => f.name === 'Me');
	assert.ok(me.handles.includes('me@side.test'), 'the second address is now one of their handles');
});

test('a declared-identity set that does not contain the contributor is adopted by nobody', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-ident2-'));
	const data = seedSession(path.join(tmp, 'data'));
	const fakeHome = path.join(tmp, 'home');
	fs.mkdirSync(fakeHome);
	// the machine's owner is someone else — reading a teammate BY PROXY must adopt nothing
	fs.writeFileSync(path.join(fakeHome, '.gitconfig'), '[user]\n\tname = Owner\n\temail = owner@work.test\n');
	const repo = path.join(tmp, 'shared');
	fs.mkdirSync(repo);
	execFileSync('git', ['init', '-q', repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
	for (const [who, email, msg] of [['Owner', 'owner@work.test', 'a'], ['Subject', 'subject@work.test', 'b']]) {
		fs.appendFileSync(path.join(repo, 'f.txt'), msg + '\n');
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
		execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'add', 'f.txt'], { env });
		execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${email}`, '-C', repo, 'commit', '-q', '-m', msg], { env });
	}
	writeRecord(recordPath('sources', 'fx/git-repo--shared', 'source', data), { retrospective: SESSION, kind: 'git-repo', label: 'shared', reach: 'available', location: repo });
	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', '--contributor', 'subject@work.test', '--home', fakeHome], { encoding: 'utf8' });
	assert.match(out, /own identities adopted 0/);
	assert.equal(listRecords(path.join(data, 'perspective', 'users')).length, 2, 'the machine owner stays a separate person');
});

// The third dimension the convergence curves are sliced by. A rising bug SHARE late in a project is
// the alarm; that reading only survives if unlabelled commits are counted as NEITHER rather than
// swept into change requests.
test('commitIntent is three-valued, and bug wins on a tie', () => {

	for (const s of ['fix: null guard on the parser', 'hotfix login', 'revert "feat: lanes"', 'chore: repair the flaky suite', 'the importer crashes on an empty file'])
		assert.equal(commitIntent(s), 'bug', s);
	for (const s of ['feat: gantt layout', 'refactor the reader', 'add a fixture for the week boundary', 'docs: the release checklist', 'perf: stream the log'])
		assert.equal(commitIntent(s), 'change-request', s);
	for (const s of ['wip', 'Monday', 'v0.21.0', 'Merge branch main'])
		assert.equal(commitIntent(s), 'neither', `unlabelled must not inflate the change-request count: ${s}`);
	assert.equal(commitIntent('fix: add the missing guard'), 'bug', 'a commit that fixes while adding is the expensive kind');
});

// Reading ANOTHER person's work from a clone nobody checks out: their recent commits sit on a remote
// ref and `git log` reads HEAD. Six freshly fetched clones whose HEADs stopped in June while the
// remotes ran to September is how this was found.
test('--all-refs reads work that is on a branch HEAD is not on', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-refs-'));
	const data = seedSession(path.join(tmp, 'data'));
	const repo = path.join(tmp, 'sidebranch');
	fs.mkdirSync(repo);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
	execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
	const commit = (msg, when) => {
		fs.appendFileSync(path.join(repo, 'f.txt'), msg + '\n');
		git(repo, ['add', 'f.txt'], when);
		git(repo, ['commit', '-q', '-m', msg], when);
	};
	commit('on main', '2026-09-01T10:00:00Z');
	git(repo, ['checkout', '-q', '-b', 'theirs']);
	commit('fix: on their branch', '2026-09-09T10:00:00Z');
	commit('feat: also on their branch', '2026-09-09T11:00:00Z');
	git(repo, ['checkout', '-q', 'main']);   // HEAD is back on main; their two commits are elsewhere
	writeRecord(recordPath('sources', 'fx/git-repo--sidebranch', 'source', data), { retrospective: SESSION, kind: 'git-repo', label: 'sidebranch', reach: 'available', location: repo });

	const run = (extra = []) => execFileSync('node', [BIN, '--retrospective', SESSION, '--data-root', data, '--since', '2026-01-01', ...extra], { encoding: 'utf8' });
	assert.match(run(), /commits 1/, 'HEAD only — the branch work is invisible');
	assert.match(run(['--all-refs']), /commits 3/);
	const w = readRecord(recordPath('activity-weeks', `${SLUG}/git-repo--sidebranch/2026-W37`, 'activity-week', data)).fields;
	assert.equal(w.commits_bug, 1);
	assert.equal(w.commits_change_request, 1, 'and the intent split lands on the week');
});

test('a re-read that comes out SMALLER is counted, and its usual cause named', () => {
	// ⚠ `git log` walks HEAD, and HEAD is whatever branch a checkout sits on. A run WITHOUT
	// `--all-refs` over a repo whose work lives on a feature branch reports a fraction of it and
	// drops the authors who only appear there. Measured 2026-09-08 on a real workspace: a re-read
	// took one week from 7 commits and 2 authors to 3 and 1, and would have overwritten 90 weeks
	// with the narrower number in silence — the receipt said 2060 commits where the run before it
	// had said 6913, and nothing connected the two.
	const { tmp, repo, data, scratch } = v2Fixture();
	// Bo does more W37 work on a side branch that HEAD cannot see. ⚠ Dated INTO AN EXISTING WEEK on
	// purpose: a side-branch commit in a week of its own would make that week vanish from the narrow
	// read rather than shrink, and a week the reader no longer sees is left on disk untouched — see
	// the reader's note. The damaging case is the one where a week the reader DOES write comes back
	// smaller, and that is what this pins.
	gitAs(repo, BO, ['checkout', '-q', '-b', 'side'], '2026-09-09T11:00:00Z');
	fs.writeFileSync(path.join(repo, 'src', 'side.txt'), 'only on the branch\n');
	gitAs(repo, BO, ['add', '-A'], '2026-09-09T11:00:00Z');
	gitAs(repo, BO, ['commit', '-q', '-m', 'work nobody on the checked-out branch can see'], '2026-09-09T11:00:00Z');
	gitAs(repo, BO, ['checkout', '-q', '-'], '2026-09-09T11:00:00Z');

	const args = (extra) => ['node', [BIN, '--retrospective', V2, '--repo-path', repo, '--data-root', data, '--scratch-root', scratch, '--contributor', ADA.email, ...SINCE, ...extra]];
	const wide = execFileSync(...args(['--all-refs']), { encoding: 'utf8' });
	assert.doesNotMatch(wide, /came out SMALLER/, 'a first read cannot shrink anything');
	const before = Object.values(weeksIn(data)).reduce((a, w) => a + (w.commits ?? 0), 0);

	const narrow = execFileSync(...args([]), { encoding: 'utf8' });
	assert.match(narrow, /came out SMALLER than the record already on disk/);
	assert.match(narrow, /You did not pass --all-refs/, 'and it names the cause rather than only the symptom');
	const after = Object.values(weeksIn(data)).reduce((a, w) => a + (w.commits ?? 0), 0);
	assert.ok(after < before, `the narrow read must actually be smaller (${after} vs ${before})`);
	fs.rmSync(tmp, { recursive: true, force: true });
});
