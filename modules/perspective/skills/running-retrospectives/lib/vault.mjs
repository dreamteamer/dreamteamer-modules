// Where things are, and the three template variables — the only module-level knowledge of the machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The workspace root: the nearest ancestor carrying package-lock.json (NOT package.json — a module folder carries one too). */
// ⚠ A GIT MODULE IS NOT A VAULT, and the lockfile heuristic cannot tell on its own. The rule is
// "walk up to the directory carrying package-lock.json, not package.json, because a module folder
// carries one of those too" — and the moment this module declared a dependency so it could test
// itself, `npm install` in the clone gave it a LOCKFILE as well. A reader running from
// `git_modules/perspective/skills/…` then resolved the CLONE as the workspace and wrote 53 records
// into it, where `check` could not see them and the next `git pull` would have destroyed them.
// Measured 2026-09-08, ten minutes after the lockfile appeared.
//
// So the walk skips any candidate that sits directly inside a `git_modules/` folder: that is what a
// clone IS, structurally, and no vault is ever placed there.
export const VAULT = (() => {
	for (let d = HERE; ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) throw new Error('workspace root not found (no package-lock.json above ' + HERE + ')');
	}
})();
export const DATA = path.join(VAULT, 'data');
export const SCRATCH = path.join(VAULT, '.perspective');

/** Parse .env for NAME=value lines. Values stay in-process; nothing here prints them. */
export function readEnv(file = path.join(VAULT, '.env')) {
	const out = {};
	if (!fs.existsSync(file)) return out;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (!m) continue;
		let v = m[2];
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		out[m[1]] = v;
	}
	return out;
}

/** Run the dreamteamer CLI in the vault; returns stdout. Throws with stderr on failure. */
export function dt(args, { input } = {}) {
	const bin = path.join(VAULT, 'node_modules', '.bin', 'dreamteamer');
	return execFileSync(bin, args, { cwd: VAULT, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The three engine template variables → a real path on THIS machine. An unset var throws, never guesses.
 *  (No sample variable name appears here on purpose: bin/tests/env-contract.test.mjs reads an env
 *  template written in a comment as a real undeclared key — the trap KEY and EMPTYVAR are allowlisted for.) */
export function render(template, env = readEnv()) {
	return template
		.replace(/\$\{userHome\}/g, os.homedir())
		.replace(/\$\{workspaceFolder\}/g, VAULT)
		.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, k) => {
			const v = process.env[k] ?? env[k];
			if (v === undefined || v === '') throw new Error(`\${env:${k}} is not set — records never travel resolved`);
			return v.replace(/^~(?=\/|$)/, os.homedir());
		});
}

/** The inverse: a real path → the template a record may carry. Longest-prefix wins; unknown prefixes stay absolute (check-records will refuse them). */
export function templatize(abs, env = readEnv()) {
	const cands = [];
	const repos = (process.env.REPOS_FOLDER ?? env.REPOS_FOLDER ?? '').replace(/^~(?=\/|$)/, os.homedir());
	if (repos) cands.push([repos, '${env:REPOS_FOLDER}']);
	cands.push([VAULT, '${workspaceFolder}'], [os.homedir(), '${userHome}']);
	cands.sort((a, b) => b[0].length - a[0].length);
	for (const [pre, tpl] of cands) if (abs === pre || abs.startsWith(pre + '/')) return tpl + abs.slice(pre.length);
	return abs;
}

/** ISO-8601 week label, e.g. 2026-W36. */
export function isoWeek(d) {
	const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const day = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - day);
	const y = t.getUTCFullYear();
	const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
	return `${y}-W${String(w).padStart(2, '0')}`;
}

/** The Monday and Sunday of an ISO week, as `YYYY-MM-DD` — the inverse of `isoWeek`. A week record
 *  carries `period` as its forcing field, but a gantt cannot draw `2026-W36`; it needs two dates, and
 *  deriving them everywhere a view is drawn is how three views end up with three Mondays. So the
 *  reader derives them ONCE, here, and writes them onto the record. ISO 8601: week 1 is the week
 *  containing the year's first Thursday, so it may start in December. */
export function isoWeekRange(period) {
	const m = /^(\d{4})-W(\d{2})$/.exec(String(period));
	if (!m) throw new Error(`not an ISO week: ${period}`);
	const [y, w] = [Number(m[1]), Number(m[2])];
	const jan4 = new Date(Date.UTC(y, 0, 4));                       // always in week 1
	const mondayOfW1 = new Date(jan4); mondayOfW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
	const start = new Date(mondayOfW1); start.setUTCDate(mondayOfW1.getUTCDate() + (w - 1) * 7);
	const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
	const iso = (d) => d.toISOString().slice(0, 10);
	return { start: iso(start), end: iso(end) };
}

export function slug(s) {
	return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
}
