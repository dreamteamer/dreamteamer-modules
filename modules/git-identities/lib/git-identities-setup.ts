// The git-identities SETUP UNIT (setup contribution, version 1): is there a committer identity in THIS
// repository (git config user.name / user.email, local or inherited)? The planning and verification of
// identities across repositories is the managing-git-identities skill and dt-git-identities; this unit
// only says whether a commit here would carry a name.
import { spawnSync } from 'node:child_process';

const config = (ctx, key) => { const r = spawnSync('git', ['config', '--get', key], { cwd: ctx.root, env: ctx.env, encoding: 'utf8' }); return r.status === 0 ? (r.stdout ?? '').trim() : ''; };

export function inspect(ctx) {
	const git = spawnSync('git', ['--version'], { env: ctx.env, encoding: 'utf8' }).status === 0;
	if (!git) return { checks: [{ id: 'git-identities.git', status: 'blocked', title: 'git', detail: 'git is not on PATH', fix: 'install git' }] };
	const name = config(ctx, 'user.name'), email = config(ctx, 'user.email');
	return { checks: [
		{ id: 'git-identities.git', status: 'configured', title: 'git', detail: 'on PATH' },
		name && email
			? { id: 'git-identities.identity', status: 'configured', title: 'committer identity', detail: 'user.name and user.email are set for this repository (values not shown)' }
			: { id: 'git-identities.identity', status: 'missing', title: 'committer identity', detail: `${[!name && 'user.name', !email && 'user.email'].filter(Boolean).join(' and ')} not set`, fix: 'git config user.name "…" and git config user.email "…" in this repository — the managing-git-identities skill plans which identity' },
	] };
}
export const plan = (ctx) => ({ checks: inspect(ctx).checks, actions: [], needs: [] });
export const apply = (ctx, action) => ({ ok: false, changed: [], message: `no action ${action.id} — an identity is chosen by the person (managing-git-identities)` });
export const SETUP_UNIT = Object.freeze({ id: 'git-identities', version: 1, inputs: [], inspect, plan, apply });
