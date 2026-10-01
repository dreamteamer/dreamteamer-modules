// The guard's promise: a finding may never outrun its evidence, a proposal may never rest on one the
// person refuted, and no record may carry a machine path. The fixture is built here with the module's
// own writeRecord — so the trap each record represents is visible beside the assertion protecting it.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord } from '../skills/running-retrospectives/lib/records.mjs';

/** This module's own root — `modules/perspective`. */
const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'bin', 'check-records.mjs');
const SESSION = '2026-09-07--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run

function tmpDataRoot() {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-check-')), 'data');
}

function run(dataRoot) {
	return spawnSync(process.execPath, [SCRIPT, '--data-root', dataRoot], { encoding: 'utf8' });
}

/** The records every fixture needs: one readable summary, one ANSWERED interview question, and the
 *  two legal findings. (Until 2026-09-08 the answer was its own record; it is a field on the
 *  question now, and the guard's "the person has spoken" test moved with it.) */
function seedClean(root) {
	writeRecord(recordPath('conversations', 'claude-code/2026/09/fixture-a', 'conversation', root), {
		session_id: 'fixture-a',
		harness: 'claude-code',
		title: 'A fixture session',
		transcript_path: '${userHome}/.claude/projects/-work-acme/fixture-a.jsonl',
		depth: 'minimal',
		inspected_at: '2026-09-07T10:00:00.000Z',
		inspector_version: 'metrics/1',
		started_at: '2026-09-01T10:00:00.000Z',
		turns_user: 12,
	});
	writeRecord(recordPath('questions', `${SESSION}/001`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`,
		n: 1,
		text: 'Do you still run the weekly sweep by hand?',
		bank: 'gap',
		status: 'answered',
		answer: 'No, I stopped doing that in June.',
		answered_on: '2026-09-07',
		answer_origin: 'spoken',
	});
	// The same question UNANSWERED — a finding citing this one must NOT be allowed to claim the
	// person confirmed anything. Somebody thinking of a question is not the person speaking.
	writeRecord(recordPath('questions', `${SESSION}/002`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`,
		n: 2,
		text: 'Which of these would you drop first?',
		bank: 'gap',
		status: 'pending',
	});
	writeRecord(
		recordPath('findings', `${SLUG}/workflow--weekly-sweep`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'A sweep of the open work runs at the end of the week',
			kind: 'workflow',
			evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
			evidence_count: 3,
			standing: 'pattern',
		},
		'The sweep runs on Fridays and reopens nothing. (3 sessions)',
	);
	// Legal `refuted`: an ANSWERED interview question is among the evidence, so the count rule steps aside.
	writeRecord(
		recordPath('findings', `${SLUG}/workflow--refuted-claim`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'The morning triage is still a habit',
			kind: 'workflow',
			evidence: [
				'perspective/conversations/claude-code/2026/09/fixture-a',
				`perspective/questions/${SESSION}/001`,
			],
			evidence_count: 3,
			standing: 'refuted',
		},
		'Denied in the interview. (3 sessions)',
	);
	writeRecord(recordPath('proposals', `${SESSION}/collection--sweeps`, 'proposal', root), {
		session: `perspective/retrospective-sessions/${SESSION}`,
		name: 'sweeps',
		kind: 'collection',
		justified_by: [`perspective/findings/${SLUG}/workflow--weekly-sweep`],
		basis: 'evidence-only',
		status: 'proposed',
	});
	return root;
}

test('an empty data root is checked and clean', () => {
	const root = tmpDataRoot();
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /✔ perspective records: 0 checked, 0 violations/);
});

test('a clean fixture passes and reports what it checked', () => {
	const root = seedClean(tmpDataRoot());
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /✔ perspective records: 6 checked, 0 violations/);
});

// Every name the guard calls evidence must be a collection this package ships (or the `meetings` peer).
test('every collection the guard calls evidence is one this package actually ships', () => {
	const src = fs.readFileSync(path.join(MODULE, 'bin', 'check-records.mjs'), 'utf8');
	const m = /const EVIDENCE_COLLECTIONS = \[([^\]]*)\]/.exec(src);
	assert.ok(m, 'EVIDENCE_COLLECTIONS is not where this test expects it');
	const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
	assert.ok(names.length >= 8, `only ${names.length} parsed — the regex has stopped matching the real list`);

	const COLS = path.join(MODULE, 'collections', 'perspective');
	// `meetings` is the one PEER: a domain object the consumer owns, which this module may reference
	// and must never ship. Everything else has to be ours.
	const PEERS = new Set(['meetings']);
	const missing = names.filter((n) => !PEERS.has(n) && !fs.existsSync(path.join(COLS, `${n}.collection.yaml`)));
	assert.deepEqual(missing, [], `the guard calls these evidence and this package ships no such collection — a rename that was not swept:\n  ${missing.join('\n  ')}`);
});

// The guard's vocabulary and `EVIDENCE_COLLECTIONS` are one list in two places, and they have now
// drifted twice: first on the activity-windows → activity-weeks rename, then on 2026-09-08 when
// `decisions` became legal evidence and nobody swept the tail regex. These pin the units that a
// finding may legitimately close with, so the next widening fails here instead of in a live run.
test('a finding may close its count with any unit that is legal evidence — decisions included', () => {
	const root = seedClean(tmpDataRoot());
	const units = ['3 decisions', '4 activities', '12 tickets', '22 weeks', '7 sessions', '31 commits'];
	units.forEach((unit, i) => {
		writeRecord(
			recordPath('findings', `${SLUG}/friction--unit-${i}`, 'finding', root),
			{
				session: `perspective/retrospective-sessions/${SESSION}`,
				name: `A finding counted in ${unit.split(' ')[1]}`,
				kind: 'friction',
				evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
				evidence_count: 3,
				standing: 'pattern',
			},
			`The observation, with its count. (${unit})`,
		);
	});
	const r = run(root);
	assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a full stop after the count is prose, not a violation', () => {
	const root = seedClean(tmpDataRoot());
	writeRecord(
		recordPath('findings', `${SLUG}/friction--trailing-stop`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'The count is followed by a full stop',
			kind: 'friction',
			evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
			evidence_count: 4,
			standing: 'pattern',
		},
		'A sentence that ends with its evidence count (4 activities).',
	);
	const r = run(root);
	assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a body with no count at all is still refused', () => {
	const root = seedClean(tmpDataRoot());
	writeRecord(
		recordPath('findings', `${SLUG}/friction--still-no-count`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'No count anywhere in the body',
			kind: 'friction',
			evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
			evidence_count: 4,
			standing: 'pattern',
		},
		'An observation that never says how much evidence is behind it.',
	);
	const r = run(root);
	assert.notEqual(r.status, 0, 'the widened regex must not have widened into accepting nothing');
	assert.match(r.stdout + r.stderr, /must end with its evidence count/);
});

test('every broken record is named, and no clean one is', () => {
	const root = seedClean(tmpDataRoot());

	// 1. A finding whose body does not end with its evidence count.
	writeRecord(
		recordPath('findings', `${SLUG}/friction--no-count`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'Context is rebuilt by hand every morning',
			kind: 'friction',
			evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
			evidence_count: 4,
			standing: 'pattern',
		},
		'The same three files are re-read at the start of every run.',
	);
	// 2. A pattern claimed on two sessions.
	writeRecord(
		recordPath('findings', `${SLUG}/friction--thin-pattern`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'Releases are cut late in the day',
			kind: 'friction',
			evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
			evidence_count: 2,
			standing: 'pattern',
		},
		'Two late cuts. (2 sessions)',
	);
	// 3. A finding citing evidence that does not exist.
	writeRecord(
		recordPath('findings', `${SLUG}/friction--missing-ref`, 'finding', root),
		{
			session: `perspective/retrospective-sessions/${SESSION}`,
			name: 'The build is run twice per change',
			kind: 'friction',
			evidence: ['perspective/activity-weeks/git-repo--nowhere/2026-W36'],
			evidence_count: 1,
			standing: 'anecdote',
		},
		'Seen once. (1 session)',
	);
	// 4. A proposal resting on a refuted finding.
	writeRecord(recordPath('proposals', `${SESSION}/skill--morning-triage`, 'proposal', root), {
		session: `perspective/retrospective-sessions/${SESSION}`,
		name: 'running-a-morning-triage',
		kind: 'skill',
		justified_by: [`perspective/findings/${SLUG}/workflow--refuted-claim`],
		basis: 'evidence-and-interview',
		status: 'proposed',
	});
	// 5. A summary carrying a machine path.
	writeRecord(recordPath('conversations', 'claude-code/2026/09/fixture-b', 'conversation', root), {
		session_id: 'fixture-b',
		harness: 'claude-code',
		title: 'Another fixture session',
		transcript_path: '/Users/someone/.claude/projects/-work-acme/fixture-b.jsonl',
		depth: 'minimal',
		inspected_at: '2026-09-07T10:00:00.000Z',
		inspector_version: 'metrics/1',
		started_at: '2026-09-02T10:00:00.000Z',
		turns_user: 3,
	});

	const r = run(root);
	assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}${r.stderr}`);
	for (const named of [
		'findings/fx/friction--no-count.finding.md',
		'findings/fx/friction--thin-pattern.finding.md',
		'findings/fx/friction--missing-ref.finding.md',
		'proposals/2026-09-07--fx/skill--morning-triage.proposal.md',
		'conversations/claude-code/2026/09/fixture-b.conversation.md',
	]) {
		assert.ok(r.stderr.includes(named), `stderr does not name ${named}:\n${r.stderr}`);
	}
	// Only the OFFENDING file column may name a record — a clean id may still appear inside a message
	// (the refuted finding is named by the proposal that cites it, which is the point of that message).
	const offenders = r.stderr
		.split('\n')
		.filter((line) => line.includes(': '))
		.map((line) => line.split(': ')[0]);
	for (const clean of ['workflow--weekly-sweep', 'workflow--refuted-claim', 'collection--sweeps', 'fixture-a']) {
		assert.ok(
			!offenders.some((file) => file.includes(clean)),
			`the clean record ${clean} is reported as an offender:\n${r.stderr}`,
		);
	}
});

// Regression: the collection was renamed activity-windows → activity-weeks and this guard's count
// vocabulary was not swept with it, so three findings correctly ending `(22 weeks)` were failed by
// the guard. A rename that leaves a VOCABULARY behind is exactly what compile and check cannot see.
test('a finding body may close with weeks, sessions or answers', () => {
	const root = tmpDataRoot();
	seedClean(root);
	for (const [i, tail] of [['a', '(22 weeks)'], ['b', '(3 sessions)'], ['c', '(4 answers)'], ['d', '(1 week)']]) {
		writeRecord(
			recordPath('findings', `${SLUG}/insight--tail-${i}`, 'finding', root),
			{
				session: `perspective/retrospective-sessions/${SESSION}`,
				name: `tail ${i}`,
				kind: 'insight',
				evidence: ['perspective/conversations/claude-code/2026/09/fixture-a'],
				evidence_count: 3,
				standing: 'pattern',
			},
			`An observation worth acting on. ${tail}`,
		);
	}
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
});

// ── v2, the perspective model ───────────────────────────────────────────────────────────────────
// Five more promises: an insight cites at least two findings; `collaborative` never disagrees with
// the collaborators it is derived from; a decision's provenance can be followed back; one
// perspective per retrospective, pointing at each other; and no two collaborators under one run
// share a handle. Each broken record below is one of those, and only one.

const RUN = `perspective/retrospective-sessions/${SESSION}`;
const ACTIVITY = `perspective/activities/${SLUG}/2026-09-02--the-guard-slice`;

/** The clean v2 layer, written ON TOP of seedClean — it cites that fixture's two findings and its conversation. */
function seedV2(root) {
	writeRecord(recordPath('retrospective-sessions', SESSION, 'retrospective-session', root), {
		label: 'fx',
		started: '2026-09-01',
		stage: 'proposed',
		contributor: 'fixture@example.com',
		perspective: `perspective/perspectives/${SLUG}`,
	});
	writeRecord(recordPath('perspectives', SLUG, 'perspective', root), {
		retrospective: RUN,
		contributor: 'fixture@example.com',
		role: 'keeps a guard honest',
		summary: 'The fixture contributor.',
	});
	writeRecord(recordPath('users', `${SLUG}/dana-fixture`, 'user', root), {
		retrospective: RUN,
		name: 'Dana Fixture',
		handles: ['dana@example.com', 'DanaFx'],
		evidence_count: 9,
	});
	writeRecord(recordPath('users', `${SLUG}/ravi-fixture`, 'user', root), {
		retrospective: RUN,
		name: 'Ravi Fixture',
		handles: ['ravi@example.com'],
		evidence_count: 2,
	});
	writeRecord(recordPath('tickets', 'asana--fixture/1201', 'ticket', root), {
		source: 'perspective/sources/asana--fixture',
		external_id: '1201',
		title: 'A fixture ticket',
		status: 'completed',
	});
	writeRecord(recordPath('activities', `${SLUG}/2026-09-02--the-guard-slice`, 'activity', root), {
		retrospective: RUN,
		name: 'The guard slice',
		started: '2026-09-02',
		ended: '2026-09-05',
		status: 'done',
		collaborators: [
			`perspective/users/${SLUG}/dana-fixture`,
			`perspective/users/${SLUG}/ravi-fixture`,
		],
		collaborative: true,
		sessions: ['perspective/conversations/claude-code/2026/09/fixture-a'],
		commits: ['a1b2c3d', '0f9e8d7c6b5a4938271605f4e3d2c1b0a9988776'],
		commit_count: 2,
	});
	// One decision per source_kind, each with a ref its kind actually accepts.
	for (const [kind, slug, ref] of [
		['git-commit', 'a-commit', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'],
		['agent-session', 'a-session', 'perspective/conversations/claude-code/2026/09/fixture-a'],
		['decision-log', 'a-log-row', 'DECISION-LOG.md#310'],
		['decision-log', 'a-log-record', 'agent-decision-log/2026-09-01--a-fork-taken'],
		['ticket', 'a-ticket', 'perspective/tickets/asana--fixture/1201'],
		['meeting', 'a-meeting', 'meetings/2026-09-03--fixture-weekly'],
		['interview', 'an-answer', `perspective/questions/${SESSION}/001`],
	]) {
		writeRecord(recordPath('decisions', `${SLUG}/2026-09-04--from-${slug}`, 'decision', root), {
			retrospective: RUN,
			name: `A decision extracted from ${slug}`,
			source_kind: kind,
			source_ref: ref,
			decided_on: '2026-09-04',
			decision: 'The guard checks the shape of the reference.',
		});
	}
	writeRecord(recordPath('workflows', `${SLUG}/shipping-a-guard`, 'workflow', root), {
		retrospective: RUN,
		name: 'Shipping a guard',
		steps: ['read the descriptors', 'extend the guard', 'run the suite', 'run it against the real workspace'],
		trigger: 'a design doc lands',
		activities: [ACTIVITY],
		frequency: 'per slice',
	});
	writeRecord(recordPath('insights', `${SLUG}/guards-outlive-their-vocabulary`, 'insight', root), {
		retrospective: RUN,
		name: 'Guards outlive their vocabulary',
		statement: 'Both findings turn on a rename the guard did not follow.',
		findings: [
			`perspective/findings/${SLUG}/workflow--weekly-sweep`,
			`perspective/findings/${SLUG}/workflow--refuted-claim`,
		],
		consequence: 'Sweep the vocabulary with the rename.',
	});
	return root;
}

test('a clean v2 fixture passes — insight, activity, decisions, workflow, perspective', () => {
	const root = seedV2(seedClean(tmpDataRoot()));
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /✔ perspective records: \d+ checked, 0 violations/);
});

// ⚠ THE BACK-POINTER TESTS ARE DELETED, not weakened, and this note is why.
// Two cases lived here: "the retrospective has not pointed back yet is a warning" and "two
// perspectives for one run is a violation". Both policed `retrospective-sessions.perspective`
// against `perspectives.retrospective` — two hand-maintained halves of one relation. Since
// 2026-09-09 the session's field is a GENERATED mirror (`x-inverse: perspective`, `x-unique: true`),
// so it cannot disagree with its owner and cannot lag behind it: the engine writes both in one
// operation and `dreamteamer check` reports a stale mirror after a raw file write. There is no state
// left for these tests to describe. `tests/relations.test.mjs` asserts the schema that replaced them.

test('every broken v2 record is named, one violation per rule, and no clean one is', () => {
	const root = seedV2(seedClean(tmpDataRoot()));

	// 5. An insight resting on a single finding — that is the finding, not an insight.
	writeRecord(recordPath('insights', `${SLUG}/one-finding-only`, 'insight', root), {
		retrospective: RUN,
		name: 'One finding only',
		statement: 'Drawn across nothing.',
		findings: [`perspective/findings/${SLUG}/workflow--weekly-sweep`],
	});
	// 6a. A collaborator named, but the derived flag says solo.
	writeRecord(recordPath('activities', `${SLUG}/2026-09-03--unmarked-collaboration`, 'activity', root), {
		retrospective: RUN,
		name: 'Unmarked collaboration',
		started: '2026-09-03',
		collaborators: [`perspective/users/${SLUG}/dana-fixture`],
		collaborative: false,
	});
	// 6b. A commit pointer git could never resolve.
	writeRecord(recordPath('activities', `${SLUG}/2026-09-03--bad-sha`, 'activity', root), {
		retrospective: RUN,
		name: 'Bad sha',
		started: '2026-09-03',
		commits: ['nothexatall'],
	});
	// 6c. A gantt bar that runs backwards.
	writeRecord(recordPath('activities', `${SLUG}/2026-09-05--time-travel`, 'activity', root), {
		retrospective: RUN,
		name: 'Time travel',
		started: '2026-09-05',
		ended: '2026-09-02',
	});
	// 7a. A git-commit decision whose ref is not a SHA.
	writeRecord(recordPath('decisions', `${SLUG}/2026-09-04--not-a-sha`, 'decision', root), {
		retrospective: RUN,
		name: 'A decision whose commit cannot be found',
		source_kind: 'git-commit',
		source_ref: 'HEAD~3',
		decided_on: '2026-09-04',
	});
	// 7b. Right shape, no such conversation.
	writeRecord(recordPath('decisions', `${SLUG}/2026-09-04--missing-session`, 'decision', root), {
		retrospective: RUN,
		name: 'A decision extracted from a session that is not there',
		source_kind: 'agent-session',
		source_ref: 'perspective/conversations/claude-code/2026/09/nowhere',
		decided_on: '2026-09-04',
	});
	// (8. was the two-perspectives mismatch — the generated mirror makes it unrepresentable.)
	// 9. A workflow with no steps is a claim about a sequence nobody wrote down.
	writeRecord(recordPath('workflows', `${SLUG}/no-steps`, 'workflow', root), {
		retrospective: RUN,
		name: 'No steps',
		activities: [ACTIVITY],
	});
	// 10. The unmerged duplicate: one handle, two records, one person's work split in two.
	writeRecord(recordPath('users', `${SLUG}/sam-one`, 'user', root), {
		retrospective: RUN,
		name: 'Sam One',
		handles: ['sam@example.com', 'SamOne'],
	});
	writeRecord(recordPath('users', `${SLUG}/sam-two`, 'user', root), {
		retrospective: RUN,
		name: 'Sam Two',
		handles: ['sam@example.com'],
	});

	const r = run(root);
	assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}${r.stderr}`);
	for (const named of [
		'insights/fx/one-finding-only.insight.md',
		'activities/fx/2026-09-03--unmarked-collaboration.activity.md',
		'activities/fx/2026-09-03--bad-sha.activity.md',
		'activities/fx/2026-09-05--time-travel.activity.md',
		'decisions/fx/2026-09-04--not-a-sha.decision.md',
		'decisions/fx/2026-09-04--missing-session.decision.md',
		'workflows/fx/no-steps.workflow.md',
		// BOTH duplicates, because only a person can say which record survives.
		'users/fx/sam-one.user.md',
		'users/fx/sam-two.user.md',
	]) {
		assert.ok(r.stderr.includes(named), `stderr does not name ${named}:\n${r.stderr}`);
	}
	const offenders = r.stderr
		.split('\n')
		.filter((line) => line.includes(': '))
		.map((line) => line.split(': ')[0]);
	for (const clean of [
		'guards-outlive-their-vocabulary',
		'the-guard-slice',
		'shipping-a-guard',
		'dana-fixture',
		'ravi-fixture',
		'from-a-commit',
		'from-a-session',
		'from-a-log-row',
		'from-a-log-record',
		'from-a-ticket',
		'from-a-meeting',
		'from-an-answer',
		`perspectives/${SESSION}`,
	]) {
		assert.ok(
			!offenders.some((file) => file.includes(clean)),
			`the clean record ${clean} is reported as an offender:\n${r.stderr}`,
		);
	}
});

// A `url:` location (the Asana source) is machine-independent and must pass the template rule.
test('a url: location is legal — the path rule stops resolved filesystem paths, not URLs', () => {
	const root = tmpDataRoot();
	seedClean(root);
	writeRecord(recordPath('sources', `${SLUG}/asana--acme`, 'source', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, kind: 'asana', label: 'acme', reach: 'available',
		location: 'url:https://app.asana.com/0/1234567890',
	});
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
});

// v2: a finding may rest on tickets and activities — the fresh-workspace case has no transcripts at all.
test('tickets and activities are legal evidence, and the body may count tickets', () => {
	const root = tmpDataRoot();
	seedClean(root);
	writeRecord(recordPath('tickets', 'asana--acme/111', 'ticket', root), { source: `perspective/sources/${SLUG}/asana--acme`, external_id: '111', title: 'a task' });
	writeRecord(recordPath('findings', `${SLUG}/workstream--tickets-only`, 'finding', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, name: 'work known only from tickets', kind: 'workstream',
		evidence: ['perspective/tickets/asana--acme/111'], evidence_count: 3, standing: 'pattern',
	}, 'Three tickets a week, no transcript in sight. (3 tickets)');
	const r = run(root);
	assert.equal(r.status, 0, r.stderr);
});

// The half of the rule that is easy to lose when answers fold into questions: citing a question is
// not citing an answer. A finding may not be promoted to `confirmed` because somebody once thought
// of asking.
test('an UNANSWERED question does not let a finding claim the person confirmed it', () => {
	const root = seedClean(tmpDataRoot());
	writeRecord(recordPath('findings', `${SLUG}/premature`, 'finding', root), {
		session: `perspective/retrospective-sessions/${SESSION}`,
		name: 'A claim nobody has confirmed yet',
		kind: 'workflow',
		evidence: [`perspective/questions/${SESSION}/002`],
		evidence_count: 2,
		standing: 'confirmed',
	});
	const f = recordPath('findings', `${SLUG}/premature`, 'finding', root);
	fs.writeFileSync(f, fs.readFileSync(f, 'utf8').trimEnd() + '\nIt looks like it happens. (2 sessions)\n');
	const r = run(root);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /premature\.finding\.md: standing confirmed/);
});

test('a suggested answer needs its evidence, and may never be passed off as the answer', () => {
	const root = seedClean(tmpDataRoot());
	// a bare suggestion — no records behind it
	writeRecord(recordPath('questions', `${SESSION}/010`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, n: 10, bank: 'gap',
		text: 'Do you revise specs after the first review, or before it?',
		suggested_answer: 'After — every spec line here has a v2 or a rev3.',
	});
	// the machine quoting itself in the person's field
	writeRecord(recordPath('questions', `${SESSION}/011`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, n: 11, bank: 'gap',
		text: 'Is the board where your work is tracked?',
		suggested_answer: 'No — most of it lives in documents.',
		suggestion_evidence: [`perspective/findings/${SLUG}/board-is-quiet`],
		answer: 'No — most of it lives in documents.',
		answer_origin: 'typed',
		status: 'answered',
	});
	// an answer with no provenance
	writeRecord(recordPath('questions', `${SESSION}/012`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, n: 12, bank: 'role',
		text: 'What is your title?',
		answer: 'Product.',
		status: 'answered',
	});
	// and the clean shape: suggestion with evidence, answer empty
	writeRecord(recordPath('questions', `${SESSION}/013`, 'question', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, n: 13, bank: 'gap',
		text: 'Who reviews a spec before it goes to engineering?',
		suggested_answer: 'Nobody formally — the revision history shows no reviewer hand-off.',
		suggestion_evidence: [`perspective/findings/${SLUG}/board-is-quiet`],
	});
	const r = run(root);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /010\.question\.md: suggested_answer with no suggestion_evidence/);
	assert.match(r.stderr, /011\.question\.md: answer is identical to suggested_answer/);
	assert.match(r.stderr, /012\.question\.md: answer without answer_origin/);
	assert.doesNotMatch(r.stderr, /013\.question\.md/);
});

test('a goal counts its decisions, activities and projects — nothing else, and never a different number', () => {
	const root = seedClean(tmpDataRoot());
	const goal = (id, extra) => writeRecord(recordPath('goals', `${SLUG}/${id}`, 'goal', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`,
		name: id, done_when: 'Something that would be true.', ...extra,
	}, 'Read backwards out of the work. (3 decisions)');
	// count higher than the refs — the measured defect
	goal('over', { evidence_count: 5, standing: 'corroborated',
		decisions: [`perspective/decisions/${SLUG}/a`, `perspective/decisions/${SLUG}/b`],
		activities: [`perspective/activities/${SLUG}/x`] });
	// topics counted as evidence — the descriptor says they are not
	goal('topics-in', { evidence_count: 3, standing: 'corroborated',
		decisions: [`perspective/decisions/${SLUG}/a`],
		topics: [`perspective/topics/${SLUG}/t1`, `perspective/topics/${SLUG}/t2`] });
	// corroborated on two
	goal('thin', { evidence_count: 2, standing: 'corroborated',
		decisions: [`perspective/decisions/${SLUG}/a`, `perspective/decisions/${SLUG}/b`] });
	// confirmed with nobody having spoken
	goal('spoke', { evidence_count: 3, standing: 'confirmed',
		decisions: [`perspective/decisions/${SLUG}/a`, `perspective/decisions/${SLUG}/b`, `perspective/decisions/${SLUG}/c`] });
	// and the clean one
	goal('clean', { evidence_count: 3, standing: 'corroborated',
		decisions: [`perspective/decisions/${SLUG}/a`, `perspective/decisions/${SLUG}/b`],
		projects: [`perspective/projects/${SLUG}/p`],
		topics: [`perspective/topics/${SLUG}/t1`] });
	const r = run(root);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /over\.goal\.md: evidence_count 5 but 3 distinct/);
	assert.match(r.stderr, /topics-in\.goal\.md: evidence_count 3 but 1 distinct/);
	assert.match(r.stderr, /thin\.goal\.md: standing corroborated with 2 refs/);
	assert.match(r.stderr, /spoke\.goal\.md: standing confirmed/);
	assert.doesNotMatch(r.stderr, /clean\.goal\.md/);
});

test('a thread is legal evidence and a legal unit; a decision read out of mail cites the thread record, never a URL', () => {
	const root = seedClean(tmpDataRoot());
	writeRecord(recordPath('findings', `${SLUG}/correspondence`, 'finding', root), {
		session: `perspective/retrospective-sessions/${SESSION}`, name: 'Three specs were argued over mail before any ticket', kind: 'workstream',
		evidence: [`perspective/threads/gmail--fx/T1`, `perspective/threads/gmail--fx/T2`, `perspective/threads/gmail--fx/T3`],
		evidence_count: 3, standing: 'pattern',
	}, 'Each spec has a thread older than its ticket. (3 threads)');
	for (const id of ['T1', 'T2', 'T3']) writeRecord(recordPath('threads', `gmail--fx/${id}`, 'thread', root), { source: `perspective/sources/${SLUG}/gmail--fx`, external_id: id, subject: 's', first_on: '2026-08-01' });
	writeRecord(recordPath('decisions', `${SLUG}/by-mail`, 'decision', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`, name: 'ship v2 without the export', source_kind: 'email',
		source_ref: 'perspective/threads/gmail--fx/T1', decided_on: '2026-08-02', decision: 'v2 ships without the export',
	});
	writeRecord(recordPath('decisions', `${SLUG}/by-url`, 'decision', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`, name: 'the same, cited wrong', source_kind: 'email',
		source_ref: 'https://mail.google.com/mail/u/0/#all/T1', decided_on: '2026-08-02', decision: 'v2 ships without the export',
	});
	const r = run(root);
	assert.equal(r.status, 1);
	assert.doesNotMatch(r.stderr, /correspondence\.finding\.md/);
	assert.doesNotMatch(r.stderr, /by-mail\.decision\.md/);
	assert.match(r.stderr, /by-url\.decision\.md: .*perspective\/threads/);
});

// ── the collections the guard knows ──────────────────────────────────────────────────────────────
// The guard reads its collection list and every storage folder off the shipped descriptors, so a
// collection added, moved or deleted is checked the moment its descriptor changes.
test('the guard resolves refs through the shipped descriptors, and a path no collection owns resolves to nothing', () => {
	const source = fs.readFileSync(SCRIPT, 'utf8');
	assert.doesNotMatch(source, /const SUFFIX = \{/, 'a hand-kept collection map is back');
	const root = seedClean(tmpDataRoot());
	writeRecord(recordPath('activities', `${SLUG}/2026-09-02--flat`, 'activity', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`, contributor: SLUG, name: 'flat', started: '2026-09-02', collaborative: false,
	});
	const workflow = (id, ref) => writeRecord(recordPath('workflows', `${SLUG}/${id}`, 'workflow', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`, contributor: SLUG, name: id, steps: ['one'], activities: [ref], collaborative: false,
	});
	workflow('cites-the-shipped-path', `perspective/activities/${SLUG}/2026-09-02--flat`);
	workflow('cites-the-old-path', `perspective/world/activities/${SLUG}/2026-09-02--flat`);
	const r = run(root);
	assert.equal(r.status, 1, r.stdout);
	assert.doesNotMatch(r.stderr, /cites-the-shipped-path/);
	assert.match(r.stderr, /cites-the-old-path\.workflow\.md: activities perspective\/world\/activities\/fx\/2026-09-02--flat is not perspective\/activities\/<id>/);
});

test('a goal under three pieces of evidence may not claim to be corroborated, and none may claim confirmed', () => {
	// Borrowed wholesale from findings, and for the same reason: `confirmed` means a PERSON answered,
	// and an unattended run writing it is claiming someone spoke who did not.
	const root = seedClean(tmpDataRoot());
	writeRecord(recordPath('goals', `${SLUG}/portable-workspace`, 'goal', root), {
		retrospective: `perspective/retrospective-sessions/${SESSION}`,
		name: 'the workspace runs on any machine from a bare clone',
		statement: 'A clone plus a .env is a working workspace, with no second checkout and no host alias.',
		// ⚠ The refs ARE the count. This fixture used to carry `evidence_count: 4` with nothing attached
		// and passed — exactly the defect the goals guard now refuses.
		decisions: ['a', 'b', 'c', 'd'].map((x) => `perspective/decisions/${SLUG}/${x}`),
		evidence_count: 4,
		standing: 'corroborated',
	}, 'Four decisions turn on it, and each rejected the option that needed a second checkout. (4 decisions)');
	const ok = run(root);
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

// ── location: a link is not a path ───────────────────────────────────────────────────────────────
// The rule's own comment says it "exists to stop a resolved filesystem path travelling, nothing
// else". It was narrower than that until 2026-09-08: it admitted `${…}` and `url:` but not a bare
// https link, and refused all 53 deliverables of the first contributor read out of Google Drive — an
// artefact that does not live in the vault has a web link and nothing else to give.
test('a location may be an http(s) link, a template, or url: — and may never be a machine path', () => {
	const root = seedClean(tmpDataRoot());
	const base = {
		retrospective: `perspective/retrospective-sessions/${SESSION}`,
		name: 'A spec',
		kind: 'doc',
		source_kind: 'drive',
	};
	const write = (id, location) =>
		writeRecord(recordPath('deliverables', `${SLUG}/2026-09-01--${id}`, 'deliverable', root), { ...base, location });

	write('https', 'https://docs.google.com/document/d/abc/edit');
	write('template', '${env:FILES_FOLDER}/specs/a.docx');
	write('urlscheme', 'url:https://app.asana.com/0/1/2');
	const ok = run(root);
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);

	write('machine', '/Users/someone/Documents/specs/a.docx');
	const bad = run(root);
	assert.notEqual(bad.status, 0, 'an absolute filesystem path is still refused — that is the whole rule');
	assert.match(bad.stdout + bad.stderr, /never a machine path/);
});

// ── WHERE IT LOOKS, AND WHAT IT DOES WHEN IT CANNOT FIND ANYTHING ───────────────────────────────
// ⚠ MEASURED IN A REAL CONSUMER, 2026-09-11. Run from the workspace root with the module linked for
// preview, this guard printed `✔ perspective records: 0 checked, 0 violations` and EXITED 0 over a
// workspace holding 173 of them: the default data root resolved from the SCRIPT, and under preview
// the script lives outside the workspace. A guard that reports success while checking nothing is
// byte-identical to a guard that passed, which makes it the worst failure this repo can ship.
describe('the data root', () => {
	const tmpdir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

	test('REFUSES, non-zero, when there is no workspace above the current directory', () => {
		const nowhere = tmpdir('cr-nowhere-');
		const r = spawnSync(process.execPath, [SCRIPT], { cwd: nowhere, encoding: 'utf8' });
		assert.notEqual(r.status, 0, 'it must not report a clean zero from a directory with no workspace');
		assert.match(r.stderr, /no workspace here/i);
		assert.match(r.stderr, /package-lock\.json/, 'the message must name what it looked for');
		assert.doesNotMatch(r.stdout, /0 checked, 0 violations/, 'the silent pass is the whole defect');
	});

	test('finds the workspace by walking UP from the current directory', () => {
		const ws = tmpdir('cr-ws-');
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		const deep = path.join(ws, 'a', 'b', 'c');
		fs.mkdirSync(deep, { recursive: true });
		seedClean(path.join(ws, 'data'));
		const r = spawnSync(process.execPath, [SCRIPT], { cwd: deep, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /perspective records: [1-9]\d* checked/, 'it must have found the records, not zero of them');
	});

	// ⚠ AND ZERO IS STILL LEGAL. A workspace that has the module and has never run a retrospective has
	// no `data/perspective` at all, and `0 checked` is the honest answer. The refusal keys on "no
	// workspace root", never on "no records" — otherwise it would refuse every fresh install.
	test('a real workspace with no records at all reports 0 checked and exits 0', () => {
		const ws = tmpdir('cr-empty-');
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		const r = spawnSync(process.execPath, [SCRIPT], { cwd: ws, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /0 checked, 0 violations/);
	});

	test('--data-root still wins over both', () => {
		const ws = tmpdir('cr-flag-');
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		const other = seedClean(tmpDataRoot());
		const r = spawnSync(process.execPath, [SCRIPT, '--data-root', other], { cwd: ws, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /perspective records: [1-9]\d* checked/);
	});

	// ⚠ THE SHAPE THE CLONE-AS-WORKSPACE RULE PROTECTS. `npm install` inside a module clone leaves a
	// lockfile there, so a walk that stops at the first one resolves the CLONE as the workspace and
	// checks a tree that is not the person's.
	test('a lockfile directly inside git_modules/ is skipped, not taken for the workspace', () => {
		const ws = tmpdir('cr-gm-');
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		seedClean(path.join(ws, 'data'));
		const clone = path.join(ws, 'git_modules', 'extensions');
		fs.mkdirSync(clone, { recursive: true });
		fs.writeFileSync(path.join(clone, 'package-lock.json'), '{}');
		const r = spawnSync(process.execPath, [SCRIPT], { cwd: clone, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /perspective records: [1-9]\d* checked/, 'it resolved the clone as the workspace and checked nothing');
	});
});
