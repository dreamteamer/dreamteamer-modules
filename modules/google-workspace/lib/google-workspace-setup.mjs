// The google-workspace SETUP UNIT — what the engine's `dt install`, `dt setup` and `dt status` drive
// (setup contribution, version 1). It wraps the module's own inspect / plan / apply (google-setup.mjs):
// the checks are the same rows, the actions the same actions, with each effect as { kind, detail } and
// the planned action handed back to apply verbatim (its preview carries the target and parent id the
// apply is bound to). Sign-in and the live read stay the owner's — runBy 'owner', run only under
// `dt setup google-workspace --authorize` in a terminal — and a successful live read leaves a dated
// receipt the next inspect turns into `ready`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspect as inspectLocal, plan as planLocal, apply as applyLocal } from './google-setup.mjs';
import { SetupRefusal, redact } from './setup-kit.mjs';

export const UNIT_ID = 'google-workspace';
const DEFAULT_STORE = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'credentials');

/** The environment the module's own functions read, with the unit's inputs laid over it. */
const envWith = (ctx, inputs = {}) => ({
	...ctx.env,
	...(inputs.client_secret ? { GOOGLE_CLIENT_SECRET_PATH: inputs.client_secret } : {}),
	...(inputs.credentials_dir ? { WORKSPACE_MCP_CREDENTIALS_DIR: inputs.credentials_dir } : {}),
});
const receiptFile = (ctx, account) => path.join(ctx.receiptDir, `${encodeURIComponent(account)}.verified.json`);
const receipts = (ctx) => { try { return fs.readdirSync(ctx.receiptDir).filter((f) => f.endsWith('.verified.json')).map((f) => JSON.parse(fs.readFileSync(path.join(ctx.receiptDir, f), 'utf8'))); } catch { return []; } };

/** One effect string of the module ('kind: detail') as the engine's { kind, detail }; the module's
 *  'machine-file' and 'account-access' spellings map onto the engine's five kinds. */
const KIND = { 'machine-file': 'machine', 'account-access': 'account', network: 'network', download: 'download', 'workspace-file': 'workspace-files' };
const effect = (text) => { const m = /^([a-z-]+):\s*(.*)$/s.exec(text); return m ? { kind: KIND[m[1]] ?? m[1], detail: m[2] } : { kind: 'machine', detail: text }; };

export function inspect(ctx) {
	const { checks } = inspectLocal({ root: ctx.root, env: envWith(ctx) });
	const seen = receipts(ctx);
	// the module says `blocked` for a row it cannot evaluate until an INPUT arrives; to the engine that is
	// `missing` (an input fixes it) — `blocked` is kept for what no input fixes (uvx absent, a bad placement)
	const waitingOnInput = checks.some((c) => c.status === 'missing');
	return { checks: checks.map((c) => {
		const status = c.status === 'blocked' && waitingOnInput && c.id !== 'google.runtime' ? 'missing' : c.status;
		const row = { id: c.id, status, title: c.label, detail: c.detail, fix: c.fix, evidence: c.evidence };
		// the one check only a live read settles: a receipt from `verify-account-read` makes it ready, dated
		if (c.id === 'google.account-authorization' && seen.length) {
			const latest = seen.map((r) => r.at).sort().at(-1);
			return { ...row, status: 'ready', detail: `${seen.length} account(s) verified on this computer`, evidence: { at: latest, accounts: seen.length } };
		}
		return row;
	}) };
}

export function plan(ctx, inputs = {}) {
	const env = envWith(ctx, inputs);
	const accounts = inputs.account ? [inputs.account] : [];
	const p = planLocal({ root: ctx.root, env, accounts });
	const needs = [];
	if (!env.GOOGLE_CLIENT_SECRET_PATH) needs.push('client_secret');   // a sign-in prerequisite, not an install one (D41)
	if (!accounts.length) needs.push('account');
	const actions = p.actions.map((a) => ({
		id: a.id, title: a.title ?? a.id, account: a.account,
		effects: (a.effects ?? []).map(effect),
		preview: a.preview, command: a.command, evidence: a.evidence,
		runBy: a.runBy === 'owner' ? 'owner' : 'engine',
		...(a.id === 'verify-account-read' ? { kind: 'verify' } : {}),
		state: a.state === 'needs-input' ? 'needs-input' : a.state,
		...(a.reason ? { reason: a.reason } : {}),
	}));
	return { checks: inspect(ctx).checks, actions, needs };
}

export function apply(ctx, action, inputs = {}) {
	const env = envWith(ctx, inputs);
	try {
		if (action.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${action.reason ?? 'already done'}` };
		if (action.id === 'create-credential-store') {
			const r = applyLocal({ root: ctx.root, action: action.id, target: action.preview?.creates, parentId: action.preview?.parentId, workspace: ctx.root, env });
			return { ok: true, changed: r.changed ? [action.preview.creates] : [], message: r.changed ? `created ${action.preview.creates} (owner-only)` : `nothing to do — ${r.reason}` };
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
				fs.writeFileSync(file, JSON.stringify({ what: 'one read-only Drive search succeeded', at: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
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
		{ id: 'credentials_dir', kind: 'path', env: 'WORKSPACE_MCP_CREDENTIALS_DIR', required: true, default: DEFAULT_STORE, title: 'credential store', prompt: 'Where should account credentials be kept (outside the workspace, outside synced folders)?' },
		{ id: 'client_secret', kind: 'secret-path', env: 'GOOGLE_CLIENT_SECRET_PATH', required: false, title: 'OAuth client file', prompt: 'Path to your Desktop OAuth client file (needed to sign in; never read)' },
		{ id: 'account', kind: 'string', required: false, title: 'account', prompt: 'The Google account to connect (named explicitly)' },
	],
	inspect, plan, apply,
});
