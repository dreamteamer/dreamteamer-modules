// The search SETUP UNIT (setup contribution, version 1): local search runs on qmd, an on-device index — nothing else to set up.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const onPath = (env, bin) => (env.PATH ?? '').split(path.delimiter).some((d) => { if (!d) return false; try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return fs.statSync(path.join(d, bin)).isFile(); } catch { return false; } });

export function inspect(ctx) {
	const env = ctx.env ?? {};
	const present = onPath(env, 'qmd');
	return { checks: [present
		? { id: 'search.tool', status: 'configured', title: 'qmd on PATH', detail: 'qmd is available' }
		: { id: 'search.tool', status: 'blocked', title: 'qmd on PATH', detail: 'qmd is not on PATH', fix: 'dt setup search --allow machine --allow network (npm install -g @tobilu/qmd)' }] };
}

export function plan(ctx, inputs = {}) {
	const { checks } = inspect(ctx);
	const present = checks[0].status === 'configured';
	return { checks, needs: [], actions: [{ id: 'install-qmd', title: 'install qmd (npm install -g @tobilu/qmd)', effects: [{ kind: 'machine', detail: 'a global npm package on this machine' }, { kind: 'network', detail: 'npm fetches @tobilu/qmd' }], runBy: 'engine', state: present ? 'done' : 'ready' }] };
}

export function apply(ctx, action) {
	if (action.state === 'done') return { ok: true, changed: [], message: 'nothing to do — already installed' };
	if (action.id === 'install-qmd') {
		const r = spawnSync('npm', ['install', '-g', '@tobilu/qmd', '--no-audit', '--no-fund'], { cwd: ctx.root, env: ctx.env, stdio: 'inherit', timeout: 600_000 });
		return r.status === 0 ? { ok: true, changed: [], message: 'qmd installed globally' } : { ok: false, changed: [], message: `npm exited ${r.status ?? r.error?.message}` };
	}
	return { ok: false, changed: [], message: `unknown action ${action.id}` };
}

export const SETUP_UNIT = Object.freeze({ id: 'search', version: 1, inputs: [], inspect, plan, apply });
