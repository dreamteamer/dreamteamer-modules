#!/usr/bin/env node
// The plan guard: the rules `dreamteamer check` cannot express, because they are conditional on a
// field's value or on a value in a different record.
//
//   node node_modules/@dreamteamer/core/bin/projects-check-records.mjs [--data-root <dir>] [--json]
//
// Chain it after `dreamteamer check` in the workspace's `check` script. Exit 0 clean, 1 with
// violations, 2 on a usage error.
//
// Gates and work share one collection, so nothing in JSON Schema stops a `work` row carrying
// `passes_when`, or a gate reaching `done` with nothing to show; this guard refuses both. It also
// refuses a rung whose lane or phase belongs to another project, which both resolve and so pass
// `dreamteamer check`.
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
 * `phases` a phase's last id segment to its project. Both default to empty, which leaves those rules
 * inert.
 */
export function violationsOf(id, record, lanes = new Map(), phases = new Map()) {
	const out = [];
	const kind = record.kind ?? 'work';
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);

	// A rung may not sit in a lane that belongs to another project. A lane with no `project` spans
	// plans and matches every rung.
	if (has('lane') && has('project')) {
		const laneProject = lanes.get(idOf(record.lane));
		if (laneProject && idOf(laneProject) !== idOf(record.project)) {
			out.push(`${id}: lane \`${idOf(record.lane)}\` belongs to project \`${idOf(laneProject)}\` and this rung is in \`${idOf(record.project)}\` — move the rung, or clear the lane's \`project\` if the band really does span plans`);
		}
	}

	// The same rule for `phase`. A phase's `project` is required, so there is no cross-plan phase and a
	// mismatch is always a mistake.
	if (has('phase') && has('project')) {
		const phaseProject = phases.get(idOf(record.phase));
		if (phaseProject && idOf(phaseProject) !== idOf(record.project)) {
			out.push(`${id}: phase \`${idOf(record.phase)}\` belongs to project \`${idOf(phaseProject)}\` and this rung is in \`${idOf(record.project)}\` — a phase is one plan's own calendar, so move the rung or give this plan its own phase`);
		}
	}

	if (kind === 'gate') {
		// A gate is a thing somebody JUDGES. Without a written test there is nothing to judge against.
		if (!has('passes_when')) out.push(`${id}: a gate needs \`passes_when\` — the test that says it passed, as one checkable sentence`);
		// `done` on a gate means passed, and a pass needs evidence.
		if (record.status === 'done' && !has('evidence')) out.push(`${id}: a gate cannot be \`done\` with no \`evidence\` — say what actually proved it, or leave the status alone`);
		// A gate is judged on a day. A span means somebody modelled work and labelled it a gate.
		if (has('starts') && has('ends') && record.starts !== record.ends) out.push(`${id}: a gate is a point — \`starts\` and \`ends\` must be the same day (got ${record.starts} → ${record.ends})`);
	} else {
		// Gate-only fields on a work row would read as a gate to every view.
		for (const f of GATE_ONLY) if (has(f)) out.push(`${id}: \`${f}\` is a GATE field and this row is \`kind: ${kind}\` — set \`kind: gate\`, or drop the field`);
	}
	return out;
}

/**
 * The violations in one `decisions` record. Pure.
 *
 * One table holds both an agent's fork and a person's call, so every record must say which it is.
 * `decided_by` makes the claim, and this requires the matching identity field, which JSON Schema
 * cannot make conditional on a value. Both directions are checked: a missing identity leaves the
 * record unattributable, and the wrong one reads as attributed when it is not.
 */
export function decisionViolationsOf(id, record) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);
	const by = record.decided_by;

	if (by === 'person') {
		// Either side attributes: `decider` is someone on your side, `external_decider` someone outside.
		if (!has('decider') && !has('external_decider')) out.push(`${id}: \`decided_by: person\` needs \`decider\` or \`external_decider\` — which person made the call; an unattributable decision is a rumour`);
		if (has('agent')) out.push(`${id}: \`decided_by: person\` must not carry \`agent\` — say which of the two decided, not both`);
	} else if (by === 'agent') {
		if (!has('agent')) out.push(`${id}: \`decided_by: agent\` needs \`agent\` — which agent and which model, e.g. \`agents/claude-code (claude-opus-5)\``);
		if (has('decider') || has('external_decider')) out.push(`${id}: \`decided_by: agent\` must not carry \`decider\` — a person who merely approved it afterwards belongs in the body, not in this field`);
	}

	// A `supersedes` that points at itself is a loop no reader can walk.
	if (has('supersedes') && idOf(record.supersedes) === idOf(id)) out.push(`${id}: \`supersedes\` points at itself`);

	// `outcome: superseded` is a claim about ANOTHER record — the later one names this in its own
	// `supersedes`. Nothing here can reach that record, so the rule is the honest half: a decision
	// marked superseded that also supersedes nothing is usually a value chosen for the wrong field.
	return out;
}

/**
 * The violations in one `deliverables` record. Pure.
 *
 * `accepted` is the receiving side's act, so it requires `accepted_by`. `delivered` needs no such
 * proof: handing something over is a thing you do and can assert.
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
 * A risk closes only through its `gate` or a documented change (`mitigation` says which), and
 * `accepted` needs `mitigation` to name who decided to live with it.
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

/** Runs only as a script, so importing the pure functions does not scan the workspace or exit. */
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
	// Phase ids are `<project>/<name>`; the map is keyed by the last segment, the same reduction `idOf`
	// applies to the reference on an activity or deliverable.
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

/** True when run as a script. `process.argv[1]` is the path as invoked and `import.meta.url` the path
 *  resolved; both are realpath'd so the guard also runs when reached through a symlink such as
 *  `git_modules/<name>`. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) main();
