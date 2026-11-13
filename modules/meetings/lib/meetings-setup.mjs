// The meetings setup: which calendars count as work (WORK_CALENDARS) and whether each account they name
// has local credentials. One read-only `inspect` feeds `dt status` and the plan; the calendar rows are an
// ENV ACTION — the unit merges the rows into the value, the engine writes it (confined, fingerprinted,
// refused when git would commit .env, never printed — cr-dt-007, D61). The live calendar check is the
// existing `gcal.mjs access`, run only with the owner's approval (`dt setup meetings --verify --authorize`).
//
// Read SETUP.md beside this package for the conversation that uses it.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkCalendars } from '../skills/fetching-meetings/bin/gcal.mjs';

/** The convention version and module name this setup's own reports carry (its rows, its plan). */
const PROTOCOL = 1;
const MODULE = '@dreamteamer/meetings';
/** A board row's state: present facts are ok, everything else warns. */
const boardState = (status) => (status === 'ready' || status === 'configured' ? 'ok' : 'warn');

const KEY = 'WORK_CALENDARS';
const GCAL = '.dreamteamer/skills/fetching-meetings/bin/gcal.mjs';
const nonemptyFile = (p) => { try { const st = fs.statSync(p); return st.isFile() && st.size > 0; } catch { return false; } };
// gcal.mjs names a credential file this way; the board must look where the reader will.
const credentialFile = (dir, email) => path.resolve(dir, `${encodeURIComponent(email).replace(/%40/g, '@')}.json`);
const lineNumbers = (errors) => errors.map((e) => Number(/line (\d+)/.exec(e)?.[1])).filter(Number.isFinite);

/** Where WORK_CALENDARS comes from, as gcal.mjs reads it: a nonempty process value, else `.env`. */
function workCalendars(root, env) {
	if (env[KEY]) return { source: 'environment', text: env[KEY] };
	let text = null;
	try { text = fs.readFileSync(path.join(root, '.env'), 'utf8'); } catch { return { source: 'none', text: '' }; }
	const found = dotenvValues(text, KEY);
	return found.length ? { source: '.env', text: found.at(-1) } : { source: 'none', text: '' };
}

/** Every value `.env` text assigns to `key`, read the way the engine reads `.env` (KEY=value, an optional
 *  `export `, a single- or double-quoted value that may span lines). Read-only: the write is the engine's. */
function dotenvValues(text, key) {
	const out = [];
	for (const m of String(text).matchAll(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\n]*)$/gm)) {
		if (m[1] !== key) continue;
		const v = m[2].trim();
		out.push((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v);
	}
	return out;
}

/** Every local fact, without the network, a process or any credential's contents. Rows carry counts
 *  and line numbers, never a calendar id, an account address or a path. */
export function inspect({ root, env = process.env, home = os.homedir() } = {}) {
	const checks = [];
	const add = (row) => checks.push({ ...row, state: boardState(row.status) });
	const config = workCalendars(root, env);
	const { rows, errors } = parseWorkCalendars(config.text);
	const valid = rows.length > 0 && errors.length === 0;
	add(valid
		? { id: 'meetings.work-calendars', label: 'WORK_CALENDARS', status: 'configured', detail: 'Calendar rows have three nonempty columns and an explicit account.', fix: '', evidence: { source: config.source, rows: rows.length } }
		: { id: 'meetings.work-calendars', label: 'WORK_CALENDARS', status: 'missing', detail: 'Unset or malformed calendar configuration.', fix: 'Set WORK_CALENDARS in the environment or .env: calendar-id | default-company | account-email, one row per calendar.', evidence: { source: config.source, rows: rows.length, malformedLines: lineNumbers(errors) } });

	const client = env.GOOGLE_CLIENT_SECRET_PATH ?? path.join(home, '.config', 'google-calendar-mcp', 'gcp-oauth.keys.json');
	add(nonemptyFile(client)
		? { id: 'meetings.oauth-client', label: 'OAuth client file', status: 'configured', detail: 'The OAuth client file the calendar reader uses is present; its contents are unverified.', fix: '', evidence: { source: env.GOOGLE_CLIENT_SECRET_PATH ? 'environment' : 'default' } }
		: { id: 'meetings.oauth-client', label: 'OAuth client file', status: 'missing', detail: 'The calendar reader has no OAuth client file at the configured or default location.', fix: 'Place a Desktop OAuth client file outside Git and export GOOGLE_CLIENT_SECRET_PATH in the shell that runs the calendar reader.', evidence: { source: env.GOOGLE_CLIENT_SECRET_PATH ? 'environment' : 'default' } });

	const dir = env.WORKSPACE_MCP_CREDENTIALS_DIR ?? path.join(home, '.config', 'google-workspace-mcp', 'credentials');
	const accounts = [...new Set(rows.map((r) => r.account))];
	const present = accounts.filter((a) => nonemptyFile(credentialFile(dir, a))).length;
	const dirSource = env.WORKSPACE_MCP_CREDENTIALS_DIR ? 'environment' : 'default';
	add(!valid
		? { id: 'meetings.credential-files', label: 'credential files', status: 'blocked', detail: 'Missing local files or invalid calendar rows; no credentials were read.', fix: 'Authorize each configured account through the Google Workspace onboarding flow and verify the selected credentials directory.', evidence: { accounts: accounts.length, present, directory: dirSource } }
		: present === accounts.length
			? { id: 'meetings.credential-files', label: 'credential files', status: 'configured', detail: 'A nonempty local credential file exists for each configured account; contents and validity are unverified.', fix: '', evidence: { accounts: accounts.length, present, directory: dirSource } }
			: { id: 'meetings.credential-files', label: 'credential files', status: 'missing', detail: 'Missing local files or invalid calendar rows; no credentials were read.', fix: 'Authorize each configured account through the Google Workspace onboarding flow and verify the selected credentials directory.', evidence: { accounts: accounts.length, present, directory: dirSource } });

	add({ id: 'meetings.account-access', label: 'account access', status: 'unverified', detail: 'File presence does not prove consent, expiry, scopes or remote access. No network request was made.', fix: 'dt setup meetings --verify --authorize' });
	return { protocol: PROTOCOL, module: MODULE, checks };
}

// ── input rows ──────────────────────────────────────────────────────────────────────────────────
// Stricter than the reader: a value written to `.env` must be inert in every parser and shell.
const CALENDAR = /^[A-Za-z0-9._+#-]+(@[A-Za-z0-9._-]+)?$/;
const COMPANY = /^(mixed|[a-z0-9][a-z0-9-]*)$/;
const ACCOUNT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** One `calendar-id | default-company | account-email` row, validated, or null. */
export function parseRow(text) {
	const cols = String(text ?? '').split('|').map((c) => c.trim());
	if (cols.length !== 3) return null;
	const [calendar, company, account] = cols;
	if (calendar.length > 254 || !CALENDAR.test(calendar) || !COMPANY.test(company) || !ACCOUNT.test(account)) return null;
	return { calendar, company, account, line: `${calendar} | ${company} | ${account}` };
}

/** The calendar-row action for these inputs: the merged WORK_CALENDARS the engine is to write, or why it
 *  will not. The merge is the unit's — keep every configured row, add the new ones, refuse a conflict or a
 *  malformed existing row; whether the file already holds the value, and the write, are the engine's. */
function calendarRowsAction(root, env, inputs) {
	const action = { id: 'add-calendar-rows', title: 'Add work calendar rows to the workspace .env', effects: [{ kind: 'workspace-files', detail: '.env (WORK_CALENDARS only; every other line is kept byte for byte)' }] };
	if (!inputs.length) {
		// no row given: done when valid rows are already configured (held-out hm1), otherwise ask for one
		const configured = parseWorkCalendars(workCalendars(root, env).text);
		if (configured.rows.length && !configured.errors.length) return { ...action, state: 'done', reason: 'The work calendars are configured; give a row to add another.' };
		return { ...action, state: 'needs-input', reason: 'Ask for each work calendar: calendar id, default company id (or mixed) and the account email that reads it.' };
	}
	const parsedAll = inputs.map(parseRow);
	const bad = parsedAll.map((r, i) => (r ? null : i + 1)).filter(Boolean);
	if (bad.length === parsedAll.length) return { ...action, state: 'blocked', reason: `Row input ${bad.join(', ')} is not calendar-id | company-id-or-mixed | account-email with plain characters.` };
	// a mixed batch: the valid rows go in, the malformed ones are named by input number and left out
	const parsed = parsedAll.filter(Boolean);
	if (env[KEY]) return { ...action, state: 'blocked', reason: 'WORK_CALENDARS is set in the process environment, which takes precedence over .env; change it where it is set instead.' };
	let text = '';
	try { text = fs.readFileSync(path.join(root, '.env'), 'utf8'); } catch { /* no .env yet */ }
	const found = dotenvValues(text, KEY);
	if (found.length > 1) return { ...action, state: 'blocked', reason: 'WORK_CALENDARS is assigned more than once in .env; resolve that by hand first.' };
	const current = found[0] ?? '';
	const existing = parseWorkCalendars(current);
	if (existing.errors.length) return { ...action, state: 'blocked', reason: `The existing WORK_CALENDARS has malformed line(s) ${lineNumbers(existing.errors).join(', ')}; fix them by hand first.` };
	const additions = [];
	const conflicts = [];
	for (const [i, row] of parsed.entries()) {
		const same = existing.rows.find((r) => r.calendar === row.calendar && r.account === row.account) ?? additions.find((r) => r.calendar === row.calendar && r.account === row.account);
		if (!same) additions.push(row);
		else if ((same.mixed ? 'mixed' : same.company) !== row.company) conflicts.push(`row input ${i + 1} names a calendar and account already configured with a different default company`);
	}
	if (conflicts.length) return { ...action, state: 'blocked', reason: `Conflict, nothing changed: ${conflicts.join('; ')}. Edit the existing row by hand if the company changed.` };
	const skipped = bad.length ? { skipped: bad } : {};
	if (!additions.length) return { ...action, env: { [KEY]: current }, state: 'done', reason: 'Every requested row is already configured.', preview: { adds: 0, ...skipped } };
	// the reason is printed after the engine's write: how many rows went in, and which inputs were left out
	const note = `${additions.length} row(s) added, every other line kept${bad.length ? `; Row input ${bad.join(', ')} skipped: not calendar-id | company-id-or-mixed | account-email` : ''}`;
	return { ...action, env: { [KEY]: [current, ...additions.map((r) => r.line)].filter(Boolean).join('\n') }, state: 'ready', reason: note, preview: { keeps: existing.rows.length, adds: additions.length, ...skipped } };   // counts only: a row names an account, and a pending action is printed whole
}

/** What can be done next, each with its effects. Writes nothing and starts nothing. */
export function plan({ root, env = process.env, home = os.homedir(), rows = [] } = {}) {
	const workspace = { root: fs.realpathSync(root) };
	const { checks } = inspect({ root: workspace.root, env, home });
	const status = Object.fromEntries(checks.map((c) => [c.id, c.status]));
	const rowsAction = calendarRowsAction(workspace.root, env, rows);
	const unmet = ['meetings.work-calendars', 'meetings.oauth-client', 'meetings.credential-files'].filter((id) => status[id] !== 'configured');
	const verify = {
		id: 'verify-calendar-access', title: 'Owner-approved live check of every configured calendar', kind: 'live', runBy: 'owner',
		effects: ['network: refreshes each configured account\'s token at Google and lists its calendars', 'account-access: reads calendar names and access roles; the output is private and is not repeated'],
		state: unmet.length ? 'blocked' : 'ready', ...(unmet.length ? { reason: `Complete first: ${unmet.join(', ')}.` } : {}),
		command: ['node', GCAL, 'access'],
		evidence: 'Every row reports verdict full. Report the count of full, free-busy and absent rows only.',
	};
	return { protocol: PROTOCOL, module: MODULE, workspace, checks, actions: [rowsAction, verify] };
}

// ── the SETUP UNIT ──────────────────────────────────────────────────────────────────────────────
// What the engine's `dt install`, `dt setup` and `dt status` drive (setup contribution, version 1):
// the same inspect and plan; the calendar rows an env action the engine writes, `apply` the live check
// only. The live
// calendar check is the owner's — runBy 'owner', run only under `dt setup meetings --verify --authorize`
// in a terminal — and a passing one leaves a dated receipt the next inspect turns into `ready`.
const RECEIPT = 'calendar-access.verified.json';
const receiptOf = (ctx) => { try { return JSON.parse(fs.readFileSync(path.join(ctx.receiptDir, RECEIPT), 'utf8')); } catch { return null; } };
/** What a receipt proved — the configured calendar/account pairs — as a short digest, never the addresses. */
export const calendarsDigest = (rows) => createHash('sha256').update(rows.map((r) => `${r.calendar}|${r.account}`).sort().join('\n')).digest('hex').slice(0, 16);
/** The environment the module's own functions read. The engine lays the workspace .env UNDER the
 *  process environment, so a WORK_CALENDARS it merged from .env would read here as a shadowing process
 *  value and block every later row: a value equal to what .env holds is .env's, and is left out. A
 *  genuinely different process value still wins, as the calendar reader reads it. */
function moduleEnv(ctx) {
	const env = { ...ctx.env };
	if (env[KEY] !== undefined) {
		let text = '';
		try { text = fs.readFileSync(path.join(ctx.root, '.env'), 'utf8'); } catch { /* no .env */ }
		const found = dotenvValues(text, KEY);
		if (found.length && String(found.at(-1)).trim() === String(env[KEY]).trim()) delete env[KEY];
	}
	return env;
}
const unitEffect = (text) => { const m = /^([a-z-]+):\s*(.*)$/s.exec(text); const kind = { 'workspace-file': 'workspace-files', 'account-access': 'account', network: 'network' }[m?.[1]] ?? 'machine'; return { kind, detail: m ? m[2] : text }; };

function unitInspect(ctx) {
	const env = moduleEnv(ctx);
	const { checks } = inspect({ root: ctx.root, env });
	const receipt = receiptOf(ctx);
	// a receipt counts only for the rows it proved: a calendar added or removed since is unverified again
	const current = calendarsDigest(parseWorkCalendars(workCalendars(ctx.root, env).text).rows);
	const proven = receipt && receipt.digest === current;
	// a row this module calls `blocked` only because the calendar rows are not in yet is `missing` to the
	// engine (an input fixes it); `blocked` is kept for what no input fixes
	const rowsMissing = checks.some((c) => c.id === 'meetings.work-calendars' && c.status === 'missing');
	return { checks: checks.map((c) => {
		const status = c.status === 'blocked' && rowsMissing ? 'missing' : c.status;
		const row = { id: c.id, status, title: c.label, detail: c.detail, fix: c.fix, evidence: c.evidence };
		if (c.id === 'meetings.account-access' && proven) return { ...row, status: 'ready', detail: `every configured calendar answered on this computer (${receipt.rows} row(s))`, evidence: { at: receipt.at, rows: receipt.rows } };
		if (c.id === 'meetings.account-access' && receipt) return { ...row, detail: `the calendars changed since the last verified read (${receipt.at}); verify again`, evidence: { at: receipt.at, rows: receipt.rows } };
		return row;
	}) };
}

function unitPlan(ctx, inputs = {}) {
	const rows = Array.isArray(inputs.calendar) ? inputs.calendar : inputs.calendar ? [inputs.calendar] : [];
	const p = plan({ root: ctx.root, env: moduleEnv(ctx), rows });
	const actions = p.actions.map((a) => (a.env !== undefined || a.id === 'add-calendar-rows' ? a : {
		...a, title: a.title ?? a.id,
		effects: (a.effects ?? []).map(unitEffect),
		runBy: a.runBy === 'owner' ? 'owner' : 'engine',
		...(a.id === 'verify-calendar-access' ? { kind: 'verify' } : {}),
	}));
	const rowsDone = actions.find((a) => a.id === 'add-calendar-rows')?.state === 'done';
	return { checks: unitInspect(ctx).checks, actions, needs: rows.length || rowsDone ? [] : ['calendar'] };
}

function unitApply(ctx, action, inputs = {}) {
	try {
		if (action.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${action.reason ?? 'already configured'}` };
		if (action.id === 'verify-calendar-access') {
			if (!action.command) return { ok: false, changed: [], message: action.reason ?? 'not ready' };
			const r = spawnSync(action.command[0], action.command.slice(1), { cwd: ctx.root, env: ctx.env, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', timeout: 600_000 });
			if (r.status !== 0) return { ok: false, changed: [], message: `${action.command.slice(0, 2).join(' ')} exited ${r.status ?? r.error?.message}` };
			// exit 0 is not the verdict: the live check prints one row per calendar, and only `full` on every
			// row is access — absent or free-busy rows fail the verify with counts (the ids stay private)
			let answered;
			try { answered = JSON.parse(r.stdout).rows; } catch { return { ok: false, changed: [], message: 'the live check printed no readable rows — nothing verified' }; }
			if (!Array.isArray(answered) || !answered.length) return { ok: false, changed: [], message: 'the live check printed no rows — nothing verified' };
			const notFull = answered.filter((row) => row.verdict !== 'full');
			if (notFull.length) {
				const counts = Object.entries(notFull.reduce((acc, row) => ({ ...acc, [row.verdict ?? 'unknown']: (acc[row.verdict ?? 'unknown'] ?? 0) + 1 }), {})).map(([k, v]) => `${k}: ${v}`).join(', ');
				return { ok: false, changed: [], message: `${notFull.length} of ${answered.length} calendar(s) not readable (${counts}) — share each calendar with its account, then verify again` };
			}
			fs.mkdirSync(ctx.receiptDir, { recursive: true });
			const { rows } = parseWorkCalendars(workCalendars(ctx.root, moduleEnv(ctx)).text);
			fs.writeFileSync(path.join(ctx.receiptDir, RECEIPT), JSON.stringify({ what: 'every configured calendar answered', rows: rows.length, digest: calendarsDigest(rows), at: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
			return { ok: true, changed: [path.join(ctx.receiptDir, RECEIPT)], message: 'calendar access verified — receipt written' };
		}
		return { ok: false, changed: [], message: `unknown action ${action.id}` };
	} catch (error) {
		return { ok: false, changed: [], message: error.message };   // the engine redacts a failed apply's message (D67)
	}
}

export const SETUP_UNIT = Object.freeze({
	id: 'meetings', version: 1,
	inputs: [{ id: 'calendar', kind: 'rows', env: 'WORK_CALENDARS', required: false, title: 'work calendars', prompt: 'A work calendar: calendar id | default company id (or mixed) | account email', rows: { columns: ['calendar id', 'default company', 'account'] } }],
	inspect: unitInspect, plan: unitPlan, apply: unitApply,
});
