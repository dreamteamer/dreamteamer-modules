// Merge mode: a judging model may write JUDGED fields and nothing else. A payload carrying a counted
// field is rejected whole, so a judgement can never corrupt a number it did not compute.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRecord, readRecord, recordPath } from '../../skills/running-retrospectives/lib/records.mjs';
import { VAULT } from '../../skills/running-retrospectives/lib/vault.mjs';

// Three assertions below read the COMPILED descriptor (the script validates judged values against
// `.dreamteamer/collections/perspective/conversations.collection.yaml`). Standalone — this module
// checked out on its own, no workspace above it — there is nothing compiled to read, so those three
// are skipped by name rather than failing on an environment fact. From a consuming workspace they run.
const NO_DESCRIPTOR = fs.existsSync(path.join(VAULT, '.dreamteamer', 'collections', 'perspective', 'conversations.collection.yaml')) ? false : 'needs a compiled workspace above the module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'record-judgement.mjs');
const ID = 'claude-code/2026/09/22222222-2222-4222-8222-222222222222';

/** The minimum body the gate accepts — a title line and the exportable recap. */
const OK_BODY = '# A fixture session\n\n## recap (no PII)\n\nThe operator asked for a thing and got it.\n';
function bodyFile(data, text = OK_BODY) { const f = path.join(data, `b-${Math.abs(text.length)}.md`); fs.writeFileSync(f, text); return f; }
/** Judge with a compliant write-up — the default, because every real judgement carries one. */
const run = (id, payload, data) => spawnSync('node', [BIN, id, '--data-root', data, '--json', JSON.stringify(payload), '--body-file', bodyFile(data)], { encoding: 'utf8' });
/** Judge with NO write-up — only for the tests that are about that refusal. */
const runBare = (id, payload, data) => spawnSync('node', [BIN, id, '--data-root', data, '--json', JSON.stringify(payload)], { encoding: 'utf8' });

function seed() {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-data-'));
	writeRecord(recordPath('conversations', ID, 'conversation', data), { session_id: '2222', harness: 'claude-code', title: 't', transcript_path: '${userHome}/x.jsonl', depth: 'minimal', inspected_at: '2026-09-07T00:00:00Z', inspector_version: 'metrics/1', started_at: '2026-09-02T09:01:00Z', turns_user: 7 });
	return data;
}

test('judged fields land, depth flips to summarized, body from --body-file', () => {
	const data = seed();
	const body = path.join(data, 'body.md'); fs.writeFileSync(body, '# A fixture session\n\n## recap (no PII)\n\nThe write-up.\n');
	execFileSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({ summary: 'S', outcome: 'completed', interest_score: 41, interest_reason: 'r', goals: ['g'] }), '--body-file', body]);
	const { fields, body: b } = readRecord(recordPath('conversations', ID, 'conversation', data));
	assert.equal(fields.summary, 'S'); assert.equal(fields.depth, 'summarized'); assert.equal(fields.turns_user, 7); assert.match(b, /The write-up\./);
});

test('a payload carrying a mechanical field is rejected whole', () => {
	const data = seed();
	const r = runBare(ID, { summary: 'S', turns_user: 99 }, data);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /turns_user/);
	assert.equal(readRecord(recordPath('conversations', ID, 'conversation', data)).fields.turns_user, 7);
	assert.equal(readRecord(recordPath('conversations', ID, 'conversation', data)).fields.summary, undefined);
});

// Regression, found 2026-09-07 by a peer session reading `npm run check` while this session's
// judging pass ran: the whitelist asked "is this key judged?" and never "is this value legal?", so
// eight workers wrote a PROSE SENTENCE into `outcome` — a closed six-value enum — across 57 records
// and every write was accepted. A gate that lets the bad write land and leaves a later pass to
// notice is not a gate. Values are validated against the compiled descriptor now.
test('a prose sentence in a closed enum is rejected whole, and names the legal values', { skip: NO_DESCRIPTOR }, () => {
	const data = seed();
	const before = readRecord(recordPath('conversations', ID, 'conversation', data)).fields;
	const r = spawnSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({
		summary: 'a legitimate summary',
		outcome: 'Converged a design doc merging two pipeline phases and opened a PR.',
	})], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /outcome/);
	assert.match(r.stderr, /completed, partial, abandoned, exploratory, failed, unknown/);
	assert.match(r.stderr, /looks like prose/);
	const after = readRecord(recordPath('conversations', ID, 'conversation', data)).fields;
	assert.equal(after.summary, before.summary, 'a rejected payload writes NOTHING, not even its legal fields');
	assert.equal(after.outcome, undefined);
});

test('an out-of-range score and a wrong-typed field are both caught', { skip: NO_DESCRIPTOR }, () => {
	const data = seed();
	const r = spawnSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({ interest_score: 250, goals: 'should be an array' })], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /interest_score/);
	assert.match(r.stderr, /goals/);
});

test('a legal enum value still lands', () => {
	const data = seed();
	execFileSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({ outcome: 'partial', interest_score: 40 }), '--body-file', bodyFile(data)]);
	const { fields } = readRecord(recordPath('conversations', ID, 'conversation', data));
	assert.equal(fields.outcome, 'partial');
	assert.equal(fields.interest_score, 40);
});

// The four-layer metrics fields the descriptor declares JUDGED. Each sat unwritable — the whitelist
// omitted them — so every judging pass silently dropped them and the columns stayed empty.
test('the four-layer judged fields are writable, and their values are still checked', { skip: NO_DESCRIPTOR }, () => {
	const data = seed(), id = ID;
	const ok = run(id, { turns_added_information: 6, turns_corrected: 2, deliverable_kind: 'design-doc', quality_score: 78 }, data);
	assert.equal(ok.status, 0, ok.stderr);
	const f = readRecord(recordPath('conversations', id, 'conversation', data)).fields;
	assert.equal(f.turns_added_information, 6);
	assert.equal(f.turns_corrected, 2);
	assert.equal(f.deliverable_kind, 'design-doc');
	assert.equal(f.quality_score, 78);

	const bad = run(id, { quality_score: 140 }, data);
	assert.equal(bad.status, 2, 'above the descriptor maximum');
	assert.match(bad.stderr, /above the maximum 100/);
	assert.equal(readRecord(recordPath('conversations', id, 'conversation', data)).fields.quality_score, 78, 'and nothing was written');
});

// The two the descriptor calls judged but this script must still refuse, because neither has an
// honest source in a digest.
test('a measurement that nobody took, and a number the transcript cannot carry, are both refused', () => {
	const data = seed(), id = ID;
	for (const key of ['oneshot_prompt_words', 'skill_tokens_active']) {
		const r = run(id, { [key]: 120 }, data);
		assert.equal(r.status, 2, key);
		assert.match(r.stderr, /not judged fields/);
	}
});

// This write flips depth to summarized, and the vault's guard fails a summarized record whose body
// lacks either required heading. So a judgement with no body leaves a record that breaks
// `npm run check` — measured once in a 785-record pass, caught only afterwards by the guard.
test('a judgement with no exportable write-up is refused, and nothing is written', () => {
	const data = seed();
	const r = runBare(ID, { summary: 'S', outcome: 'completed' }, data);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /must open with `# <title>`/);
	assert.match(r.stderr, /must carry a `## recap \(no PII\)` section/);
	const f = readRecord(recordPath('conversations', ID, 'conversation', data)).fields;
	assert.equal(f.depth, 'minimal', 'depth did NOT flip');
	assert.equal(f.summary, undefined);
});

test('a write-up with a title but no recap is refused — the recap is the exportable half', () => {
	const data = seed();
	const body = path.join(data, 'b.md');
	fs.writeFileSync(body, '# A fixture session\n\nSome notes about what happened.\n');
	const r = spawnSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({ summary: 'S' }), '--body-file', body], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /recap \(no PII\)/);
	assert.doesNotMatch(r.stderr, /must open with/);
});

test('a complete write-up lands, and the record then satisfies both headings', () => {
	const data = seed();
	const body = path.join(data, 'b.md');
	fs.writeFileSync(body, '# A fixture session\n\n## recap (no PII)\n\nThe operator asked for a parser and got one.\n\n## detail\n\nIt was in a client repo.\n');
	const r = spawnSync('node', [BIN, ID, '--data-root', data, '--json', JSON.stringify({ summary: 'S', outcome: 'completed' }), '--body-file', body], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	const { fields, body: b } = readRecord(recordPath('conversations', ID, 'conversation', data));
	assert.equal(fields.depth, 'summarized');
	assert.match(b, /^# A fixture session/);
	assert.match(b, /^## recap \(no PII\)$/m);
});
