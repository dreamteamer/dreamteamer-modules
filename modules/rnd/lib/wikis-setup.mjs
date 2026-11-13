// The wikis SETUP UNIT (setup contribution, version 1): asking a wiki by meaning runs on qmd; grepping it needs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Where `bin` sits on PATH, and whether it may be run: { file, executable } or null. */
const onPath = (env, bin) => {
	for (const d of (env.PATH ?? '').split(path.delimiter)) {
		if (!d) continue;
		const file = path.join(d, bin);
		try { if (!fs.statSync(file).isFile()) continue; } catch { continue; }
		try { fs.accessSync(file, fs.constants.X_OK); return { file, executable: true }; } catch { return { file, executable: false }; }
	}
	return null;
};

export function inspect(ctx) {
	const env = ctx.env ?? {};
	const found = onPath(env, 'qmd');
	return { checks: [found?.executable
		? { id: 'wikis.tool', status: 'configured', title: 'qmd on PATH', detail: 'qmd is available' }
		: found
			? { id: 'wikis.tool', status: 'blocked', title: 'qmd on PATH', detail: `qmd is on PATH but not executable (${found.file})`, fix: `chmod +x ${found.file}` }
			: { id: 'wikis.tool', status: 'blocked', title: 'qmd on PATH', detail: 'qmd is not on PATH', fix: 'dt setup wikis --allow machine --allow network (npm install -g @tobilu/qmd)' }] };
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

export const SETUP_UNIT = Object.freeze({ id: 'wikis', version: 1, inputs: [], inspect, plan, apply });
