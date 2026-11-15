// The files SETUP UNIT (setup contribution, version 1): the one mounted root every file-drives record
// resolves under (FILES_FOLDER) — set in .env, and present on this machine. The .env write is an ENV
// ACTION the engine performs (confined, fingerprinted, refused when git would commit .env, never
// printed — cr-dt-007, D61), so the unit names the key and its value and declares no apply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = 'FILES_FOLDER';
const expand = (p) => (p && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p);
const valueOf = (ctx, inputs = {}) => inputs.files_folder ?? ctx.env?.[KEY];

export function inspect(ctx) {
	const v = ctx.env?.[KEY];
	const folder = v ? expand(v) : null;
	const exists = folder && (() => { try { return fs.statSync(folder).isDirectory(); } catch { return false; } })();
	return { checks: [
		!v ? { id: 'files.folder', status: 'missing', title: 'FILES_FOLDER', detail: 'not set', fix: 'dt setup files --input files_folder=<folder>' }
			: exists ? { id: 'files.folder', status: 'configured', title: 'FILES_FOLDER', detail: 'set, and the folder exists' }
			: { id: 'files.folder', status: 'blocked', title: 'FILES_FOLDER', detail: 'set, but the folder is not there (a drive not mounted, a path mistyped)', fix: 'mount it, or dt setup files --input files_folder=<folder>' },
	] };
}

export function plan(ctx, inputs = {}) {
	const v = valueOf(ctx, inputs);
	const over = { ...ctx, env: { ...ctx.env, ...(v ? { [KEY]: v } : {}) } };
	const action = { id: 'set-files_folder', title: 'write FILES_FOLDER into .env', env: { [KEY]: v ? String(v) : undefined }, state: v ? 'ready' : 'needs-input' };
	return { checks: inspect(over).checks, actions: [action], needs: v ? [] : ['files_folder'] };
}

export const SETUP_UNIT = Object.freeze({
	id: 'files', version: 1,
	inputs: [{ id: 'files_folder', kind: 'path', env: KEY, required: true, title: 'files folder', prompt: 'The folder your drives and archives live under (FILES_FOLDER)' }],
	inspect, plan,
});
