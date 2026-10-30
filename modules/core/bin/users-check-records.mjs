#!/usr/bin/env node
// The users guard: the agent rules the `users` schema does not state. An agent row names a
// `human_owner`, that owner is itself a human, and a human row carries no agent-only field.
//
//   node node_modules/@dreamteamer/core/bin/users-check-records.mjs   (installed from npm)
//   node modules/core/bin/users-check-records.mjs                      (a copy under modules/)
//   … [--data-root <dir>] [--json]
//
// Chain it after `dreamteamer check` in the workspace's `check` script. Exit 0 clean, 1 with
// violations. An agent owned by nobody, or by another agent, has no human accountable for it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A reference as it may be written — `users/dana-oren` or the bare id — reduced to the id. */
const idOf = (ref) => String(ref).trim().replace(/^.*\//, '');

/** The violations in one `users` record. Pure. `usersById` maps user id → frontmatter. */
export function userViolationsOf(id, record, usersById = new Map()) {
	const out = [];
	const has = (f) => record[f] !== undefined && record[f] !== null && record[f] !== '' && !(Array.isArray(record[f]) && !record[f].length);
	const kind = record.kind ?? 'human';
	if (kind === 'agent') {
		if (!has('human_owner')) out.push(`${id}: \`kind: agent\` needs \`human_owner\` — the human accountable for what it does`);
		else {
			const owner = usersById.get(idOf(record.human_owner));
			if (owner && (owner.kind ?? 'human') === 'agent') out.push(`${id}: \`human_owner\` points at \`${idOf(record.human_owner)}\`, which is itself an agent — the owner must be a human`);
		}
	} else {
		if (has('human_owner')) out.push(`${id}: \`human_owner\` on a \`kind: ${kind}\` row — only an agent has an owner; drop the field or set \`kind: agent\``);
		if (has('agent')) out.push(`${id}: \`agent\` on a \`kind: ${kind}\` row — only an agent row names its entity; drop the field or set \`kind: agent\``);
	}
	return out;
}

/** Frontmatter scalars only — no rule here reads a list or the body. */
export function frontmatter(text) {
	if (!text.startsWith('---\n')) return {};
	const end = text.indexOf('\n---', 4);
	if (end < 0) return {};
	const out = {};
	for (const line of text.slice(4, end).split('\n')) {
		const m = /^([a-z_]+):\s*(.*)$/.exec(line);
		if (!m) continue;
		const v = m[2].trim();
		out[m[1]] = v === '' ? '' : v.replace(/^['"]|['"]$/g, '');
	}
	return out;
}

function main() {
	const argv = process.argv.slice(2);
	const i = argv.indexOf('--data-root');
	const dir = path.join(path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : 'data'), 'users');
	const users = fs.existsSync(dir)
		? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.user.md'))
			.map((f) => [f.replace(/\.user\.md$/, ''), frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'))])
		: [];
	const usersById = new Map(users.map(([id, fm]) => [idOf(id), fm]));
	const violations = users.flatMap(([id, fm]) => userViolationsOf(id, fm, usersById));
	if (argv.includes('--json')) console.log(JSON.stringify({ checked: users.length, violations }, null, 2));
	else if (violations.length) {
		console.error(`✖ users: ${violations.length} violation(s) across ${users.length} records`);
		for (const v of violations) console.error(`  ${v}`);
	} else console.log(`✔ users: ${users.length} checked, 0 violations`);
	process.exit(violations.length ? 1 : 0);
}

// Both sides realpath'd: reached through a symlink (an npm link, a git_modules clone) the invoked
// path and the resolved one differ, and a guard that silently never runs reads as a clean pass.
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};
if (isMain()) main();
