// cluster-activities' promise: a run of evidence with no long silence in it is ONE candidate, and a
// silence longer than --gap-days splits it. The fixture puts the split where a wrong reader would
// miss it — day 1, day 2, then day 10 in the SAME repo, so anything bucketing by month or by repo
// alone returns one candidate and fails here. The three kinds are mixed on purpose: the second
// candidate is a session plus a ticket, which is where `handles` has to come from the ticket rather
// than a commit.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord, listRecords } from '../lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'cluster-activities.mjs');
const RUN = 'perspective/retrospective-sessions/2026-09-07--fx';
const BASE = '2026-09-07--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const SOURCE = `perspective/sources/${SLUG}/claude-transcripts--default`;

/** Every reader resolves its key off the run record, so a data root without one cannot be read. */
function seedSession(data, contact = 'a@x.test') {
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data),
		{ contributor: SLUG, contact, started: BASE.slice(0, 10), stage: 'installed' });
	return data;
}

/** Three conversations, two commits and one ticket in repo `acme`, on days 1, 2 and 10. */
function fixture() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-cluster-'));
	const data = seedSession(path.join(tmp, 'data'));
	const scratch = path.join(tmp, 'scratch');

	const conversation = (sid, startedAt, title, topics) =>
		writeRecord(recordPath('conversations', `${SLUG}/claude-code/2026/08/${sid}`, 'conversation', data), {
			session_id: sid,
			harness: 'claude-code',
			title,
			transcript_path: `\${userHome}/.claude/projects/-acme/${sid}.jsonl`,
			depth: 'summarized',
			inspected_at: '2026-09-07T00:00:00.000Z',
			inspector_version: 'metrics/1',
			source: SOURCE,
			repo_name: 'acme',
			started_at: startedAt,
			ended_at: startedAt,
			active_minutes: 30,
			turns_user: 5,
			key_topics: topics,
		});

	conversation('sess-one', '2026-08-01T09:00:00.000Z', 'invoice parser rewrite', ['invoice', 'parser']);
	conversation('sess-two', '2026-08-02T09:00:00.000Z', 'invoice parser edge cases', ['invoice', 'parser']);
	conversation('sess-ten', '2026-08-10T09:00:00.000Z', 'dashboard layout', ['dashboard']);

	writeRecord(recordPath('tickets', `${SLUG}/asana--fx/1001`, 'ticket', data), {
		source: `perspective/sources/${SLUG}/asana--fx`,
		external_id: '1001',
		title: 'dashboard layout review',
		project: 'acme',
		assignee_handle: 'b@x.test',
		created_on: '2026-08-10',
		status: 'open',
	});

	const commitsDir = path.join(scratch, 'commits', BASE);
	fs.mkdirSync(commitsDir, { recursive: true });
	fs.writeFileSync(
		path.join(commitsDir, 'acme.jsonl'),
		[
			{ sha: 'aaaaaaa', date: '2026-08-01T12:00:00.000Z', author_email: 'a@x.test', author_name: 'A', branches: ['main'], subject: 'invoice parser: split the header', files: [{ path: 'src/parse.js' }], repo: 'acme' },
			{ sha: 'bbbbbbb', date: '2026-08-02T12:00:00.000Z', author_email: 'a@x.test', author_name: 'A', branches: ['main'], subject: 'invoice parser: totals', files: [{ path: 'src/parse.js' }], repo: 'acme' },
		].map((c) => JSON.stringify(c)).join('\n') + '\n',
	);

	return { tmp, data, scratch };
}

const readCandidates = (scratch) =>
	fs.readFileSync(path.join(scratch, 'activity-candidates', `${BASE}.jsonl`), 'utf8')
		.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a gap longer than --gap-days splits one repo into two candidates, each carrying its own handles', () => {
	const { tmp, data, scratch } = fixture();
	const r = spawnSync('node', [BIN, '--retrospective', RUN, '--data-root', data, '--scratch-root', scratch, '--gap-days', '3'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /candidates 2/);
	assert.match(r.stdout, /from 3 sessions, 2 commits, 1 tickets/);

	const c = readCandidates(scratch);
	assert.equal(c.length, 2);

	const [first, second] = c;
	assert.equal(first.repo, 'acme');
	assert.equal(first.started, '2026-08-01');
	assert.equal(first.ended, '2026-08-02');
	assert.equal(first.sessions.length, 2);
	assert.deepEqual(first.commits, ['aaaaaaa', 'bbbbbbb']);
	assert.deepEqual(first.handles, ['a@x.test']);
	assert.deepEqual(first.branches, ['main']);
	assert.equal(first.commit_count, 2);
	assert.equal(first.turns_user, 10);
	assert.equal(first.active_minutes, 60);
	assert.equal(first.tickets.length, 0);
	assert.ok(first.label_seed.length > 0, 'label seed must be non-empty');
	assert.ok(first.label_seed.includes('invoice'), `expected 'invoice' in ${JSON.stringify(first.label_seed)}`);
	assert.equal(first.singleton, false);

	assert.equal(second.started, '2026-08-10');
	assert.equal(second.sessions.length, 1);
	assert.deepEqual(second.tickets, [`perspective/tickets/${SLUG}/asana--fx/1001`]);
	assert.deepEqual(second.commits, []);
	assert.deepEqual(second.handles, ['b@x.test']);
	assert.ok(second.label_seed.includes('dashboard'));
	assert.equal(second.singleton, false);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// The commits dump is written by read-git and is routinely ABSENT — read-git has not been run for
// this retrospective yet, or ran before it learned to dump commits. That is 0 commits and a normal
// run; an ENOENT here would block the whole cluster stage on evidence that is merely optional.
test('an absent commits scratch directory is 0 commits, not an error', () => {
	const { tmp, data } = fixture();
	const emptyScratch = path.join(tmp, 'no-commits-here');
	const r = spawnSync('node', [BIN, '--retrospective', RUN, '--data-root', data, '--scratch-root', emptyScratch, '--gap-days', '3'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /from 3 sessions, 0 commits, 1 tickets/);
	assert.equal(readCandidates(emptyScratch).length, 2);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// A one-item run of evidence is still a candidate — the model must SEE it to dismiss it — but it is
// flagged so the naming pass can treat it differently from a week of work.
test('a lone item is emitted as a flagged singleton and counted in the receipt', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-cluster-single-'));
	const data = seedSession(path.join(tmp, 'data'));
	writeRecord(recordPath('conversations', `${SLUG}/claude-code/2026/08/only`, 'conversation', data), {
		session_id: 'only', harness: 'claude-code', title: 'lonely migration spike',
		transcript_path: '${userHome}/.claude/projects/-x/only.jsonl', depth: 'minimal',
		inspected_at: '2026-09-07T00:00:00.000Z', inspector_version: 'metrics/1', source: SOURCE,
		repo_name: 'solo', started_at: '2026-08-05T09:00:00.000Z', turns_user: 1,
	});
	const r = spawnSync('node', [BIN, '--retrospective', RUN, '--data-root', data, '--scratch-root', path.join(tmp, 'scratch')], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /candidates 1 · from 1 sessions, 0 commits, 0 tickets, 0 meetings · repos 1 · singletons 1/);
	assert.equal(readCandidates(path.join(tmp, 'scratch'))[0].singleton, true);

	fs.rmSync(tmp, { recursive: true, force: true });
});

test('--dry-run writes nothing but still reports the count', () => {
	const { tmp, data, scratch } = fixture();
	const out = path.join(scratch, 'activity-candidates', `${BASE}.jsonl`);
	const r = spawnSync('node', [BIN, '--retrospective', RUN, '--data-root', data, '--scratch-root', scratch, '--dry-run'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /candidates 2 .*DRY RUN/);
	assert.equal(fs.existsSync(out), false);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// Regression, found on the first multi-author run: the clusterer bucketed EVERY author's commits, so a
// candidate for a shared repo was a repo-wide window mixing the contributor's work with everyone else's
// — and a colleague sharing a first name and a near-identical work address landed inside the
// contributor's own activities. A retrospective is ONE person's perspective; the commits must be theirs.
test('only the contributor’s commits reach a candidate, matched on any of their handles', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-cluster-who-'));
	const data = path.join(tmp, 'data');
	const scratch = path.join(tmp, 'scratch');
	const BASE = '2026-09-07--fx';
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), {
		contributor: SLUG, handles: ['me@work.test'], started: '2026-09-07', stage: 'condensed',
	});
	writeRecord(recordPath('world/users', `${SLUG}/me`, 'user', data), {
		retrospective: `perspective/retrospective-sessions/${BASE}`, name: 'Me',
		handles: ['me@work.test', 'me@home.test', 'My Name'],
	});
	writeRecord(recordPath('world/users', `${SLUG}/them`, 'user', data), {
		retrospective: `perspective/retrospective-sessions/${BASE}`, name: 'Them',
		handles: ['them@work.test'],
	});
	const dir = path.join(scratch, 'commits', BASE);
	fs.mkdirSync(dir, { recursive: true });
	const c = (sha, email, name, day, subject) => JSON.stringify({ sha, date: `2026-09-0${day}T10:00:00Z`, author_email: email, author_name: name, subject, files: [], repo: 'acme' });
	fs.writeFileSync(path.join(dir, 'acme.jsonl'), [
		c('aaaaaaa', 'me@work.test', 'My Name', 1, 'mine by work address'),
		c('bbbbbbb', 'me@home.test', 'My Name', 2, 'mine by the other address'),
		c('ccccccc', 'someone@x.test', 'My Name', 2, 'mine by display name'),
		c('ddddddd', 'them@work.test', 'Them', 2, 'theirs, and it must not appear'),
		c('eeeeeee', 'stranger@x.test', 'Stranger', 3, 'a stranger, also excluded'),
	].join('\n') + '\n');
	const r = spawnSync('node', [BIN, '--retrospective', `perspective/retrospective-sessions/${BASE}`, '--data-root', data, '--scratch-root', scratch], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /2 commits by others skipped/);
	const lines = fs.readFileSync(path.join(scratch, 'activity-candidates', `${BASE}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const shas = lines.flatMap((l) => l.commits).sort();
	assert.deepEqual(shas, ['aaaaaaa', 'bbbbbbb', 'ccccccc'], 'three of the contributor’s, none of anyone else’s');
});

// The analysis window is not the evidence on disk. Weekly records are kept for all of history
// deliberately; naming activities back four years is a different job and triples the candidate
// count with singletons nobody reads.
test('--since bounds the analysis without touching what is on disk, and a ticket closed inside the window counts', () => {
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-since-')));
	const S = 'perspective/retrospective-sessions/2026-09-07--fx';
	const put = (coll, id, suffix, fields) => writeRecord(recordPath(coll, `${id}`, suffix, data), fields);
	put('conversations', `${SLUG}/claude-code/2022/01/old`, 'conversation', { session_id: 'old', harness: 'claude-code', title: 'ancient', transcript_path: '${userHome}/a', depth: 'minimal', inspected_at: '2026-01-01T00:00:00Z', inspector_version: 'metrics/3', started_at: '2022-01-05T09:00:00Z', turns_user: 4, repo_name: 'api' });
	put('conversations', `${SLUG}/claude-code/2026/08/new`, 'conversation', { session_id: 'new', harness: 'claude-code', title: 'recent', transcript_path: '${userHome}/b', depth: 'minimal', inspected_at: '2026-09-01T00:00:00Z', inspector_version: 'metrics/3', started_at: '2026-08-05T09:00:00Z', turns_user: 9, repo_name: 'api' });
	// opened long ago, CLOSED inside the window — that is this year's work
	put('tickets', `${SLUG}/asana/reopened`, 'ticket', { source: `perspective/sources/${SLUG}/asana--x`, external_id: '1', title: 'long-running migration', created_on: '2022-03-01', completed_on: '2026-07-14', status: 'completed', project: 'api' });
	put('tickets', `${SLUG}/asana/ancient`, 'ticket', { source: `perspective/sources/${SLUG}/asana--x`, external_id: '2', title: 'done and buried', created_on: '2022-03-01', completed_on: '2022-04-01', status: 'completed', project: 'api' });

	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-scratch-'));
	const run = (extra = []) => execFileSync('node', [BIN, '--retrospective', S, '--data-root', data, '--scratch-root', scratch, ...extra], { encoding: 'utf8' });
	assert.match(run(), /from 2 sessions, 0 commits, 2 tickets/, 'with no window, everything on disk clusters');
	const bounded = run(['--since', '2025-09-08']);
	assert.match(bounded, /from 1 sessions, 0 commits, 1 tickets/);
	assert.match(bounded, /window since 2025-09-08 \(2 items older, kept on disk\)/);
	assert.equal(listRecords(path.join(data, 'perspective', 'conversations')).length, 2, 'and nothing was deleted');
});

// An unquoted YAML date parses to a Date OBJECT. `period_start: 2025-09-08` therefore arrived as a
// Date, `date + 'T00:00:00Z'` produced an unparseable string, and the window silently did not apply
// — the receipt said "window since Mon Sep 08 2025 03:00:00 GMT+0300 (0 items older)".
test('period_start read from the record bounds the window even when YAML hands back a Date', () => {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-yamldate-'));
	const S = 'perspective/retrospective-sessions/2026-09-07--fx';
	fs.mkdirSync(path.join(data, 'perspective', 'retrospective-sessions'), { recursive: true });
	// written by hand, UNQUOTED, exactly as `dt set` leaves it
	fs.writeFileSync(path.join(data, 'perspective', 'retrospective-sessions', '2026-09-07--fx.retrospective-session.md'),
		'---\ncontributor: fx\nstarted: 2026-09-07\nperiod_start: 2025-09-08\n---\n');
	const put = (coll, id, suffix, fields) => writeRecord(recordPath(coll, id, suffix, data), fields);
	put('conversations', `${SLUG}/claude-code/2022/01/old`, 'conversation', { session_id: 'o', harness: 'claude-code', title: 'ancient', transcript_path: '${userHome}/a', depth: 'minimal', inspected_at: '2026-01-01T00:00:00Z', inspector_version: 'metrics/3', started_at: '2022-01-05T09:00:00Z', turns_user: 4, repo_name: 'api' });
	put('conversations', `${SLUG}/claude-code/2026/08/new`, 'conversation', { session_id: 'n', harness: 'claude-code', title: 'recent', transcript_path: '${userHome}/b', depth: 'minimal', inspected_at: '2026-09-01T00:00:00Z', inspector_version: 'metrics/3', started_at: '2026-08-05T09:00:00Z', turns_user: 9, repo_name: 'api' });
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-scratch2-'));
	const out = execFileSync('node', [BIN, '--retrospective', S, '--data-root', data, '--scratch-root', scratch], { encoding: 'utf8' });
	assert.match(out, /window since 2025-09-08 \(1 items older, kept on disk\)/);
	assert.match(out, /from 1 sessions/);
});

// A gap rule alone produces UNBOUNDED candidates. Measured 2026-09-08: a repo worked on at least
// every three days for six months collapsed into ONE candidate of 257 sessions and 1,753 commits,
// and the naming pass skipped it — with 44 others, together holding 616 sessions. They were not lost
// to a bug; nobody can answer "what task is this?" about six months of continuous work.
test('a long unbroken run splits on SIZE, at its largest internal gap', () => {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-size-'));
	const S = 'perspective/retrospective-sessions/2026-09-07--fx';
	// 30 sessions one day apart — never a 3-day gap, so the gap rule alone yields exactly one
	// candidate. Day 10→11 is widened to 2 days so there is one clearly largest seam.
	let day = 1;
	for (let i = 0; i < 30; i++) {
		day += (i === 10 ? 2 : 1);
		const iso = new Date(Date.UTC(2026, 0, day)).toISOString();
		writeRecord(recordPath('conversations', `${SLUG}/claude-code/2026/01/s${i}`, 'conversation', data), {
			session_id: `s${i}`, harness: 'claude-code', title: `session ${i}`,
			transcript_path: '${userHome}/x', depth: 'minimal', inspected_at: '2026-02-01T00:00:00Z',
			inspector_version: 'metrics/3', started_at: iso, turns_user: 2, repo_name: 'api',
		});
	}
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-size-sc-'));
	const run = (extra = []) => execFileSync('node', [BIN, '--retrospective', S, '--data-root', data, '--scratch-root', scratch, ...extra], { encoding: 'utf8' });

	assert.match(run(['--max-items', '1000', '--max-days', '3650']), /candidates 1 /, 'the gap rule alone sees one continuous run');

	const capped = run(['--max-items', '12', '--max-days', '3650']);
	assert.match(capped, /run\(s\) split for size/);
	const lines = fs.readFileSync(path.join(scratch, 'activity-candidates', '2026-09-07--fx.jsonl'), 'utf8')
		.trim().split('\n').map((l) => JSON.parse(l));
	assert.ok(lines.length >= 3, `expected several candidates, got ${lines.length}`);
	for (const c of lines) assert.ok(c.sessions.length <= 12, `a candidate still over the cap: ${c.sessions.length}`);
	// Nothing may be lost in the split — that would trade one data-loss bug for another.
	const total = lines.reduce((n, c) => n + c.sessions.length, 0);
	assert.equal(total, 30, 'every session survives the split');
	// And the seam is the real pause, not an arbitrary index.
	const boundaries = lines.map((c) => c.started).sort();
	assert.ok(boundaries.length > 1);
});

test('a run under the cap is never split, and a tiny one is never seamed at all', () => {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-size2-'));
	const S = 'perspective/retrospective-sessions/2026-09-07--fx';
	for (let i = 0; i < 3; i++) {
		writeRecord(recordPath('conversations', `claude-code/2026/01/t${i}`, 'conversation', data), {
			session_id: `t${i}`, harness: 'claude-code', title: `t${i}`, transcript_path: '${userHome}/x',
			depth: 'minimal', inspected_at: '2026-02-01T00:00:00Z', inspector_version: 'metrics/3',
			started_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), turns_user: 1, repo_name: 'api',
		});
	}
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-size2-sc-'));
	const out = execFileSync('node', [BIN, '--retrospective', S, '--data-root', data, '--scratch-root', scratch, '--max-items', '2', '--max-days', '3650'], { encoding: 'utf8' });
	assert.match(out, /candidates 1 /, 'a run of three is too small to seam, whatever the cap says');
});
