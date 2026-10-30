#!/usr/bin/env node
// The plan guard: the rules `dreamteamer check` cannot express, because they are conditional on a
// field's value or on a value in a different record.
//
//   node node_modules/@dreamteamer/core/bin/projects-check-records.mjs [--data-root <dir>] [--json]
//
// Chain it after `dreamteamer check` in the workspace's `check` script. Exit 0 clean, 1 with
// violations, 2 on a usage error.
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A reference as it may be written — `decisions/2026-01-02--x` or the bare id — reduced to the id. */
const idOf = (ref) => String(ref).trim().replace(/^.*\//, '');

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
	} else if (by === 'unknown') {
		// A row read out of a source: the source is its attribution, and naming a decider beside
		// `unknown` is the two answers to one question.
		if (!has('source')) out.push(`${id}: \`decided_by: unknown\` needs \`source\` — where the decision was read from is the only attribution it has`);
		if (has('decider') || has('external_decider') || has('agent')) out.push(`${id}: \`decided_by: unknown\` must not carry \`decider\`, \`external_decider\` or \`agent\` — if one of them decided, say so in \`decided_by\``);
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
export function deliverableViolationsOf(id, record) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);

	if (record.status === 'accepted' && !has('accepted_by')) {
		out.push(`${id}: a deliverable cannot be \`accepted\` with no \`accepted_by\` — acceptance is the receiving side's act, so name who said yes or leave it \`delivered\``);
	}
	// Accepted before it was ever handed over is a sequence nobody can have lived through.
	if (has('accepted_on') && has('delivered_on') && String(record.accepted_on) < String(record.delivered_on)) {
		out.push(`${id}: \`accepted_on\` (${record.accepted_on}) is before \`delivered_on\` (${record.delivered_on}) — one of the two dates is wrong`);
	}
	return out;
}

/**
 * The violations in one `risks` record. Pure.
 *
 * A risk closes only through a documented change (`mitigation` says which), and
 * `accepted` needs `mitigation` to name who decided to live with it.
 */
export function riskViolationsOf(id, record) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);
	if (record.status === 'closed' && !has('mitigation')) {
		out.push(`${id}: a risk cannot be \`closed\` with no \`mitigation\` — say what retired it, quotably, or leave it open`);
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

	const decisions = records('decisions', 'decision');
	const deliverables = records('deliverables', 'deliverable');
	const risks = records('risks', 'risk');
	const checked = decisions.length + deliverables.length + risks.length;

	if (!checked) {
		// A workspace with the module installed and no plan yet is not a failure.
		console.log('✔ plan records: no plan records yet');
		process.exit(0);
	}

	const violations = [
		...decisions.flatMap(([id, fm]) => decisionViolationsOf(id, fm)),
		...deliverables.flatMap(([id, fm]) => deliverableViolationsOf(id, fm)),
		...risks.flatMap(([id, fm]) => riskViolationsOf(id, fm)),
	];

	if (argv.includes('--json')) {
		console.log(JSON.stringify({ checked, decisions: decisions.length, deliverables: deliverables.length, risks: risks.length, violations }, null, 2));
	} else if (violations.length) {
		console.error(`✖ plan records: ${violations.length} violation(s) across ${checked} records`);
		for (const v of violations) console.error(`  ${v}`);
	} else {
		console.log(`✔ plan records: ${checked} checked, 0 violations (${decisions.length} decisions, ${deliverables.length} deliverables, ${risks.length} risks)`);
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
