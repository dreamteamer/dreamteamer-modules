// IDEMPOTENCY, AS A GATE RATHER THAN A CLAIM.
//
// SKILL.md asserted it in four places and no test proved it. Two shipped defects came out of that
// gap during this release, both of them re-runs quietly changing data:
//   · read-claude-transcripts looked for a week's judged summary at the PRE-RENAME path, so every
//     re-read silently dropped it. Data loss, on the field the judging pass exists to produce.
//   · infer-goals --attach called every re-run a change because YAML parses an unquoted date into a
//     Date; the bytes never moved, so only the receipt was lying — which is the same class of defect
//     as a green test that proves nothing.
//
// The rule: running any stage twice writes the same records, changes no id, and leaves the record
// tree byte-identical apart from tests/helpers/tree-hash.mjs's short allowlist. A stage that cannot
// pass this is not resumable, and resumability is the whole design of the session record.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// ⚠ INSIDE the module, not at the repo root: this package's modules must each compile and TEST
// standalone in a consumer's workspace, where a repo-root tests/ directory does not exist.
import { treeHash, treeDiff } from './helpers/tree-hash.mjs';
import { fixtureWorkspace, REF, SLUG, BASE } from './helpers/fixture.mjs';
import { readRecord, writeRecord, recordPath } from '../../skills/running-retrospectives/lib/records.mjs';

const BIN = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin');

/**
 * Every mechanical stage that writes records, with the flags it needs to stay off the network and
 * any stage it must be preceded by. ⚠ A `before` is not scaffolding: it is the stage ORDER the skill
 * documents, and a stage run out of order refuses rather than guessing, which is the behaviour the
 * first draft of this gate mistook for a defect.
 */
const STAGES = [
	['inventoried', 'inventory.mjs', (f) => ['--home', f.home, '--repos-root', f.repos, '--no-register']],
	['read (git)', 'read-git.mjs', () => ['--since', '2026-01-01']],
	['clustered', 'attach-evidence.mjs', () => [], ['read-git.mjs --since 2026-01-01', 'cluster-activities.mjs'], nameEveryCandidate],
	['clustered (tasks)', 'derive-tasks.mjs', () => []],
	['projected', 'derive-decision-projects.mjs', () => [], [], unassignTheDecision],
	['inferred', 'infer-goals.mjs', () => ['--attach'], ['infer-goals.mjs'], addAnUnattachedGoal],
	['found (collaborators)', 'derive-collaborators.mjs', () => [], ['read-git.mjs --since 2026-01-01']],
	['weeks', 'compose-week-summaries.mjs', () => [], ['read-git.mjs --since 2026-01-01', 'cluster-activities.mjs'], nameEveryCandidate],
	['metrics', 'rollup-metrics.mjs', () => [], ['read-git.mjs --since 2026-01-01']],
	['synthesised', 'synthesize-perspective.mjs', () => []],
];

// ── the work each stage needs to have something to do ─────────────────────────────────────────
// The vacuity guard below refuses a stage that writes nothing, so a stage whose input a person or a
// model normally supplies gets that input here — never a weaker assertion.

/**
 * The clustering pass NAMES each candidate; everything downstream keys off `from_candidate`.
 * `attach-evidence` copies the candidate's sessions and commits onto the record, and
 * `compose-week-summaries` learns the activity's repo — and so its week — the same way.
 */
function nameEveryCandidate(f) {
	const jsonl = path.join(f.scratch, 'activity-candidates', `${BASE}.jsonl`);
	const keys = fs.readFileSync(jsonl, 'utf8').trim().split('\n').map((l) => JSON.parse(l).key);
	assert.ok(keys.length, 'the clustering pass produced no candidates — the fixture has no evidence to cluster');
	const names = ['rewrote-the-auth-flow', 'split-the-token-store', 'cut-the-retry-loop'];
	names.forEach((n, i) => {
		const file = recordPath('world/activities', `${SLUG}/2026-03-0${i + 1}--${n}`, 'activity', f.data);
		const { fields, body } = readRecord(file);
		writeRecord(file, { ...fields, from_candidate: keys[i % keys.length] }, body);
	});
}

/** The fixture's decision arrives with a project; the derive pass exists to find one that has none. */
function unassignTheDecision(f) {
	const file = recordPath('decisions', `${SLUG}/2026-03-11--stop-issuing-long-lived-tokens`, 'decision', f.data);
	const { fields, body } = readRecord(file);
	delete fields.project;
	writeRecord(file, fields, body);
}

/** `--attach` fills a goal the model has named; without one there is nothing to fill. */
function addAnUnattachedGoal(f) {
	writeRecord(recordPath('world/goals', `${SLUG}/sessions-expire-without-a-support-ticket`, 'goal', f.data), {
		retrospective: REF, contributor: SLUG,
		name: 'sessions expire without a support ticket',
		done_when: 'a token cannot outlive the session that issued it',
		evidence_count: 0, standing: 'inferred', from_candidate: 'northwind-api',
	});
}

for (const [stage, script, extra, prereqs = [], prepare] of STAGES) {
	test(`${stage} — ${script} writes the same tree twice`, () => {
		const f = fixtureWorkspace();
		const invoke = (s, args = []) => spawnSync(process.execPath,
			[path.join(BIN, s), '--retrospective', REF, '--data-root', f.data, '--scratch-root', f.scratch, ...args],
			{ cwd: f.ws, encoding: 'utf8' });
		for (const pre of prereqs) {
			const [bin, ...args] = pre.split(' ');
			const r = invoke(bin, args);
			assert.equal(r.status, 0, `${pre} (a prerequisite of ${script}) failed:\n${r.stderr}`);
		}
		prepare?.(f);
		const run = () => invoke(script, extra(f));

		// ⚠ THE VACUITY GUARD. A stage given the wrong flags, or an empty fixture, writes nothing and
		// then trivially "writes the same tree twice". This gate is worthless without proving the
		// first run did something, so the fixture must give every stage work to do.
		const untouched = treeHash(f.data);

		const first = run();
		assert.equal(first.status, 0, `${script} failed on its FIRST run:\n${first.stderr}`);
		assert.notEqual(treeHash(f.data), untouched,
			`${script} wrote NOTHING, so running it twice proves nothing — give the fixture work this stage can do`);
		const snapshot = path.join(f.ws, 'snapshot');
		fs.cpSync(f.data, snapshot, { recursive: true });
		const before = treeHash(f.data);

		const second = run();
		assert.equal(second.status, 0, `${script} failed on its SECOND run:\n${second.stderr}`);
		const after = treeHash(f.data);

		assert.equal(after, before,
			`${script} is not idempotent — a re-run changed:\n  ${treeDiff(snapshot, f.data).join('\n  ')}`);
	});
}

test('the allowlist is short, and every entry is justified in the helper', async () => {
	const { ALLOW } = await import('./helpers/tree-hash.mjs');
	assert.ok(ALLOW.length <= 4, `the allowlist has grown to ${ALLOW.length} — each entry is a field a re-run may rewrite, so a long list means the gate has stopped asserting much`);
});
