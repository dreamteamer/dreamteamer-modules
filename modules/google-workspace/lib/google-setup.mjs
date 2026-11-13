// The Google Workspace setup provider: one local, read-only `inspect` shared by `dt-google doctor`,
// the engine doctor row set and the setup plan; a plan of small actions; and the one deterministic
// action this module performs itself. Account consent and live reads stay with the account owner and
// run through the existing `dt-google auth` and `dt-google call` commands — never from here.
//
// Read SETUP.md beside this package for the conversation that uses it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCall, credentialPath } from './access.mjs';
import { SETUP_PROTOCOL, SetupRefusal, boardState, workspaceIdentity, within, realish } from './setup-kit.mjs';

export const SETUP_PROVIDER = Object.freeze({
	protocol: SETUP_PROTOCOL,
	module: '@dreamteamer/google-workspace',
	checks: Object.freeze(['google.runtime', 'google.client-config', 'google.credential-store', 'google.stored-accounts', 'google.credential-placement', 'google.account-authorization']),
	actions: Object.freeze(['create-credential-store', 'authorize-account', 'verify-account-read']),
});

/** The rows `dt-google doctor` has always printed, by check id, in their original order. */
export const LEGACY_DOCTOR_IDS = Object.freeze(['google.runtime', 'google.client-config', 'google.credential-store', 'google.account-authorization']);

const PROBE = JSON.stringify({ query: 'trashed = false', page_size: 1 });
const readable = (p) => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } };

function hasUvx(env, platform) {
	return (env.PATH ?? '').split(path.delimiter).some((dir) => {
		if (!dir) return false;
		try { fs.accessSync(path.join(dir, platform === 'win32' ? 'uvx.exe' : 'uvx'), fs.constants.X_OK); return true; } catch { return false; }
	});
}

/** Account filenames in the store, by name only. A token is never opened. */
function storedAccountNames(dir) {
	const out = [];
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.json')) continue;
		try {
			const email = decodeURIComponent(name.slice(0, -5));
			validateCall(email, 'search_drive_files');
			out.push(email);
		} catch { /* not an account credential filename */ }
	}
	return out.sort();
}

/** Every local fact this module can establish without the network, a process or a secret's value.
 *  Check rows never carry a configured path, an account address or file contents. */
export function inspect({ root = null, env = process.env, platform = process.platform, accessible = readable } = {}) {
	const checks = [];
	const add = (row) => checks.push({ ...row, state: boardState(row.status) });

	const uvx = hasUvx(env, platform);
	add({
		id: 'google.runtime', label: 'workspace-mcp runtime', status: uvx ? 'ready' : 'blocked',
		detail: uvx ? 'uvx is available; server package is pinned when started.' : 'uvx is not available.',
		fix: 'Install uv from its official distribution after owner approval.',
	});

	const configured = {};
	for (const [id, key, label] of [['google.client-config', 'GOOGLE_CLIENT_SECRET_PATH', 'OAuth client configuration'], ['google.credential-store', 'WORKSPACE_MCP_CREDENTIALS_DIR', 'Local account credential store']]) {
		const ok = !!env[key] && path.isAbsolute(env[key]) && accessible(env[key]);
		configured[key] = ok;
		add({
			id, label, status: ok ? 'configured' : 'missing',
			detail: ok ? 'Configured local path is readable; account authorization is not verified.' : 'Required absolute local path is missing or unreadable.',
			fix: `Configure ${key} outside Git and complete owner-controlled setup.`,
		});
	}

	const store = env.WORKSPACE_MCP_CREDENTIALS_DIR;
	let stored = null;
	if (configured.WORKSPACE_MCP_CREDENTIALS_DIR) { try { stored = storedAccountNames(store); } catch { stored = null; } }
	add(stored === null
		? { id: 'google.stored-accounts', label: 'Stored account credentials', status: 'blocked', detail: 'The credential store is not readable, so no stored account can be counted.', fix: 'Configure the credential store first.' }
		: stored.length
			? { id: 'google.stored-accounts', label: 'Stored account credentials', status: 'configured', detail: `${stored.length} stored account credential file(s); stored is not verified.`, fix: 'Verify a read for each intended account with the owner (SETUP.md, verify-account-read).', evidence: { stored: stored.length } }
			: { id: 'google.stored-accounts', label: 'Stored account credentials', status: 'missing', detail: 'No account has a stored credential on this computer.', fix: 'The account owner runs the authorize-account step in SETUP.md for each intended account.', evidence: { stored: 0 } });

	if (configured.GOOGLE_CLIENT_SECRET_PATH && configured.WORKSPACE_MCP_CREDENTIALS_DIR) {
		const problems = [];
		if (root) {
			const ws = realish(root);
			if (within(ws, realish(env.GOOGLE_CLIENT_SECRET_PATH))) problems.push('the OAuth client file is inside the workspace');
			if (within(ws, realish(store))) problems.push('the credential store is inside the workspace');
		}
		if (platform !== 'win32') {
			try { if (fs.statSync(store).mode & 0o077) problems.push('the credential store is readable by other local users'); } catch { /* counted above */ }
		}
		add(problems.length
			? { id: 'google.credential-placement', label: 'Credential placement', status: 'blocked', detail: `Unsafe placement: ${problems.join('; ')}.`, fix: 'Move the files outside the workspace and restrict the store to its owner, then update the configured paths.' }
			: { id: 'google.credential-placement', label: 'Credential placement', status: 'ready', detail: root ? 'Both configured paths are outside this workspace and the store is owner-only.' : 'The store is owner-only; workspace placement was not checked without a workspace.', fix: '' });
	} else {
		add({ id: 'google.credential-placement', label: 'Credential placement', status: 'blocked', detail: 'Not evaluated until both local paths are configured.', fix: 'Configure both paths first.' });
	}

	add({
		id: 'google.account-authorization', label: 'Account authorization', status: 'unverified',
		detail: 'Not verified. Local paths and stored files do not prove current authorization.',
		fix: 'After owner-controlled consent, verify a read for each intended account on this computer. Doctor performs no live account calls.',
	});
	return { protocol: SETUP_PROTOCOL, module: SETUP_PROVIDER.module, checks };
}

/** `dt-google doctor`'s report, unchanged: the legacy rows, with absence as `bad`. */
export function legacyDoctor(options) {
	const state = { ready: 'ok', configured: 'ok', unverified: 'warn', missing: 'bad', blocked: 'bad' };
	const byId = new Map(inspect(options).checks.map((c) => [c.id, c]));
	return { checks: LEGACY_DOCTOR_IDS.map((id) => { const c = byId.get(id); return { label: c.label, state: state[c.status], detail: c.detail, fix: c.fix }; }) };
}

/** Engine doctor rows (extension API 1: label, state, detail, fix). Optional-capability semantics:
 *  nothing is `bad`. The authorization row is left out because no local check can ever make it ok,
 *  which would keep every workspace that installs this module from a READY board; each ok detail
 *  says it is not verified, and SETUP.md owns the live check. */
export function engineDoctorRows(options) {
	return inspect(options).checks.filter((c) => c.id !== 'google.account-authorization')
		.map((c) => ({ label: c.label, state: c.state, detail: c.detail, ...(c.state === 'ok' ? {} : { fix: c.fix }) }));
}

const cliArgs = (root, rest) => ['npx', 'dreamteamer', 'google-setup', ...rest, '--workspace', root];
const identity = (p) => { const st = fs.lstatSync(p, { bigint: true }); return `${st.dev}:${st.ino}`; };

/** The directory create-credential-store may make, and the existing parent it is made in. Scope, on
 *  purpose: the configured path must be canonical (no symlink anywhere in it, no `..`); the nearest
 *  existing ancestor must be a directory that only its owner — this user — can write, so nobody else
 *  can swap it; an existing directory is never re-permissioned. Outside the person's home only the last
 *  folder is created, inside an existing parent; UNDER the home the missing folders between are made
 *  too, each owner-only, so the declared default (`~/.config/google-workspace-mcp/credentials`) is one
 *  the action can make on a machine that never ran the bridge. */
const present = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
function storeTarget(dir, workspaceRoot, platform, home = os.homedir()) {
	if (!dir || !path.isAbsolute(dir)) return { state: 'needs-input', reason: 'Set WORKSPACE_MCP_CREDENTIALS_DIR to an absolute path outside the workspace and outside synced folders, in the environment that runs dt-google.' };
	const target = path.resolve(dir);
	if (target === path.dirname(target)) return { state: 'blocked', reason: 'The filesystem root cannot be the credential directory.' };
	// the folders to make, innermost last: the target, and under the home every missing ancestor
	const make = [target];
	let parent = path.dirname(target);
	while (!present(parent)) {
		if (!within(realish(home), parent)) return { state: 'blocked', reason: 'The parent folder of the configured path does not exist. This action creates only the last folder outside your home: create the parent yourself, or choose a path whose parent exists.' };
		make.unshift(parent);
		parent = path.dirname(parent);
		if (parent === path.dirname(parent)) return { state: 'blocked', reason: 'The filesystem root cannot be the credential directory.' };
	}
	let realParent, pst;
	try { pst = fs.lstatSync(parent); realParent = fs.realpathSync(parent); }
	catch { return { state: 'blocked', reason: 'The parent folder of the configured path cannot be inspected.' }; }
	if (realParent !== parent || target !== dir.replace(/(.)[\\/]+$/, '$1')) return { state: 'blocked', reason: `The configured path is not canonical (it passes through a symlink or holds . or ..). Configure its canonical form: ${path.join(realParent, path.relative(parent, target))}` };
	if (!pst.isDirectory()) return { state: 'blocked', reason: 'The parent of the configured path is not a directory.' };
	const posix = platform !== 'win32';
	if (posix && typeof process.getuid === 'function' && pst.uid !== process.getuid()) return { state: 'blocked', reason: 'The parent folder belongs to another user; choose a folder you own.' };
	if (posix && (pst.mode & 0o022)) return { state: 'blocked', reason: 'Other users can write to the parent folder, so the new directory could be swapped; choose a parent only you can write.' };
	if (within(workspaceRoot, target)) return { state: 'blocked', reason: 'The configured path is inside the workspace; choose one outside it.' };
	let st = null;
	try { st = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') return { state: 'blocked', reason: 'The configured path cannot be inspected.' }; }
	if (st && !st.isDirectory()) return { state: 'blocked', reason: 'Something other than a directory (a file or a symlink) is at the configured path; nothing is replaced.' };
	if (st && posix && (st.mode & 0o077)) return { state: 'blocked', reason: 'The directory exists but other local users can access it. This action never changes existing permissions: restrict it yourself (owner-only, 0700) after reviewing what is inside.' };
	if (st) return { state: 'done', reason: 'The owner-only directory exists.' };
	return { state: 'ready', target, parent, parentId: identity(parent), make };
}

/** What can be done next, each with its effects. Builds nothing and writes nothing. */
export function plan({ root, env = process.env, platform = process.platform, accounts = [], accessible = readable, home = os.homedir() } = {}) {
	const workspace = workspaceIdentity(root);
	const { checks } = inspect({ root: workspace.root, env, platform, accessible });
	const status = Object.fromEntries(checks.map((c) => [c.id, c.status]));
	const actions = [];

	// 1. the local credential directory — the one action this module performs itself
	{
		const t = storeTarget(env.WORKSPACE_MCP_CREDENTIALS_DIR, workspace.root, platform, home);
		const between = t.state === 'ready' ? t.make.slice(0, -1) : [];
		const action = { id: 'create-credential-store', title: 'Create the owner-only local credential directory', kind: 'local', runBy: 'agent', effects: [between.length
			? `machine-file: ${t.make.length} new owner-only folders under your home (${path.relative(realish(home), t.target)}); nothing else is created or changed`
			: 'machine-file: one new owner-only directory outside the workspace, inside an existing parent; nothing else is created or changed'] };
		actions.push(t.state === 'ready'
			? { ...action, state: 'ready', preview: { creates: t.target, parent: t.parent, parentId: t.parentId, mode: '0700', ...(between.length ? { also: between } : {}) }, command: cliArgs(workspace.root, ['apply', 'create-credential-store', '--target', t.target, '--parent-id', t.parentId]) }
			: { ...action, state: t.state, reason: t.reason });
	}

	// 2-3. the owner's live steps, through the module's existing commands
	const prerequisites = ['google.runtime', 'google.client-config', 'google.credential-store'].filter((id) => !['ready', 'configured'].includes(status[id]));
	const live = (account) => {
		const valid = (() => { try { validateCall(account, 'search_drive_files'); return true; } catch { return false; } })();
		if (!valid) return [{ id: 'authorize-account', kind: 'live', runBy: 'owner', state: 'blocked', reason: 'An explicit valid account address is required.' }];
		const blocked = platform === 'win32' ? 'This bridge does not support manual consent on Windows.' : prerequisites.length ? `Complete first: ${prerequisites.join(', ')}.` : null;
		const exists = !blocked && fs.existsSync(credentialPath(env.WORKSPACE_MCP_CREDENTIALS_DIR, account));
		return [
			{ id: 'authorize-account', title: 'Owner consents for one account', kind: 'live', runBy: 'owner', account,
				effects: ['network: starts the pinned workspace-mcp server through uvx (may download it once)', 'account-access: Google consent for Gmail, Drive and Calendar read-only scopes', 'machine-file: the server stores one credential in the credential directory'],
				state: blocked ? 'blocked' : exists ? 'done' : 'ready', ...(blocked ? { reason: blocked } : exists ? { reason: 'A credential is stored for this account; verify it instead.' } : {}),
				command: ['npx', 'dt-google', 'auth', account],
				evidence: 'Exit 0 with state verified_read means consent and one Drive read succeeded on this computer.' },
			{ id: 'verify-account-read', title: 'Owner-approved live read for one account', kind: 'live', runBy: 'owner', account,
				effects: ['network: one read-only Drive search through the pinned server', 'account-access: reads one file listing; the output is private and is not repeated'],
				state: blocked ? 'blocked' : exists ? 'ready' : 'blocked', ...(blocked ? { reason: blocked } : exists ? {} : { reason: 'No stored credential for this account yet.' }),
				command: ['npx', 'dt-google', 'call', account, 'search_drive_files', PROBE],
				evidence: 'Exit 0 is a verified read for this account at this time. Report the exit status only.' },
		];
	};
	if (accounts.length) for (const a of accounts) actions.push(...live(a));
	else actions.push({ id: 'authorize-account', title: 'Owner consents for one account', kind: 'live', runBy: 'owner', state: 'needs-input', reason: 'Ask which account(s) to connect; each is named explicitly.' });

	return { protocol: SETUP_PROTOCOL, module: SETUP_PROVIDER.module, workspace, checks, actions };
}

/** Perform one local action after its preview was approved. Live actions are refused here. */
export function apply({ root, action, target, parentId, workspace: claimed, env = process.env, platform = process.platform, accessible = readable, home = os.homedir() } = {}) {
	const workspace = workspaceIdentity(root);
	if (!claimed || realish(claimed) !== workspace.root) throw new SetupRefusal('workspace', 'The --workspace given does not match the workspace this command runs in. Nothing was changed.');
	if (action !== 'create-credential-store') throw new SetupRefusal('action', SETUP_PROVIDER.actions.includes(action) ? 'That step is the account owner\'s: run its command from the plan yourself after explicit approval.' : 'Unknown action.');
	const after = () => inspect({ root: workspace.root, env, platform, accessible }).checks;
	const step = storeTarget(env.WORKSPACE_MCP_CREDENTIALS_DIR, workspace.root, platform, home);
	const stale = (why) => new SetupRefusal('stale', `${why} Nothing was changed; inspect and plan again.`);
	if (!target || !parentId) throw new SetupRefusal('usage', 'apply create-credential-store needs the --target and --parent-id the preview printed.');
	// bound to the preview: the same canonical path, under the same parent directory (device and inode)
	const configured = env.WORKSPACE_MCP_CREDENTIALS_DIR && path.resolve(env.WORKSPACE_MCP_CREDENTIALS_DIR);
	if (configured !== target) throw stale('The configured credential directory is not the one previewed.');
	if (step.state === 'done') return { action, changed: false, reason: step.reason, workspace, checks: after() };
	if (step.state !== 'ready') throw new SetupRefusal('blocked', step.reason);
	if (step.parentId !== parentId) throw stale('The parent folder was replaced after the preview.');
	// outermost first: each folder is made owner-only inside the one before it
	for (const dir of step.make) {
		try { fs.mkdirSync(dir, { mode: 0o700 }); }
		catch (error) { if (error.code === 'EEXIST' || error.code === 'ENOENT') throw stale('The path changed after the preview.'); throw error; }
	}
	// Re-examine what was made. A swap of the parent in the instant between the check and mkdir cannot be
	// undone safely from here, so it is reported for a person to review rather than deleted.
	const st = fs.lstatSync(target);
	if (!st.isDirectory() || identity(step.parent) !== parentId || fs.realpathSync(target) !== target) throw new SetupRefusal('path', 'The parent folder changed while the directory was created; review the configured path by hand.');
	if (platform !== 'win32' && step.make.some((dir) => fs.lstatSync(dir).mode & 0o077)) throw new SetupRefusal('path', 'The new directory is not owner-only (check the umask); restrict it yourself before any account is authorized.');
	return { action, changed: true, made: step.make, workspace, checks: after() };
}
