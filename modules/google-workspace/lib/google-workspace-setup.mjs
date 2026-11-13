// The google-workspace SETUP UNIT — what the engine's `dt install`, `dt setup` and `dt status` drive
// (setup contribution, version 1). It wraps the module's own inspect / plan / apply (google-setup.mjs):
// the checks are the same rows, the actions the same actions, with each effect as { kind, detail } and
// the planned action handed back to apply verbatim (its preview carries the target and parent id the
// apply is bound to). One action is the unit's own: the two paths the person named are recorded in the
// workspace `.env`, so the next `dt status` and the next `dt setup` read them back rather than forget
// them. Sign-in and the live read stay the owner's — runBy 'owner', run only under
// `dt setup google-workspace --authorize` in a terminal — and a successful live read leaves a dated
// receipt the next inspect turns into `ready`, for as long as that account's credential is still stored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspect as inspectLocal, plan as planLocal, apply as applyLocal } from './google-setup.mjs';
import { credentialPath } from './access.mjs';
import { SetupRefusal, redact, fingerprint, writeScoped, envAssignments, setEnvValue, safeEnvValue, gitExposure, runGit, leftoverTemps, tempPrefix } from './setup-kit.mjs';

export const UNIT_ID = 'google-workspace';
const DEFAULT_STORE = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'credentials');
const KEYS = { credentials_dir: 'WORKSPACE_MCP_CREDENTIALS_DIR', client_secret: 'GOOGLE_CLIENT_SECRET_PATH' };

/** The home the unit judges paths against: the environment's (a test's temp HOME included), else the process's. */
const homeOf = (ctx) => (ctx.env?.HOME && String(ctx.env.HOME).trim() ? ctx.env.HOME : os.homedir());

/** The environment the module's own functions read, with the unit's inputs laid over it. */
const envWith = (ctx, inputs = {}) => ({
	...ctx.env,
	...(inputs.client_secret ? { GOOGLE_CLIENT_SECRET_PATH: inputs.client_secret } : {}),
	...(inputs.credentials_dir ? { WORKSPACE_MCP_CREDENTIALS_DIR: inputs.credentials_dir } : {}),
});
const SUFFIX = '.verified.json';
const receiptFile = (ctx, account) => path.join(ctx.receiptDir, `${encodeURIComponent(account)}${SUFFIX}`);
/** Every receipt, with the account it was written for (an older receipt carries it only in its name). */
const receipts = (ctx) => {
	try {
		return fs.readdirSync(ctx.receiptDir).filter((f) => f.endsWith(SUFFIX)).map((f) => {
			const r = JSON.parse(fs.readFileSync(path.join(ctx.receiptDir, f), 'utf8'));
			return { ...r, account: r.account ?? decodeURIComponent(f.slice(0, -SUFFIX.length)) };
		});
	} catch { return []; }
};

/** One effect string of the module ('kind: detail') as the engine's { kind, detail }; the module's
 *  'machine-file' and 'account-access' spellings map onto the engine's five kinds. */
const KIND = { 'machine-file': 'machine', 'account-access': 'account', network: 'network', download: 'download', 'workspace-file': 'workspace-files' };
const effect = (text) => { const m = /^([a-z-]+):\s*(.*)$/s.exec(text); return m ? { kind: KIND[m[1]] ?? m[1], detail: m[2] } : { kind: 'machine', detail: text }; };

export function inspect(ctx) {
	const env = envWith(ctx);
	const { checks } = inspectLocal({ root: ctx.root, env });
	const by = Object.fromEntries(checks.map((c) => [c.id, c.status]));
	// a receipt counts only while the credential it proved is still stored: an account whose file is gone
	// has to be signed in and read again
	const store = by['google.credential-store'] === 'configured' ? env.WORKSPACE_MCP_CREDENTIALS_DIR : null;
	const seen = receipts(ctx).filter((r) => store && r.account && fs.existsSync(credentialPath(store, r.account)));
	// the module says `blocked` for a row it cannot evaluate until an INPUT arrives; to the engine that
	// is `missing` (an input fixes it), and so is the runtime row (an owner install fixes it — D59). `blocked`
	// is kept for what nothing the person does next fixes: a store other users can read, a client file
	// inside the workspace — the rows that must be undone first
	const pathsMissing = by['google.client-config'] !== 'configured' || by['google.credential-store'] !== 'configured';
	const status = (c) => {
		if (c.status !== 'blocked') return c.status;
		if (c.id === 'google.runtime') return 'missing';   // uvx absent: an owner install fixes it — the module degrades to configured, naming it (D59)
		if (c.id === 'google.stored-accounts' && by['google.credential-store'] !== 'configured') return 'missing';
		if (c.id === 'google.credential-placement' && pathsMissing && !/Unsafe placement/.test(c.detail)) return 'missing';
		return 'blocked';
	};
	return { checks: checks.map((c) => {
		// the fix of a row is the command that settles it; the sign-in is `dt setup <unit> --authorize`
		const row = { id: c.id, status: status(c), title: c.label, detail: c.detail, fix: c.id === 'google.account-authorization' ? `dt setup ${UNIT_ID} --authorize` : c.fix, evidence: c.evidence };
		// the one check only a live read settles: a receipt from `verify-account-read` makes it ready, dated
		if (c.id === 'google.account-authorization' && seen.length) {
			const latest = seen.map((r) => r.at).sort().at(-1);
			return { ...row, status: 'ready', detail: `${seen.length} account(s) verified on this computer`, evidence: { at: latest, accounts: seen.length } };
		}
		return row;
	}) };
}

/** The unit's own action: the paths the person named, written into the workspace `.env` so the next
 *  call reads them back. Only the two keys are touched; every other line is kept byte for byte. */
function settingsAction(ctx, inputs = {}) {
	const action = { id: 'record-settings', title: 'record the credential store and the OAuth client file in the workspace .env', effects: [{ kind: 'workspace-files', detail: '.env: WORKSPACE_MCP_CREDENTIALS_DIR and GOOGLE_CLIENT_SECRET_PATH only, every other line kept' }], runBy: 'engine' };
	const want = { [KEYS.credentials_dir]: inputs.credentials_dir ?? ctx.env?.WORKSPACE_MCP_CREDENTIALS_DIR, [KEYS.client_secret]: inputs.client_secret ?? ctx.env?.GOOGLE_CLIENT_SECRET_PATH };
	if (!want[KEYS.credentials_dir]) return { ...action, state: 'needs-input', reason: 'credentials_dir is required' };
	const envPath = path.join(ctx.root, '.env');
	let expect;
	try { expect = fingerprint(envPath); } catch (e) { return { ...action, state: 'blocked', reason: e instanceof SetupRefusal ? e.message : 'the .env file cannot be read' }; }
	if (leftoverTemps(envPath).length) return { ...action, state: 'blocked', reason: `temporary files from an interrupted write sit beside .env (${tempPrefix(envPath)}*.tmp) — review and delete them first` };
	const exposure = gitExposure(ctx.root, '.env', { git: runGit });
	if (!exposure.safe) return { ...action, state: 'blocked', reason: exposure.reason };
	let text = expect === 'absent' ? '' : fs.readFileSync(envPath, 'utf8');
	const changes = [];
	for (const [k, v] of Object.entries(want)) {
		if (!v) continue;
		if (!safeEnvValue(String(v))) return { ...action, state: 'blocked', reason: `${k}: a value with characters this action does not write — set it by hand` };
		const found = envAssignments(text, k);
		if (found.length > 1) return { ...action, state: 'blocked', reason: `${k} is assigned more than once in .env — resolve that by hand first` };
		if (found[0]?.value === String(v)) continue;
		changes.push(k);
		text = setEnvValue(text, k, String(v));
	}
	if (!changes.length) return { ...action, state: 'done', reason: 'the workspace .env already holds these paths' };
	return { ...action, state: 'ready', expect, preview: { file: '.env', expect, sets: changes, keeps: 'every other line' }, content: text };
}

export function plan(ctx, inputs = {}) {
	const env = envWith(ctx, inputs);
	const accounts = inputs.account ? [inputs.account] : [];
	const p = planLocal({ root: ctx.root, env, accounts, home: homeOf(ctx) });
	const needs = [];
	if (!env.GOOGLE_CLIENT_SECRET_PATH) needs.push('client_secret');   // a sign-in prerequisite, not an install one (D41)
	if (!accounts.length) needs.push('account');
	const { content, ...settings } = settingsAction(ctx, inputs);   // the merged .env text is recomputed by apply, never carried
	const actions = [settings, ...p.actions.map((a) => ({
		id: a.id, title: a.title ?? a.id, account: a.account,
		effects: (a.effects ?? []).map(effect),
		preview: a.preview, command: a.command, evidence: a.evidence,
		runBy: a.runBy === 'owner' ? 'owner' : 'engine',
		...(a.id === 'verify-account-read' ? { kind: 'verify' } : {}),
		state: a.state === 'needs-input' ? 'needs-input' : a.state,
		...(a.reason ? { reason: a.reason } : {}),
	}))];
	return { checks: inspect(ctx).checks, actions, needs };
}

export function apply(ctx, action, inputs = {}) {
	const env = envWith(ctx, inputs);
	try {
		if (action.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${action.reason ?? 'already done'}` };
		if (action.id === 'record-settings') {
			const now = settingsAction(ctx, inputs);
			if (now.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${now.reason}` };
			if (now.state !== 'ready') return { ok: false, changed: [], message: now.reason };
			if (now.expect !== action.expect) return { ok: false, changed: [], message: '.env changed after the preview — nothing was written; plan again' };
			writeScoped({ root: ctx.root, rel: '.env', content: now.content, expected: now.expect, recheck: () => { const g = gitExposure(ctx.root, '.env', { git: runGit }); if (!g.safe) throw new SetupRefusal('blocked', g.reason); } });
			return { ok: true, changed: ['.env'], message: `wrote .env (${now.preview.sets.join(', ')})` };
		}
		if (action.id === 'create-credential-store') {
			const r = applyLocal({ root: ctx.root, action: action.id, target: action.preview?.creates, parentId: action.preview?.parentId, workspace: ctx.root, env, home: homeOf(ctx) });
			const also = action.preview?.also ?? [];
			return { ok: true, changed: r.changed ? [...also, action.preview.creates] : [], message: r.changed ? `created ${action.preview.creates} (owner-only${also.length ? `, with ${also.length} parent folder(s)` : ''})` : `nothing to do — ${r.reason}` };
		}
		// the owner's steps, run only when the engine was told --authorize in a terminal: the module's own
		// commands, the owner present for the consent screen; a verified read leaves its receipt
		if (action.id === 'authorize-account' || action.id === 'verify-account-read') {
			if (!action.command) return { ok: false, changed: [], message: action.reason ?? 'not ready' };
			const r = spawnSync(action.command[0], action.command.slice(1), { cwd: ctx.root, env, stdio: 'inherit', timeout: 600_000 });
			if (r.status !== 0) return { ok: false, changed: [], message: `${action.command[0]} exited ${r.status ?? r.error?.message}` };
			if (action.id === 'verify-account-read') {
				fs.mkdirSync(ctx.receiptDir, { recursive: true });
				const file = receiptFile(ctx, action.account);
				fs.writeFileSync(file, JSON.stringify({ what: 'one read-only Drive search succeeded', account: action.account, at: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
				return { ok: true, changed: [file], message: 'verified read — receipt written' };
			}
			return { ok: true, changed: [], message: 'consent completed for this account' };
		}
		return { ok: false, changed: [], message: `unknown action ${action.id}` };
	} catch (error) {
		return { ok: false, changed: [], message: error instanceof SetupRefusal ? error.message : redact(error.message) };
	}
}

export const SETUP_UNIT = Object.freeze({
	id: UNIT_ID, version: 1,
	inputs: [
		{ id: 'credentials_dir', kind: 'path', env: KEYS.credentials_dir, required: true, default: DEFAULT_STORE, title: 'credential store', prompt: 'Where should account credentials be kept (outside the workspace, outside synced folders)?' },
		{ id: 'client_secret', kind: 'secret-path', env: KEYS.client_secret, required: false, title: 'OAuth client file', prompt: 'Path to your Desktop OAuth client file (needed to sign in; never read)' },
		{ id: 'account', kind: 'string', required: false, title: 'account', prompt: 'The Google account to connect (named explicitly)' },
	],
	inspect, plan, apply,
});
