// The field had four readers and no writer: every reader re-reads `summary` so a re-run will not
// clobber it, and nothing ever put one there. What this pins is the composition and its three
// refusals — a week belongs to a SOURCE and not merely to a date, a written summary outranks a
// composed one, and a week of somebody else's commits is left blank rather than narrated.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord, readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const BIN = fileURLToPath(new URL('../../skills/running-retrospectives/bin/compose-week-summaries.mjs', import.meta.url));
const BASE = '2026-09-08--fx', REF = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const ME = 'me@acme.example';
const SRC = (s) => `perspective/sources/${SLUG}/${s}`;

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weeks-'));
	const data = path.join(root, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: [ME], started: '2026-09-08', period_start: new Date('2026-01-01T00:00:00Z'), period_end: '2026-12-31' });
	writeRecord(recordPath('world/users', `${SLUG}/me`, 'user', data), { retrospective: REF, name: 'Me', handles: [ME, 'Me Myself'] });
	// Two mail threads in the same week, on two DIFFERENT mailboxes — the case a date-only match gets
	// wrong, because each week record is one source.
	writeRecord(recordPath('threads', 'gmail--work/t1', 'thread', data), { source: SRC('gmail--work'), external_id: 't1', subject: 'a', first_on: '2026-03-03' });
	writeRecord(recordPath('threads', 'gmail--home/t2', 'thread', data), { source: SRC('gmail--home'), external_id: 't2', subject: 'b', first_on: '2026-03-04' });
	writeRecord(recordPath('world/activities', `${SLUG}/2026-03-02--argued-the-contract`, 'activity', data), {
		retrospective: REF, name: 'Argued the contract', started: '2026-03-02', ended: '2026-03-05',
		threads: ['perspective/threads/gmail--work/t1'],
	});
	writeRecord(recordPath('world/activities', `${SLUG}/2026-03-03--booked-the-holiday`, 'activity', data), {
		retrospective: REF, name: 'Booked the holiday', started: '2026-03-03', ended: '2026-03-03',
		threads: ['perspective/threads/gmail--home/t2'],
	});
	const week = (source, extra = {}) => writeRecord(recordPath('activity-weeks', `${source}/2026-W10`, 'activity-week', data),
		{ source: SRC(source), period: '2026-W10', start_date: '2026-03-02', end_date: '2026-03-08', ...extra });
	week('gmail--work');
	week('gmail--home');
	// A repo the contributor never committed to — counted by read-git all the same.
	week('git-repo--theirs', { commits: 134, authors: ['Someone Else', 'Another Person'] });
	// A repo of his own with a quiet week.
	week('git-repo--mine', { commits: 0, authors: [ME] });
	return { root, data };
}
const run = (data, root, extra = []) =>
	execFileSync('node', [BIN, '--retrospective', REF, '--data-root', data, '--scratch-root', path.join(root, 'scratch'), ...extra], { encoding: 'utf8' });
const week = (data, id) => readRecord(recordPath('activity-weeks', `${id}/2026-W10`, 'activity-week', data)).fields;

test('a week is composed from the activities of ITS OWN source, not everything in the date range', () => {
	const { root, data } = fixture();
	run(data, root);
	assert.equal(week(data, 'gmail--work').summary, 'Argued the contract');
	assert.equal(week(data, 'gmail--home').summary, 'Booked the holiday', 'the other mailbox’s activity must not leak in');
});

test('a week of somebody else’s commits is left blank, and the receipt says so', () => {
	const { root, data } = fixture();
	const out = run(data, root);
	assert.equal(week(data, 'git-repo--theirs').summary, undefined, 'narrating another author’s week would be a false sentence');
	assert.match(out, /1 week\(s\) counted for a source the CONTRIBUTOR did not work in/);
	assert.match(out, /quiet week, no overlapping activity 1/, 'his own quiet week is a different fact, and is counted separately');
});

test('a written summary outranks a composed one, and --force is how you say otherwise', () => {
	const { root, data } = fixture();
	const file = recordPath('activity-weeks', 'gmail--work/2026-W10', 'activity-week', data);
	const held = readRecord(file);
	writeRecord(file, { ...held.fields, summary: 'The week the deal nearly died.' }, held.body);
	run(data, root);
	assert.equal(week(data, 'gmail--work').summary, 'The week the deal nearly died.');
	run(data, root, ['--force']);
	assert.equal(week(data, 'gmail--work').summary, 'Argued the contract');
});

test('several activities are joined in date order and capped, saying how many it left out', () => {
	const { root, data } = fixture();
	for (const [n, day] of [['One', '2026-03-06'], ['Two', '2026-03-07'], ['Three', '2026-03-08']]) {
		writeRecord(recordPath('world/activities', `${SLUG}/${day}--${n.toLowerCase()}`, 'activity', data), {
			retrospective: REF, name: n, started: day, ended: day, threads: ['perspective/threads/gmail--work/t1'],
		});
	}
	run(data, root, ['--max-names', '2']);
	assert.equal(week(data, 'gmail--work').summary, 'Argued the contract · One · +2 more');
});

test('re-running writes nothing — the composition is stable', () => {
	const { root, data } = fixture();
	run(data, root);
	assert.match(run(data, root), /composed 0 · kept 2/);
});

test('a PROXY drive read still places its deliverables — the source is the login, not the person', () => {
	// One contributor's Drive read through a colleague's account: the source is
	// `drive--<the colleague>` and every file's `last_touched_by` is the contributor. Matching on the
	// account alone found nothing and composed silence for all 28 of that run's weeks.
	const { root, data } = fixture();
	writeRecord(recordPath('sources', `${SLUG}/drive--reader-acme-example`, 'source', data), { retrospective: REF, contributor: SLUG, kind: 'drive', label: 'drive as reader@acme.example', reach: 'available' });
	writeRecord(recordPath('deliverables', `${SLUG}/2026-03-04--the-spec`, 'deliverable', data), {
		retrospective: REF, name: 'The spec', kind: 'doc', source_kind: 'drive',
		last_touched_on: '2026-03-04', last_touched_by: 'someone.else@acme.example',
	});
	writeRecord(recordPath('world/activities', `${SLUG}/2026-03-04--wrote-the-spec`, 'activity', data), {
		retrospective: REF, name: 'Wrote the spec', started: '2026-03-04', ended: '2026-03-04',
		deliverables: [`perspective/world/deliverables/${SLUG}/2026-03-04--the-spec`],
	});
	writeRecord(recordPath('activity-weeks', 'drive--reader-acme-example/2026-W10', 'activity-week', data),
		{ source: SRC('drive--reader-acme-example'), period: '2026-W10', start_date: '2026-03-02', end_date: '2026-03-08' });
	run(data, root);
	assert.equal(week(data, 'drive--reader-acme-example').summary, 'Wrote the spec');
});

test('a week older than the run itself is its own fact, not a quiet week', () => {
	// read-git indexes a repo's whole history while a retrospective covers a period. 376 of one
	// workspace's 434 blank weeks simply predated the run, and calling them quiet made a legitimate
	// boundary read as a hole in the model. ⚠ The fixture writes `period_start` as a DATE, because
	// that is what an unquoted YAML date deserialises to — a string-only guard read it as absent and
	// disabled this whole branch without a word.
	const { root, data } = fixture();
	writeRecord(recordPath('activity-weeks', 'git-repo--mine/2019-W10', 'activity-week', data),
		{ source: SRC('git-repo--mine'), period: '2019-W10', start_date: '2019-03-04', end_date: '2019-03-10', commits: 9, authors: [ME] });
	const out = run(data, root);
	assert.match(out, /1 week\(s\) older than the run's own period/);
	assert.match(out, /quiet week, no overlapping activity 1/, 'and the in-period quiet week is still counted as one');
});
