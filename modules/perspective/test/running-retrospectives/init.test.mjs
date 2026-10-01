// init against a synthetic workspace: one collection, one collection the module must NOT describe
// (its own), one skill, one command, one agent-decision-log record, one routine, and a DECISION-LOG
// carrying every row shape the parser has to survive — dated on one line, dated with the bold heading
// WRAPPED across lines, dated with the reasoning running on past the heading's line, undated on one
// line, undated and wrapped, and a numbered row that is no decision row at all. The second run is the
// real assertion — nothing is rewritten.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readRecord, listRecords } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'init.mjs');
const RETROSPECTIVE = 'perspective/retrospective-sessions/2026-09-07--fx';
const BASE = '2026-09-07--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run

function write(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

/** A workspace that looks like a compiled vault, small enough to count by hand. */
function fixture() {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-init-'));
	write(path.join(ws, '.dreamteamer', 'collections', 'x.collection.yaml'), 'name: x\ndescription: The x collection — one thing.\n');
	// the module never describes ITSELF as the person's vocabulary
	write(path.join(ws, '.dreamteamer', 'collections', 'perspective', 'concepts.collection.yaml'), 'name: perspective/concepts\ndescription: A term a contributor uses.\n');
	write(path.join(ws, '.dreamteamer', 'skills', 's', 'SKILL.md'), '---\nname: s\ndescription: Use when s.\n---\n\n# s\n');
	write(path.join(ws, '.dreamteamer', 'commands', 'c.command.md'), '---\nname: c\ndescription: do the c thing\n---\nrun c\n');
	write(
		path.join(ws, 'data', 'agent-decision-log', 'one.agent-decision.md'),
		"---\nname: one fork taken\ndecided: '2026-08-16T04:28:04+02:00'\ndecision: went left\nrationale: right was longer\n---\n",
	);
	write(path.join(ws, 'data', 'routines', 'r.routine.md'), '---\nname: renew the thing\nrecurrence: RRULE:FREQ=YEARLY\nnotes: pay the fee\n---\nbody\n');
	write(
		path.join(ws, 'data', 'perspective', 'retrospective-sessions', `${BASE}.retrospective-session.md`),
		"---\ncontributor: fx\nhandles: [dana.o@northwind.example]\nstarted: '2026-09-07'\nstage: installed\n---\n",
	);
	write(
		path.join(ws, 'DECISION-LOG.md'),
		[
			'# decisions',
			'',
			'One row per decision, newest last. This paragraph is not a row.',
			'',
			'1. **Experimental RAD** — no dates on the early rows, so this one is skipped.',
			'2. **2026-08-16 — the first dated decision.** Because the evidence said so, at length.',
			'3. **2026-08-17 — the second dated decision.** And its reasoning.',
			'4. **2026-08-18 — a heading too long to fit on one line, so the bold',
			'   runs on.** And the reasoning after the wrapped heading.',
			'5. **2026-08-19 — the heading fits.** But the reasoning does not, so it',
			'   carries on to a second line',
			'   and a third.',
			'6. **an undated row whose heading also wraps across',
			'   two lines.** Still skipped, because there is no date.',
			'7. a numbered row with no bold header — not a decision row, and not an undated one.',
			'',
		].join('\n'),
	);
	return ws;
}

const run = (ws, extra = []) =>
	execFileSync('node', [BIN, '--retrospective', RETROSPECTIVE, '--workspace-root', ws, '--data-root', path.join(ws, 'data'), '--no-link', ...extra], { encoding: 'utf8' });

/** The folder a collection this module SHIPS keeps its records in, read off the shipped descriptor —
 *  independently of the scripts' own helper, so the two cannot agree on a wrong path together. */
const SHIPPED = path.join(HERE, '..', '..', 'collections', 'perspective');
const shippedDir = (ws, collection) =>
	path.join(ws, yaml.load(fs.readFileSync(path.join(SHIPPED, `${collection}.collection.yaml`), 'utf8')).storage.path);
const recordsIn = (ws, collection) => listRecords(shippedDir(ws, collection)).map((f) => readRecord(f));

test('seeds concepts, decisions and the perspective skeleton from what the workspace already knows', () => {
	const ws = fixture();
	const out = run(ws);
	assert.match(out, /^✔ init · concepts \+3 \(=0 existing\) · decisions \+5 \(=0 existing, 2 skipped-undated\) · perspective written/, `receipt was: ${out}`);

	const concepts = recordsIn(ws, 'concepts');
	assert.equal(concepts.length, 3, 'one collection + one skill + one command');
	const refs = concepts.map((r) => r.fields.source_ref).sort();
	assert.deepEqual(refs, ['collections/x', 'commands/c', 'skills/s']);
	assert.equal(concepts.some((r) => String(r.fields.source_ref).includes('perspective/')), false, 'the module does not describe itself');
	const x = concepts.find((r) => r.fields.source_ref === 'collections/x');
	assert.equal(x.fields.origin, 'workspace');
	assert.equal(x.fields.definition, 'The x collection — one thing.');
	assert.equal(x.fields.evidence_count, 0);
	assert.equal(x.fields.retrospective, RETROSPECTIVE);
	assert.match(x.body, /The x collection/);

	const decisions = recordsIn(ws, 'decisions');
	assert.equal(decisions.length, 5, 'four dated rows + one agent-decision-log record');
	const dRefs = decisions.map((r) => r.fields.source_ref).sort();
	assert.deepEqual(dRefs, ['DECISION-LOG.md#2', 'DECISION-LOG.md#3', 'DECISION-LOG.md#4', 'DECISION-LOG.md#5', 'agent-decision-log/one']);
	for (const d of decisions) assert.equal(d.fields.source_kind, 'decision-log');
	const fromLog = decisions.find((r) => r.fields.source_ref === 'DECISION-LOG.md#2');
	assert.equal(fromLog.fields.name, 'the first dated decision.');
	assert.equal(fromLog.fields.decided_on, '2026-08-16');
	assert.match(fromLog.fields.decision, /Because the evidence said so/);
	// a row whose bold heading wraps is dated, and the row number is the marker's — not a line offset
	const wrapped = decisions.find((r) => r.fields.source_ref === 'DECISION-LOG.md#4');
	assert.ok(wrapped, 'a wrapped bold heading is read as the dated row it is, never as skipped-undated');
	assert.equal(wrapped.fields.decided_on, '2026-08-18');
	assert.equal(wrapped.fields.name, 'a heading too long to fit on one line, so the bold runs on.');
	assert.equal(wrapped.fields.decision, 'And the reasoning after the wrapped heading.');
	assert.match(wrapped.body, /runs on\.\*\* And the reasoning/, 'the body keeps the row as written');

	// continuation prose travels with its row instead of being cut at the first line break
	const runOn = decisions.find((r) => r.fields.source_ref === 'DECISION-LOG.md#5');
	assert.equal(runOn.fields.name, 'the heading fits.');
	assert.equal(runOn.fields.decision, 'But the reasoning does not, so it carries on to a second line and a third.');

	// what is genuinely undated is still skipped, wrapped or not, and a row with no bold header is
	// not a decision row at all — neither one lands here
	assert.equal(decisions.some((r) => /DECISION-LOG\.md#(1|6|7)$/.test(String(r.fields.source_ref))), false);

	const fromRecord = decisions.find((r) => r.fields.source_ref === 'agent-decision-log/one');
	assert.equal(fromRecord.fields.decided_on, '2026-08-16', 'the date part of a datetime');
	assert.equal(fromRecord.fields.rationale, 'right was longer');

	const perspectives = recordsIn(ws, 'perspectives');
	assert.equal(perspectives.length, 1);
	const p = perspectives[0].fields;
	assert.equal(p.retrospective, RETROSPECTIVE);
	assert.equal(p.contributor, SLUG, 'copied from the retrospective — the slug, not the address, which is `contact`');
	assert.deepEqual(p.commands, [{ name: 'c', description: 'do the c thing' }]);
	assert.deepEqual(p.skills, [{ name: 's', description: 'Use when s.' }]);
	assert.deepEqual(p.routines, [{ name: 'renew the thing', description: 'pay the fee', recurrence: 'RRULE:FREQ=YEARLY' }]);
	assert.equal('uses' in (p.commands[0] ?? {}), false, 'uses is a later stage’s count');
	fs.rmSync(ws, { recursive: true, force: true });
});

test('every record init writes sits in the folder of a collection this module ships', () => {
	const ws = fixture();
	run(ws);
	const owned = fs.readdirSync(SHIPPED).filter((f) => f.endsWith('.collection.yaml'))
		.map((f) => shippedDir(ws, f.replace('.collection.yaml', '')));
	const written = listRecords(path.join(ws, 'data', 'perspective'));
	assert.ok(written.length >= 7, `init wrote only ${written.length} records`);
	const orphans = written.filter((f) => !owned.some((d) => f.startsWith(d + path.sep)));
	assert.deepEqual(orphans.map((f) => path.relative(ws, f)), [], 'a record outside every collection folder is invisible to `dt check`');
	assert.equal(recordsIn(ws, 'decisions').length, 5, 'the decisions land where perspective/decisions keeps them');
	fs.rmSync(ws, { recursive: true, force: true });
});

test('a second run writes nothing and reports what is already there', () => {
	const ws = fixture();
	run(ws);
	// a later stage edits one seeded record; the re-run must not undo it
	const edited = path.join(shippedDir(ws, 'concepts'), SLUG, 'x.concept.md');
	const before = fs.readFileSync(edited, 'utf8').replace('evidence_count: 0', 'evidence_count: 7');
	fs.writeFileSync(edited, before);

	const out = run(ws);
	assert.match(out, /^✔ init · concepts \+0 \(=3 existing\) · decisions \+0 \(=5 existing, 2 skipped-undated\) · perspective merged/, `receipt was: ${out}`);
	assert.equal(recordsIn(ws, 'concepts').length, 3);
	assert.equal(recordsIn(ws, 'decisions').length, 5);
	assert.equal(readRecord(edited).fields.evidence_count, 7, 'a later stage’s edit survives a re-run');
	fs.rmSync(ws, { recursive: true, force: true });
});

test('a merge replaces the three inline arrays and keeps everything else', () => {
	const ws = fixture();
	run(ws);
	const file = path.join(shippedDir(ws, 'perspectives'), `${SLUG}.perspective.md`);
	const text = fs.readFileSync(file, 'utf8');
	fs.writeFileSync(file, text.replace('---\n', '---\nrole: the one who ships\n') + '\nthe written perspective\n');
	// a new command appears in the workspace between runs
	write(path.join(ws, '.dreamteamer', 'commands', 'c2.command.md'), '---\nname: c2\ndescription: the second thing\n---\n');

	const out = run(ws);
	assert.match(out, /perspective merged/, `receipt was: ${out}`);
	const p = readRecord(file);
	assert.equal(p.fields.role, 'the one who ships', 'every other field survives');
	assert.match(p.body, /the written perspective/, 'the body survives');
	assert.equal(p.fields.commands.length, 2, 'the arrays are replaced from the workspace');
	fs.rmSync(ws, { recursive: true, force: true });
});

test('--dry-run writes nothing', () => {
	const ws = fixture();
	const out = run(ws, ['--dry-run']);
	assert.match(out, /concepts \+3 .* · DRY RUN$/m, `receipt was: ${out}`);
	assert.equal(fs.existsSync(shippedDir(ws, 'concepts')), false);
	fs.rmSync(ws, { recursive: true, force: true });
});
