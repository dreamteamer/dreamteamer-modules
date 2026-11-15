// The notebooklm SETUP UNIT (setup contribution, version 1): the vendor CLI on PATH, and a login that no
// local check can prove — reported as unverified until a notebook is actually reached (using-notebooklm).
import fs from 'node:fs';
import path from 'node:path';

const onPath = (env, bin) => (env.PATH ?? '').split(path.delimiter).some((d) => { if (!d) return false; try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return fs.statSync(path.join(d, bin)).isFile(); } catch { return false; } });

export function inspect(ctx) {
	const env = ctx.env ?? {};
	const cli = onPath(env, 'notebooklm');
	return { checks: [
		cli ? { id: 'notebooklm.cli', status: 'configured', title: 'notebooklm CLI', detail: 'on PATH' } : { id: 'notebooklm.cli', status: 'blocked', title: 'notebooklm CLI', detail: 'notebooklm is not on PATH', fix: 'install the vendor CLI the using-notebooklm skill names' },
		{ id: 'notebooklm.login', status: 'unverified', title: 'Google login', detail: 'a login is proved only by reaching a notebook; nothing local shows it', fix: 'notebooklm login, then dt notebooklm — the owner\'s step' },
	] };
}
export const plan = (ctx) => ({ checks: inspect(ctx).checks, actions: [], needs: [] });
export const apply = (ctx, action) => ({ ok: false, changed: [], message: `no action ${action.id} — sign-in is the owner's, through the vendor CLI` });
export const SETUP_UNIT = Object.freeze({ id: 'notebooklm', version: 1, inputs: [], inspect, plan, apply });
