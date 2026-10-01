#!/usr/bin/env node
// init — stage 1 of /run-retrospective: seed what the workspace ALREADY knows, so a second run finds
// it present and moves on. Concepts from the compiled vocabulary (collections · skills · commands),
// decisions from `agent-decision-log` and DECISION-LOG.md's numbered rows, and the perspective
// skeleton carrying the operational model inline. Nothing here interprets: every string that came
// from a file travels verbatim.
//
// IDEMPOTENCY IS THE WHOLE POINT. The key is `source_ref`: a record already on disk carrying one is
// never rewritten, so a later stage's edits survive a re-run. The set is read ONCE, before the first
// write, which is also what makes two candidates sharing a source_ref (DECISION-LOG.md has repeated
// row numbers) stable — both land on run 1, both are skipped on run 2.
//
//   node init.mjs --retrospective perspective/retrospective-sessions/<id> [--workspace-root d] [--data-root d] [--no-link] [--dry-run]
//
// --workspace-root is where the INPUTS are read (default the vault); --data-root where the records
// are written. --no-link skips the `dt set … --perspective` back-reference (a fixture run has no
// retrospective to point at).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { VAULT, DATA, dt, slug } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, listRecords, contributorOf} from '../lib/records.mjs';
import { numberedListItems } from '../lib/markdown.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const base = retrospective.split('/').pop();
const workspaceRoot = path.resolve(opt('workspace-root', VAULT));
const dataRoot = path.resolve(opt('data-root', DATA));
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use: reading it eagerly made a script that should exit 2 on a bad argument crash on a missing
// session instead, and write nothing was the contract it broke (read-asana, 2026-09-09).
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const dryRun = flag('dry-run');
const AUTHOR = 'scripts/init@1';
const RUNTIME = path.join(workspaceRoot, '.dreamteamer');

/** Every file under `dir` matching `test`, recursively. Absent is empty, never an error. */
function walk(dir, test) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p, test) : test(e.name) ? [p] : [];
	});
}

/** The source_refs already on disk under this run's id prefix — the idempotency key, read once. */
function existingRefs(collection) {
	const seen = new Set();
	for (const file of listRecords(path.join(dataRoot, 'perspective', collection, who()))) {
		const ref = readRecord(file).fields?.source_ref;
		if (ref) seen.add(String(ref));
	}
	return seen;
}

// ── concepts: the vocabulary the workspace already defines ────────────────────────────────────────
const conceptCandidates = [];
for (const file of walk(path.join(RUNTIME, 'collections'), (n) => n.endsWith('.collection.yaml'))) {
	const doc = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
	const name = doc.name || path.basename(file, '.collection.yaml');
	// the module does not describe ITSELF as the person's DSL
	if (String(name) === 'perspective' || String(name).startsWith('perspective/')) continue;
	conceptCandidates.push({ name: String(name), definition: doc.description ?? '', source_ref: `collections/${name}` });
}
for (const file of walk(path.join(RUNTIME, 'skills'), (n) => n === 'SKILL.md')) {
	const id = path.basename(path.dirname(file));
	const { fields } = readRecord(file);
	conceptCandidates.push({ name: String(fields.name ?? id), definition: fields.description ?? '', source_ref: `skills/${id}` });
}
for (const file of walk(path.join(RUNTIME, 'commands'), (n) => n.endsWith('.command.md'))) {
	const id = path.relative(path.join(RUNTIME, 'commands'), file).replace(/\.command\.md$/, '');
	const { fields } = readRecord(file);
	conceptCandidates.push({ name: String(fields.name ?? id), definition: fields.description ?? '', source_ref: `commands/${id}` });
}

const conceptsSeen = existingRefs('concepts');
let conceptsNew = 0, conceptsExisting = 0;
for (const c of conceptCandidates) {
	if (conceptsSeen.has(c.source_ref)) { conceptsExisting++; continue; }
	conceptsNew++;
	if (dryRun) continue;
	writeRecord(
		recordPath('concepts', `${who()}/${slug(c.name)}`, 'concept', dataRoot),
		{ retrospective, contributor: who(), name: c.name, origin: 'workspace', definition: c.definition, source_ref: c.source_ref, evidence_count: 0, author: AUTHOR },
		c.definition,
	);
}

// ── decisions: what the workspace already recorded deciding ───────────────────────────────────────
const decisionCandidates = [];
const adlDir = path.join(workspaceRoot, 'data', 'agent-decision-log');
for (const file of listRecords(adlDir)) {
	const { fields, body } = readRecord(file);
	const id = path.relative(adlDir, file).replace(/\.[^./]+\.md$/, '');
	const decidedOn = String(fields.decided ?? '').slice(0, 10);
	if (!fields.name || !/^\d{4}-\d{2}-\d{2}$/.test(decidedOn)) continue;
	decisionCandidates.push({
		name: String(fields.name), decided_on: decidedOn,
		decision: fields.decision ?? '', rationale: fields.rationale ?? '',
		source_ref: `agent-decision-log/${id}`,
		body: (body || fields.decision || '').trim(),
	});
}

// One numbered ROW, `<n>. **<date> — <title>** <the rest>` — and a row is a list ITEM, never a
// physical line. A heading long enough to wrap puts its closing `**` on the next line, and reading
// line by line matched nothing there and counted a perfectly dated row as undated (15 rows, 7 of them
// dated, all 7 skipped — the 2026-09-11 receipt). `numberedListItems` rejoins each item first, so a
// wrapped heading and a single-line one are the same input to everything below, and the continuation
// prose travels with the row instead of being dropped at the line break.
//
// A row whose bold header carries no date is a pre-dating row from the log's first weeks — skipped,
// and counted in the receipt. A numbered row with no bold header at all is not a decision row and is
// not counted: the receipt's `skipped-undated` says a DATE is missing, never that a line was passed.
let skippedUndated = 0;
const logFile = path.join(workspaceRoot, 'DECISION-LOG.md');
if (fs.existsSync(logFile)) {
	for (const item of numberedListItems(fs.readFileSync(logFile, 'utf8'))) {
		if (!item.content.startsWith('**')) continue;
		const m = /^\*\*(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\*\*/.exec(item.content);
		if (!m) { skippedUndated++; continue; }
		const [, date, rawTitle] = m;
		decisionCandidates.push({
			name: rawTitle.slice(0, 120), decided_on: date,
			decision: item.content.slice(m[0].length).trim().slice(0, 400), rationale: '',
			source_ref: `DECISION-LOG.md#${item.number}`,
			body: item.raw.trim(),
		});
	}
}

const decisionsSeen = existingRefs('decisions');
let decisionsNew = 0, decisionsExisting = 0;
for (const d of decisionCandidates) {
	if (decisionsSeen.has(d.source_ref)) { decisionsExisting++; continue; }
	decisionsNew++;
	if (dryRun) continue;
	writeRecord(
		recordPath('decisions', `${who()}/${d.decided_on}--${slug(d.name)}`, 'decision', dataRoot),
		{ retrospective, contributor: who(), name: d.name, source_kind: 'decision-log', source_ref: d.source_ref, decided_on: d.decided_on, decision: d.decision, rationale: d.rationale, author: AUTHOR },
		d.body,
	);
}

// ── the perspective skeleton: the operational model, inline at description level ──────────────────
const commands = walk(path.join(RUNTIME, 'commands'), (n) => n.endsWith('.command.md')).map((file) => {
	const { fields } = readRecord(file);
	const name = String(fields.name ?? path.basename(file, '.command.md'));
	return fields.description ? { name, description: String(fields.description) } : { name };
});
const skills = walk(path.join(RUNTIME, 'skills'), (n) => n === 'SKILL.md').map((file) => {
	const { fields } = readRecord(file);
	const name = String(fields.name ?? path.basename(path.dirname(file)));
	return fields.description ? { name, description: String(fields.description) } : { name };
});
const routines = listRecords(path.join(workspaceRoot, 'data', 'routines')).map((file) => {
	const { fields } = readRecord(file);
	const entry = { name: String(fields.name ?? path.basename(file).replace(/\.[^./]+\.md$/, '')) };
	const description = fields.notes ?? fields.description;
	if (description) entry.description = String(description);
	if (fields.recurrence) entry.recurrence = String(fields.recurrence);
	return entry;
});

const perspectiveFile = recordPath('perspectives', who(), 'perspective', dataRoot);
const merged = fs.existsSync(perspectiveFile);
const prior = merged ? readRecord(perspectiveFile) : { fields: {}, body: '' };
const retrospectiveFile = path.join(dataRoot, 'perspective', 'retrospective-sessions', `${base}.retrospective-session.md`);
const contributor = prior.fields.contributor
	?? (fs.existsSync(retrospectiveFile) ? readRecord(retrospectiveFile).fields.contributor : undefined)
	?? 'unknown';
if (!dryRun) {
	writeRecord(
		perspectiveFile,
		{ ...prior.fields, retrospective, contributor, commands, skills, routines, author: prior.fields.author ?? AUTHOR },
		prior.body,
	);
	// ⚠ NO BACK-LINK WRITE HERE, and `--no-link` is accepted only so old invocations keep
	// working. `retrospective-sessions.perspective` is GENERATED from
	// `perspective/perspectives.retrospective`, which the writeRecord above has just set —
	// so the link already exists the moment compile runs. Setting it directly is refused by
	// the store ("perspective is generated from … — set that instead"), and that refusal
	// crashed this script AFTER it had written its concepts and decisions, leaving the run
	// half-done with a stack trace and a zero exit nowhere in sight (2026-09-12).
}

process.stdout.write(
	`✔ init · concepts +${conceptsNew} (=${conceptsExisting} existing)` +
	` · decisions +${decisionsNew} (=${decisionsExisting} existing, ${skippedUndated} skipped-undated)` +
	` · perspective ${merged ? 'merged' : 'written'}${dryRun ? ' · DRY RUN' : ''}\n`,
);
