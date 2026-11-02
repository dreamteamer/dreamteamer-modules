// Where a running server keeps its state and its token: the per-user runtime directory, never the
// workspace (README: "nothing goes into the workspace, so it never lands in a synced folder"). One file per
// workspace, named by a hash of the workspace's real path; the directory is 0700 and the file 0600.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The per-user runtime directory: $DT_WEB_RUNTIME_DIR, else $XDG_RUNTIME_DIR/dreamteamer-web on Linux,
 *  ~/Library/Application Support/dreamteamer/web/runtime on macOS, ~/.local/share/dreamteamer/web/runtime otherwise. */
export function runtimeDir(env = process.env, platform = process.platform, home = os.homedir()) {
	if (env.DT_WEB_RUNTIME_DIR) return env.DT_WEB_RUNTIME_DIR;
	if (platform === 'linux' && env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, 'dreamteamer-web');
	if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'dreamteamer', 'web', 'runtime');
	return path.join(home, '.local', 'share', 'dreamteamer', 'web', 'runtime');
}

/** The state file of one workspace's server. */
export function stateFile(root, dir = runtimeDir()) {
	const key = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
	return path.join(dir, `${key}.json`);
}

export function writeState(file, state) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.chmodSync(path.dirname(file), 0o700);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(state, null, '\t') + '\n', { mode: 0o600 });
	fs.renameSync(tmp, file);
}

export function readState(file) {
	try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function removeState(file, pid = process.pid) {
	const s = readState(file);
	if (s && s.pid === pid) fs.rmSync(file, { force: true });
}

export function alive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The running server of a workspace, or null — a state file whose process is gone is removed. */
export function running(root) {
	const file = stateFile(root);
	const s = readState(file);
	if (!s) return null;
	if (!alive(s.pid)) { fs.rmSync(file, { force: true }); return null; }
	return { ...s, file };
}

/**
 * Claim the right to serve this workspace: a lock file created exclusively beside the state file, holding
 * this pid for the server's whole life. Two starts at the same moment cannot both pass the "already
 * running" check — only one creates the lock. A lock whose process is gone is taken over once.
 */
export function claimStart(file, pid = process.pid) {
	const lock = `${file}.lock`;
	fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(lock, String(pid), { flag: 'wx', mode: 0o600 });
			return { ok: true, release: () => { if (Number(fs.readFileSync(lock, 'utf8')) === pid) fs.rmSync(lock, { force: true }); } };
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const held = Number(fs.readFileSync(lock, 'utf8'));
			if (alive(held)) return { ok: false, pid: held };
			fs.rmSync(lock, { force: true });
		}
	}
	return { ok: false, pid: null };
}
