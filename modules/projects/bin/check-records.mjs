#!/usr/bin/env node
// THE PLAN GUARD — the rules `dreamteamer check` structurally cannot express, because they are
// CONDITIONAL on a field's value rather than on the schema.
//
//   node modules/projects/bin/check-records.mjs [--data-root <dir>] [--json]
//
// Chain it after `dreamteamer check` in the consuming workspace's `check` script, the way the
// perspective module's guard is chained. Exit 0 clean, 1 with violations, 2 on a usage error.
//
// ⚠ WHY THESE RULES EXIST AT ALL. Folding gates into activities (2026-09-10) bought one ordered plan
// at the price of a shape that can lie: nothing in JSON Schema stops a `work` row carrying
// `passes_when`, or a gate being marked done with nothing to show. The fold is only honest if the
// combinations that would be a lie are REFUSED — which is this file. The rule that matters most is
// the last one: a gate that reached `done` with no `evidence` is exactly the "we said it passed"
// that a gate exists to prevent.
//
// ⚠ AND ONE RULE THAT IS NOT ABOUT THE FOLD: a rung's `lane` may not belong to another project.
// Both fields are typed and both resolve, so `dreamteamer check` passes — the condition lives in a
// DIFFERENT record, which is the thing JSON Schema cannot reach. Left unchecked, the board draws
// this plan's rung inside another plan's swimlane and it reads as data rather than as a mistake.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every gate-only field, named once so the rules and the message cannot drift apart. */
export const GATE_ONLY = ['gate_kind', 'passes_when', 'evidence', 'blocking', 'external_owner'];

/** A reference as it may be written — `activity-lanes/discovery` or the bare id — reduced to the id. */
const idOf = (ref) => String(ref).trim().replace(/^.*\//, '');

/**
 * The violations in one activity record. Pure — `record` is the parsed frontmatter, `id` its id.
 *
 * `lanes` maps a lane id to the `project` on that lane record (absent for a cross-project lane), and
 * defaults to empty so every existing caller keeps its two-argument shape and the lane rule stays
 * inert where no lanes exist.
 */
export function violationsOf(id, record, lanes = new Map(), phases = new Map()) {
	const out = [];
	const kind = record.kind ?? 'work';
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);

	// ⚠ THE ONE LANE RULE A SCHEMA CANNOT EXPRESS: a rung may not sit in a band that belongs to
	// ANOTHER plan. Both fields are typed and both resolve, so `dreamteamer check` is happy — and the
	// board then draws this project's rung inside somebody else's swimlane, which reads as data. The
	// rule is conditional on a value in a DIFFERENT record, which is exactly what JSON Schema cannot
	// reach. A lane with no `project` is the cross-project workstream and matches everything, by design.
	if (has('lane') && has('project')) {
		const laneProject = lanes.get(idOf(record.lane));
		if (laneProject && idOf(laneProject) !== idOf(record.project)) {
			out.push(`${id}: lane \`${idOf(record.lane)}\` belongs to project \`${idOf(laneProject)}\` and this rung is in \`${idOf(record.project)}\` — move the rung, or clear the lane's \`project\` if the band really does span plans`);
		}
	}

	// ⚠ THE SAME RULE FOR `phase`, AND IT IS STRICTER. A lane's `project` is OPTIONAL, so an empty one
	// is the legitimate cross-plan workstream and matches everything. A phase's `project` is REQUIRED —
	// a stretch of calendar belongs to exactly one plan — so there is no "spans plans" escape here: a
	// mismatch is always a mistake, and left unchecked the gantt bands this rung under another plan's
	// Discovery.
	if (has('phase') && has('project')) {
		const phaseProject = phases.get(idOf(record.phase));
		if (phaseProject && idOf(phaseProject) !== idOf(record.project)) {
			out.push(`${id}: phase \`${idOf(record.phase)}\` belongs to project \`${idOf(phaseProject)}\` and this rung is in \`${idOf(record.project)}\` — a phase is one plan's own calendar, so move the rung or give this plan its own phase`);
		}
	}

	if (kind === 'gate') {
		// A gate is a thing somebody JUDGES. Without a written test there is nothing to judge against.
		if (!has('passes_when')) out.push(`${id}: a gate needs \`passes_when\` — the test that says it passed, as one checkable sentence`);
		// ⚠ THE LOAD-BEARING RULE. `done` on a gate means PASSED, and a pass with nothing behind it is
		// the failure mode the whole object exists to prevent.
		if (record.status === 'done' && !has('evidence')) out.push(`${id}: a gate cannot be \`done\` with no \`evidence\` — say what actually proved it, or leave the status alone`);
		// A gate is judged on a day. A span means somebody modelled work and labelled it a gate.
		if (has('starts') && has('ends') && record.starts !== record.ends) out.push(`${id}: a gate is a point — \`starts\` and \`ends\` must be the same day (got ${record.starts} → ${record.ends})`);
	} else {
		// The other half of the fold: gate-only fields on a work row read as a gate to every view.
		for (const f of GATE_ONLY) if (has(f)) out.push(`${id}: \`${f}\` is a GATE field and this row is \`kind: ${kind}\` — set \`kind: gate\`, or drop the field`);
	}
	return out;
}

/**
 * The violations in one `decisions` record. Pure.
 *
 * ⚠ THE RULE THE FOLD RESTS ON. One table holds both an agent's unattended fork and a person's call,
 * and that is only safe while every record says plainly which it is — a person's decision is
 * authority, an agent's is a judgement made on somebody's behalf while they were away, and reading
 * one as the other is the entire risk the fold takes on. The enum makes the claim; nothing in JSON
 * Schema can make the matching identity field REQUIRED conditionally on its value, so it is here.
 *
 * Both directions are checked. A missing half leaves the record unattributable; a filled WRONG half
 * (`decided_by: person` carrying an `agent`) is worse, because it reads as attributed and is not.
 */
export function decisionViolationsOf(id, record) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);
	const by = record.decided_by;

	if (by === 'person') {
		// ⚠ EITHER SIDE ATTRIBUTES. `decider` is one of ours, `external_decider` is the client's —
		// and on this engagement the most consequential calls were the client's, so demanding
		// `decider` alone made them unrecordable. The rule is unchanged: somebody is named.
		if (!has('decider') && !has('external_decider')) out.push(`${id}: \`decided_by: person\` needs \`decider\` or \`external_decider\` — which person made the call; an unattributable decision is a rumour`);
		if (has('agent')) out.push(`${id}: \`decided_by: person\` must not carry \`agent\` — say which of the two decided, not both`);
	} else if (by === 'agent') {
		if (!has('agent')) out.push(`${id}: \`decided_by: agent\` needs \`agent\` — which agent and which model, e.g. \`agents/dreamteamer (claude-opus-5)\``);
		if (has('decider') || has('external_decider')) out.push(`${id}: \`decided_by: agent\` must not carry \`decider\` — a person who merely approved it afterwards belongs in the body, not in this field`);
	}

	// ⚠ A `supersedes` that points at itself is a loop no reader can walk, and the schema cannot see it.
	if (has('supersedes') && idOf(record.supersedes) === idOf(id)) out.push(`${id}: \`supersedes\` points at itself`);

	// `outcome: superseded` is a claim about ANOTHER record — the later one names this in its own
	// `supersedes`. Nothing here can reach that record, so the rule is the honest half: a decision
	// marked superseded that also supersedes nothing is usually a value chosen for the wrong field.
	return out;
}

/**
 * The violations in one `deliverables` record. Pure.
 *
 * ⚠ THE RULE THAT MATTERS: `accepted` is somebody ELSE'S act. A deliverable that reached `accepted`
 * with no `accepted_by` is this workspace signing off its own homework — the same failure the gate
 * rule above refuses, in the one other place the model lets it happen. `delivered` needs no such
 * proof, deliberately: handing something over is a thing we do and can assert.
 */
export function deliverableViolationsOf(id, record, phases = new Map()) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);

	if (record.status === 'accepted' && !has('accepted_by')) {
		out.push(`${id}: a deliverable cannot be \`accepted\` with no \`accepted_by\` — acceptance is the receiving side's act, so name who said yes or leave it \`delivered\``);
	}
	// Accepted before it was ever handed over is a sequence nobody can have lived through.
	if (has('accepted_on') && has('delivered_on') && String(record.accepted_on) < String(record.delivered_on)) {
		out.push(`${id}: \`accepted_on\` (${record.accepted_on}) is before \`delivered_on\` (${record.delivered_on}) — one of the two dates is wrong`);
	}
	// The same cross-project rule the rungs get: a handover banded under another plan's stretch.
	if (has('phase') && has('project')) {
		const phaseProject = phases.get(idOf(record.phase));
		if (phaseProject && idOf(phaseProject) !== idOf(record.project)) {
			out.push(`${id}: phase \`${idOf(record.phase)}\` belongs to project \`${idOf(phaseProject)}\` and this deliverable is in \`${idOf(record.project)}\``);
		}
	}
	return out;
}

/**
 * The violations in one `risks` record. Pure.
 *
 * ⚠ THE RULE THAT MATTERS: `closed` is a CLAIM about the world, and the register's whole point is
 * that de-risking is quotable. A risk may only close through its `gate` or through a documented
 * change (`mitigation` says which); `accepted` is somebody's authority and `mitigation` must name
 * whose. Everything else the schema already refuses.
 */
export function riskViolationsOf(id, record) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);
	if (record.status === 'closed' && !has('gate') && !has('mitigation')) {
		out.push(`${id}: a risk cannot be \`closed\` with neither \`gate\` nor \`mitigation\` — say what retired it, quotably, or leave it open`);
	}
	if (record.status === 'accepted' && !has('mitigation')) {
		out.push(`${id}: \`accepted\` is somebody's authority — \`mitigation\` must say who decided to live with it`);
	}
	return out;
}

/** ⚠ EVERYTHING BELOW RUNS ONLY AS A SCRIPT. Without this guard, importing `violationsOf` from a test
 *  ran the whole scan at import time and called `process.exit(0)` — which killed the test file before a
 *  single assertion ran and reported it as 1 test, 1 passing. Measured 2026-09-10. */
function main() {
	const argv = process.argv.slice(2);
	const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
	const dataRoot = path.resolve(opt('data-root', 'data'));

	/** Frontmatter only — the body is prose and no rule here reads it. */
	function frontmatter(file) {
		const text = fs.readFileSync(file, 'utf8');
		if (!text.startsWith('---\n')) return {};
		const end = text.indexOf('\n---', 4);
		if (end < 0) return {};
		const out = {};
		for (const line of text.slice(4, end).split('\n')) {
			const m = /^([a-z_]+):\s*(.*)$/.exec(line);
			if (!m) continue;
			let v = m[2].trim();
			if (v === '') v = '';
			else if (v === 'true' || v === 'false') v = v === 'true';
			else v = v.replace(/^['"]|['"]$/g, '');
			out[m[1]] = v;
		}
		return out;
	}

	/** Every record of one collection as `[id, frontmatter]`, or [] where the folder does not exist. */
	function records(folder, suffix) {
		const dir = path.join(dataRoot, folder);
		if (!fs.existsSync(dir)) return [];
		return fs.readdirSync(dir, { recursive: true })
			.filter((f) => String(f).endsWith(`.${suffix}.md`))
			.map((f) => [String(f).replace(new RegExp(`\\.${suffix}\\.md$`), ''), frontmatter(path.join(dir, String(f)))]);
	}

	/** lane id → the `project` that lane belongs to. Absent value = a lane that spans plans. */
	const lanes = new Map(records('activity-lanes', 'activity-lane').map(([id, fm]) => [id, fm.project || undefined]));
	// ⚠ phase ids are PROJECT-SCOPED (`<project>/<name>`), so the map is keyed by the last segment the
	// same way `idOf` reduces a reference — otherwise every lookup misses and the rule goes silently inert,
	// which is the failure mode a guard must never have.
	const phases = new Map(records('phases', 'phase').map(([id, fm]) => [idOf(id), fm.project || undefined]));

	const activities = records('activities', 'activity');
	const decisions = records('decisions', 'decision');
	const deliverables = records('deliverables', 'deliverable');
	const risks = records('risks', 'risk');
	const checked = activities.length + decisions.length + deliverables.length + phases.size + risks.length;

	if (!checked) {
		// A workspace with the module installed and no plan yet is not a failure.
		console.log('✔ plan records: no plan records yet');
		process.exit(0);
	}

	const violations = [
		...activities.flatMap(([id, fm]) => violationsOf(id, fm, lanes, phases)),
		...decisions.flatMap(([id, fm]) => decisionViolationsOf(id, fm)),
		...deliverables.flatMap(([id, fm]) => deliverableViolationsOf(id, fm, phases)),
		...risks.flatMap(([id, fm]) => riskViolationsOf(id, fm)),
	];

	if (argv.includes('--json')) {
		console.log(JSON.stringify({ checked, activities: activities.length, decisions: decisions.length, deliverables: deliverables.length, phases: phases.size, risks: risks.length, violations }, null, 2));
	} else if (violations.length) {
		console.error(`✖ plan records: ${violations.length} violation(s) across ${checked} records`);
		for (const v of violations) console.error(`  ${v}`);
	} else {
		console.log(`✔ plan records: ${checked} checked, 0 violations (${activities.length} activities, ${decisions.length} decisions, ${deliverables.length} deliverables, ${phases.size} phases, ${risks.length} risks)`);
	}
	process.exit(violations.length ? 1 : 0);
}

/** ⚠ RUN AS A SCRIPT — AND THROUGH A SYMLINK, WHICH IS THE HALF THAT WAS BROKEN.
 *
 *  `process.argv[1]` is the path as INVOKED; `import.meta.url` is the path RESOLVED. Under preview
 *  mode the module is reached through a `git_modules/<name>` symlink into a clone elsewhere, so the
 *  two are different strings for the same file and a `===` between them is false. The guard then
 *  never fires: no output at all, exit 0, and a reader sees a clean run.
 *
 *  Measured 2026-09-11 on a linked consumer holding 52 activities, 35 decisions and 8 phases: this
 *  file printed NOTHING and exited 0. It is the same defect the perspective guard was fixed for a
 *  day earlier from the other direction (its data root resolved from the SCRIPT), and the same
 *  lesson: a guard whose silence means "clean" must be forced to prove it ran. Both sides are
 *  realpath'd now, so the symlink and the real path compare equal. `tests/script-entry.test.mjs`
 *  holds it, over every script in the package and by actually invoking one through a link. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) main();
