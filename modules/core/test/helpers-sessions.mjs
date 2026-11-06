// Shared by the plain-sessions tests (cr-modules-010): core installed the npm way into a virgin
// workspace, and the CLI run with a controlled environment — no harness session id leaks in from the
// session running the suite unless the test passes one.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, installPacked, closure, BIN } from '../../../tests/helpers/workspace.mjs';

export function dt(root, args, { input, env = {} } = {}) {
	const base = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
	delete base.CLAUDE_CODE_SESSION_ID;
	delete base.SESSIONS_FOLDER;
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: { ...base, ...env }, input, timeout: 60_000 });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** A virgin workspace with core, compiled; `extra(root)` runs before the compile. */
export function coreWorkspace(extra) {
	const root = virginWorkspace();
	installPacked(root, [...closure('core')]);
	extra?.(root);
	const c = dt(root, ['compile']);
	if (c.code !== 0) throw new Error(`compile failed\n${c.err}${c.out}`);
	return root;
}

/** The sessions records on disk under the workspace's data, as relative paths. */
export function sessionFiles(root) {
	const dir = path.join(root, 'data', 'sessions');
	if (!fs.existsSync(dir)) return [];
	const out = [];
	const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p)); } };
	walk(dir);
	return out.sort();
}
