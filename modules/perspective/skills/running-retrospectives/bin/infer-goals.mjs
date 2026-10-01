#!/usr/bin/env node
// infer-goals — the MECHANICAL half of stage 7, `inferred`.
//
//   node infer-goals.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root s] [--attach] [--force] [--dry-run]
//
// ⚠ THIS COLLECTION HAD NO WRITER. `goals` has existed since the v2 model, is advertised in the
// module's own description, and `references/inference-model.md` gives its rung — and no stage of the
// skill wrote one. Nothing failed, because nothing checked: `tests/stage-model.test.mjs` is what
// makes an orphaned collection an error now.
//
// TWO HALVES, the same split `cluster-activities` + `attach-evidence` uses, and for the same reason.
// Naming a goal is a JUDGEMENT the inference model is explicit about: *"'ship the product' — a goal
// that excludes nothing predicts nothing. Name the fork it would have let you predict before writing
// it."* A script cannot do that. So:
//
//   default   groups this contributor's decisions and activities into CANDIDATES, one per project
//             arc, and writes them to <scratch>/goal-candidates/<base>.jsonl. NO records.
//             The model then names each and `dt add`s it with `--from_candidate <key>`.
//   --attach  fills the machine half onto every goal carrying `from_candidate`: the refs it was
//             inferred from, the counts, the dates, and `standing`.
//
// ⚠ NEVER FROM WHAT THE PERSON SAID. A goal read out of an answer is an answered question and belongs
// on the question record. This script reads only decisions, activities and projects.
// ⚠ ADDITIVE. `--attach` never lowers a `standing` the interview raised, and never overwrites a
// hand-set field without `--force` — the rule `derive-collaborators` learned by deleting 108 refs.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../lib/vault.mjs';
import { listRecords, readRecord, writeRecord, recordPath, contributorOf } from '../lib/records.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) {
	console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required');
	process.exit(2);
}
const base = retrospective.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run. Resolved LAZILY so a bad
// argument still exits 2 without touching disk.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const scratchRoot = opt('scratch-root', path.join(path.dirname(dataRoot), '.perspective'));
const dryRun = flag('dry-run');
const force = flag('force');
const AUTHOR = 'scripts/infer-goals@1';

const dir = (c) => path.join(dataRoot, 'perspective', c, who());
const idOf = (file, coll, suffix) =>
	path.relative(path.join(dataRoot, 'perspective', coll), file).replace(new RegExp(`\\.${suffix}\\.md$`), '');
const load = (coll, suffix) => listRecords(dir(coll)).map((f) => ({ id: idOf(f, coll, suffix), file: f, ...readRecord(f) }));
const day = (v) => (v ? String(v).slice(0, 10) : '');
const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
/** Dates and strings compare equal when they mean the same day; everything else structurally. */
const norm = (v) => {
	if (v instanceof Date) return day(v.toISOString());
	if (Array.isArray(v)) return v.map(norm);
	if (v && typeof v === 'object') {
		// ⚠ DROP THE EMPTIES, because `writeRecord` drops them: a key set to undefined and a key that
		// was never there produce the same file, so treating them as different made the receipt claim
		// a write on every re-run while the bytes on disk never moved. A receipt that overstates its
		// own work is the same class of defect as a green test that proves nothing.
		const keep = Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== '' && !(Array.isArray(v[k]) && v[k].length === 0));
		return Object.fromEntries(keep.sort().map((k) => [k, norm(v[k])]));
	}
	return v;
};
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

const activities = load('world/activities', 'activity');
const decisions = load('decisions', 'decision');
const projects = load('world/projects', 'project');

// ── candidates ────────────────────────────────────────────────────────────────────────────────
// The arc is the unit: a project's activities and the decisions those activities' evidence carries.
// A project with one activity and no decision is not an arc — it predicts nothing, so it is skipped
// and COUNTED, which is the honest measure of how much work no goal can be read out of.
function candidates() {
	const byProject = new Map();
	for (const a of activities) {
		const key = a.fields.project ? String(a.fields.project).split('/').pop() : '(unassigned)';
		if (!byProject.has(key)) byProject.set(key, { activities: [], decisions: [], topics: [] });
		const g = byProject.get(key);
		g.activities.push(a);
		g.topics.push(...(Array.isArray(a.fields.topics) ? a.fields.topics : []));
	}
	for (const d of decisions) {
		const key = d.fields.project ? String(d.fields.project).split('/').pop() : '(unassigned)';
		if (byProject.has(key)) byProject.get(key).decisions.push(d);
	}
	const out = [], thin = [];
	for (const [key, g] of byProject) {
		const dates = [...g.activities.map((a) => day(a.fields.started)), ...g.decisions.map((d) => day(d.fields.decided_on))].filter(Boolean).sort();
		const row = {
			key,
			project: key === '(unassigned)' ? '' : `perspective/world/projects/${who()}/${key}`,
			project_name: projects.find((p) => p.id.endsWith(`/${key}`))?.fields.name ?? key,
			activities: g.activities.map((a) => `perspective/world/activities/${a.id}`),
			decisions: g.decisions.map((d) => `perspective/world/decisions/${d.id}`),
			topics: uniq(g.topics),
			activity_names: g.activities.map((a) => String(a.fields.name ?? '')),
			decision_names: g.decisions.map((d) => String(d.fields.name ?? '')),
			evidence_count: g.activities.length + g.decisions.length,
			first_seen: dates[0] ?? '',
			last_seen: dates[dates.length - 1] ?? '',
		};
		(row.activities.length >= 2 || row.decisions.length >= 1 ? out : thin).push(row);
	}
	return { out: out.sort((a, b) => b.evidence_count - a.evidence_count), thin };
}

// ── attach ────────────────────────────────────────────────────────────────────────────────────
function attach(rows) {
	const byKey = new Map(rows.map((r) => [r.key, r]));
	let filled = 0, unchanged = 0, unmatched = 0;
	for (const g of load('world/goals', 'goal')) {
		const key = g.fields.from_candidate ? String(g.fields.from_candidate) : '';
		const row = byKey.get(key);
		if (!row) { unmatched++; continue; }
		const next = { ...g.fields };
		next.projects = row.project ? uniq([...(g.fields.projects ?? []), row.project]) : g.fields.projects;
		next.activities = uniq([...(g.fields.activities ?? []), ...row.activities]);
		next.decisions = uniq([...(g.fields.decisions ?? []), ...row.decisions]);
		next.topics = uniq([...(g.fields.topics ?? []), ...row.topics]);
		next.evidence_count = row.evidence_count;
		next.first_seen = g.fields.first_seen && !force ? g.fields.first_seen : row.first_seen;
		next.last_seen = row.last_seen;
		// ⚠ never lower what the interview raised: corroborated and confirmed outrank inferred.
		if (!['corroborated', 'confirmed', 'refuted'].includes(String(g.fields.standing ?? ''))) next.standing = 'inferred';
		next.author = g.fields.author ?? AUTHOR;
		// ⚠ COMPARE NORMALISED. YAML parses an unquoted `2026-03-04` into a Date, so a raw
		// JSON.stringify diff calls every re-run a change and the stage stops being idempotent —
		// which `tests/idempotency.test.mjs` would then fail, correctly.
		if (same(next, g.fields)) { unchanged++; continue; }
		filled++;
		if (!dryRun) writeRecord(recordPath('world/goals', g.id, 'goal', dataRoot), next, g.body);
	}
	return { filled, unchanged, unmatched };
}

const { out, thin } = candidates();

if (flag('attach')) {
	const r = attach(out);
	process.stdout.write(`✔ goals attached ${r.filled} · unchanged ${r.unchanged} · no candidate ${r.unmatched}${dryRun ? ' · DRY RUN' : ''}\n`);
} else {
	const file = path.join(scratchRoot, 'goal-candidates', `${base}.jsonl`);
	if (!dryRun) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
	}
	process.stdout.write(
		`✔ goal candidates ${out.length} · from ${activities.length} activities, ${decisions.length} decisions`
		+ ` · arcs too thin to predict anything ${thin.length}${dryRun ? ' · DRY RUN' : ''}\n`
		+ (out.length ? `  → ${file}\n  NAME each one, then re-run with --attach. A goal that excludes nothing predicts nothing.\n` : ''),
	);
}
