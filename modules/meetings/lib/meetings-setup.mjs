// The meetings setup provider: which calendars count as work (WORK_CALENDARS) and whether each
// account they name has local credentials. One read-only `inspect` feeds the setup board and the
// plan; the one deterministic action merges calendar rows into the workspace `.env`. The live
// calendar check is the existing `gcal.mjs access`, run only with the owner's approval.
//
// Read SETUP.md beside this package for the conversation that uses it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkCalendars } from '../skills/fetching-meetings/bin/gcal.mjs';
import { SETUP_PROTOCOL, SetupRefusal, boardState, workspaceIdentity, realish, fingerprint, writeScoped, envAssignments, setEnvValue, safeEnvValue, gitExposure, runGit, leftoverTemps, tempPrefix } from './setup-kit.mjs';

export const SETUP_PROVIDER = Object.freeze({
	protocol: SETUP_PROTOCOL,
	module: '@dreamteamer/meetings',
	checks: Object.freeze(['meetings.work-calendars', 'meetings.oauth-client', 'meetings.credential-files', 'meetings.account-access']),
	actions: Object.freeze(['add-calendar-rows', 'verify-calendar-access']),
});

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
	const found = envAssignments(text, KEY);
	return found.length ? { source: '.env', text: found.at(-1).value } : { source: 'none', text: '' };
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

	add({ id: 'meetings.account-access', label: 'account access', status: 'unverified', detail: 'File presence does not prove consent, expiry, scopes or remote access. No network request was made.', fix: 'After owner consent, run an explicit read-only test for each configured calendar/account.' });
	return { protocol: SETUP_PROTOCOL, module: SETUP_PROVIDER.module, checks };
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

/** This module's setup script, resolved from where this provider was actually loaded and made relative
 *  to the workspace: `bin/setup.mjs` in the package itself, or the prefixed copy a composed package
 *  carries — so a planned command names a file that exists on every install channel. */
function script(root) {
	const own = ['../bin/meetings-setup.mjs', '../bin/setup.mjs'].map((rel) => fileURLToPath(new URL(rel, import.meta.url))).find((f) => fs.existsSync(f));
	return path.relative(root, own).split(path.sep).join('/');
}
const cliArgs = (root, rest) => ['node', script(root), ...rest, '--workspace', root];

/** The calendar-row action for these inputs: what it would write, or why it will not. */
function calendarRowsAction(workspace, env, inputs, git) {
	const action = { id: 'add-calendar-rows', title: 'Add work calendar rows to the workspace .env', kind: 'local', runBy: 'agent', effects: ['workspace-file: .env (WORK_CALENDARS only; every other line is kept byte for byte)'] };
	if (!inputs.length) return { ...action, state: 'needs-input', reason: 'Ask for each work calendar: calendar id, default company id (or mixed) and the account email that reads it.' };
	const parsed = inputs.map(parseRow);
	const bad = parsed.map((r, i) => (r ? null : i + 1)).filter(Boolean);
	if (bad.length) return { ...action, state: 'blocked', reason: `Row input ${bad.join(', ')} is not calendar-id | company-id-or-mixed | account-email with plain characters.` };
	if (env[KEY]) return { ...action, state: 'blocked', reason: 'WORK_CALENDARS is set in the process environment, which takes precedence over .env; change it where it is set instead.' };
	const envPath = path.join(workspace.root, '.env');
	let expect;
	try { expect = fingerprint(envPath); } catch (error) { return { ...action, state: 'blocked', reason: error instanceof SetupRefusal ? error.message : 'The .env file cannot be read.' }; }
	const leftovers = leftoverTemps(envPath);
	if (leftovers.length) return { ...action, state: 'blocked', reason: `${leftovers.length} temporary file(s) from an interrupted write sit beside .env (${tempPrefix(envPath)}*.tmp). They may hold account addresses and may not be ignored by Git: review and delete them first.` };
	const exposure = gitExposure(workspace.root, '.env', { git });
	if (!exposure.safe) return { ...action, state: 'blocked', reason: exposure.reason };
	const text = expect === 'absent' ? '' : fs.readFileSync(envPath, 'utf8');
	const found = envAssignments(text, KEY);
	if (found.length > 1) return { ...action, state: 'blocked', reason: 'WORK_CALENDARS is assigned more than once in .env; resolve that by hand first.' };
	const current = found[0]?.value ?? '';
	if (current && !safeEnvValue(current)) return { ...action, state: 'blocked', reason: 'The existing WORK_CALENDARS value contains characters this action does not rewrite; edit it by hand.' };
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
	if (!additions.length) return { ...action, state: 'done', reason: 'Every requested row is already configured.' };
	const value = [current, ...additions.map((r) => r.line)].filter(Boolean).join('\n');
	return {
		...action, state: 'ready', inputs: parsed.map((r) => r.line),
		preview: { file: '.env', expect, vcs: exposure.vcs, change: found.length ? 'update WORK_CALENDARS' : expect === 'absent' ? 'create .env with WORK_CALENDARS' : 'append WORK_CALENDARS', keeps: existing.rows.length, adds: additions.map((r) => r.line), otherLines: 'unchanged' },
		command: cliArgs(workspace.root, ['apply', 'add-calendar-rows', '--expect', expect, ...parsed.flatMap((r) => ['--row', r.line])]),
		content: setEnvValue(text, KEY, value),
	};
}

/** What can be done next, each with its effects. Writes nothing; the only process it may start is
 *  read-only Git, asking whether `.env` is tracked or ignored (only when rows are given). */
export function plan({ root, env = process.env, home = os.homedir(), rows = [], git = runGit } = {}) {
	const workspace = workspaceIdentity(root);
	const { checks } = inspect({ root: workspace.root, env, home });
	const status = Object.fromEntries(checks.map((c) => [c.id, c.status]));
	const { content, ...rowsAction } = calendarRowsAction(workspace, env, rows, git);
	const unmet = ['meetings.work-calendars', 'meetings.oauth-client', 'meetings.credential-files'].filter((id) => status[id] !== 'configured');
	const verify = {
		id: 'verify-calendar-access', title: 'Owner-approved live check of every configured calendar', kind: 'live', runBy: 'owner',
		effects: ['network: refreshes each configured account\'s token at Google and lists its calendars', 'account-access: reads calendar names and access roles; the output is private and is not repeated'],
		state: unmet.length ? 'blocked' : 'ready', ...(unmet.length ? { reason: `Complete first: ${unmet.join(', ')}.` } : {}),
		command: ['node', GCAL, 'access'],
		evidence: 'Every row reports verdict full. Report the count of full, free-busy and absent rows only.',
	};
	return { protocol: SETUP_PROTOCOL, module: SETUP_PROVIDER.module, workspace, checks, actions: [rowsAction, verify] };
}

/** Perform the calendar-row action after its preview was approved, then report the fresh checks. */
export function apply({ root, action, expect, workspace: claimed, rows = [], env = process.env, home = os.homedir(), git = runGit } = {}) {
	const workspace = workspaceIdentity(root);
	if (!claimed || realish(claimed) !== workspace.root) throw new SetupRefusal('workspace', 'The --workspace given does not match the workspace this command runs in. Nothing was changed.');
	if (action !== 'add-calendar-rows') throw new SetupRefusal('action', SETUP_PROVIDER.actions.includes(action) ? 'That step is the account owner\'s: run its command from the plan yourself after explicit approval.' : 'Unknown action.');
	const step = calendarRowsAction(workspace, env, rows, git);
	if (step.state === 'done') return { action, changed: false, reason: step.reason, workspace, checks: inspect({ root: workspace.root, env, home }).checks };
	if (step.state !== 'ready') throw new SetupRefusal(step.state === 'needs-input' ? 'usage' : 'blocked', step.reason);
	if (!expect || step.preview.expect !== expect) throw new SetupRefusal('stale', 'The .env file changed after the preview. Nothing was written; inspect and plan again.');
	// Git is asked again after the new content is on disk and just before the rename: a `git add -f` or
	// an edited .gitignore since the plan stops the write and removes the temporary file.
	const recheck = () => { const now = gitExposure(workspace.root, '.env', { git }); if (!now.safe) throw new SetupRefusal('blocked', now.reason); };
	writeScoped({ root: workspace.root, rel: '.env', content: step.content, expected: expect, recheck });
	return { action, changed: true, wrote: '.env', added: step.preview.adds.length, workspace, checks: inspect({ root: workspace.root, env, home }).checks };
}
