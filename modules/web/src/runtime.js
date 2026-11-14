// Where a running server keeps its state and its token: the per-user runtime directory, never the
// workspace (README: "nothing goes into the workspace, so it never lands in a synced folder"). One file per
// workspace, named by a hash of the workspace's real path; the directory is 0700 and the file 0600.
import { spawnSync } from 'node:child_process';
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

/** A workspace's key: the first 16 hex of the SHA-256 of its real path — the runtime file's name, the state
 *  file's (state.js) and the registry id. */
export function workspaceKey(root) {
	return crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
}

/** What a start that could not take its stored port says (the runtime file carries `movedFrom` for the verbs). */
export const movedLine = (from, to) => `port ${from} was taken; moved to ${to} — open the pane again: dt web open`;

/** The runtime file of one workspace's server: `{ pid, port, started, owner, token, instance, lstart, movedFrom? }` — `lstart` the process's start time (processStart). */
export function stateFile(root, dir = runtimeDir()) {
	return path.join(dir, `${workspaceKey(root)}.json`);
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

// ---- who answers on the runtime file's port ---------------------------------------------------------------------
// A pid outlives nothing: after a hard kill (SIGKILL, a crash, power loss) the runtime file stays, and its pid and its
// port can both belong to another program later. So a caller never trusts either: it sends a fresh random challenge to
// the unauthenticated GET /_dt/identity, and only the server that holds the runtime file's `instance` — a random id
// minted each start, kept in this 0600 file and nowhere else — can answer HMAC-SHA256(instance, challenge). The
// instance itself never crosses the wire, and the control token is sent only after the proof.

/** The path of the identity route, and what a challenge must look like (base64url, 16 to 128 characters). */
export const IDENTITY_PATH = '/_dt/identity';
export const CHALLENGE = /^[A-Za-z0-9_-]{16,128}$/;

/** What the server holding `instance` answers to `challenge`. */
export function identityProof(instance, challenge) {
	return crypto.createHmac('sha256', String(instance)).update(`dt-web identity ${challenge}`).digest('base64url');
}

/**
 * Who answers on `rt.port`: `'proven'` — the server holding `rt.instance`; `'stranger'` — a refused connection, an answer
 * that is not a 200, or a wrong proof (and a runtime file with no instance, an older server): this is not the server;
 * `'silent'` — no answer in time (or a connection that broke): a process that may be this server, suspended or busy,
 * and must not be taken for a stranger. Never throws. Nothing but the challenge is sent.
 * @param {{ port?: unknown, instance?: unknown }} rt
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [o]
 * @returns {Promise<'proven'|'stranger'|'silent'>}
 */
export async function identify(rt, { fetchImpl = fetch, timeoutMs = 2000 } = {}) {
	if (!rt || !Number.isInteger(rt.port) || rt.port <= 0 || rt.port > 65535 || typeof rt.instance !== 'string' || !rt.instance) return 'stranger';
	const challenge = crypto.randomBytes(24).toString('base64url');
	let res;
	try {
		res = await fetchImpl(`http://127.0.0.1:${rt.port}${IDENTITY_PATH}?challenge=${challenge}`, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
	} catch (e) {
		return e?.cause?.code === 'ECONNREFUSED' || e?.code === 'ECONNREFUSED' ? 'stranger' : 'silent';
	}
	if (res.status !== 200) return 'stranger';
	let body;
	try { body = await res.json(); } catch (e) { return e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'silent' : 'stranger'; }
	const proof = body?.proof;
	const want = identityProof(rt.instance, challenge);
	return typeof proof === 'string' && proof.length === want.length && crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(want)) ? 'proven' : 'stranger';
}

/** Does the server on `rt.port` hold `rt.instance`? (`identify` is 'proven'.) What the hook asks. */
export async function proves(rt, o) {
	return (await identify(rt, o)) === 'proven';
}

/** When `pid` started, as `ps -o lstart=` prints it (to the second), or null when it cannot be read. */
export function processStart(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return null;
	try {
		const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
		const t = r.status === 0 ? String(r.stdout).trim().replace(/\s+/g, ' ') : '';
		return t || null;
	} catch { return null; }
}

/**
 * The server a runtime file names, and in what state: null when there is no file or its process is gone (that file is
 * removed); otherwise the file's contents plus `file`, `state` and `proven`:
 * - `'running'` (proven) — it proved this start's instance;
 * - `'stale'` — a refused connection or a wrong proof, or a silent process whose start time is not the one recorded
 *   (its pid reused): not this server, so its runtime file may be cleared and a new server started;
 * - `'silent'` — alive, no answer in time, and not shown to be another process: NOT ANSWERING. Nothing may clear its
 *   runtime file or lock, or start a server beside it. `sameProcess` is true when the recorded start time is this
 *   pid's own (what lets `dt web stop --force` signal it), null when that cannot be shown.
 * Every verb reads the server through this.
 */
export async function probeServer(file, o) {
	const s = readState(file);
	if (!s || typeof s !== 'object') return null;
	if (!alive(s.pid)) { fs.rmSync(file, { force: true }); return null; }
	const answer = await identify(s, o);
	if (answer === 'proven') return { ...s, file, state: 'running', proven: true, sameProcess: true };
	if (answer === 'stranger') return { ...s, file, state: 'stale', proven: false, sameProcess: null };
	const now = typeof s.lstart === 'string' ? processStart(s.pid) : null;
	const sameProcess = now === null ? null : now === s.lstart.trim().replace(/\s+/g, ' ');
	return { ...s, file, state: sameProcess === false ? 'stale' : 'silent', proven: false, sameProcess };
}

/** The one line every verb prints for a server that is alive and not answering (probeServer state 'silent'). */
export function notAnsweringLine(p) {
	return `not answering: pid ${p.pid} at http://127.0.0.1:${p.port} is alive but gave no identity proof within 2 s — it may be suspended or busy; nothing was started, stopped or removed. Try again, or end it: dt web stop --force`;
}

/** Remove a stale runtime file — only while it still names that pid and instance — and its lock when that pid holds it. */
export function clearStale(file, stale) {
	const now = readState(file);
	if (now && now.pid === stale.pid && now.instance === stale.instance) fs.rmSync(file, { force: true });
	const lock = `${file}.lock`;
	try { if (Number(fs.readFileSync(lock, 'utf8')) === stale.pid) fs.rmSync(lock, { force: true }); } catch { /* no lock */ }
}

/**
 * Claim the right to serve this workspace: a lock file created exclusively beside the state file, holding
 * this pid for the server's whole life. Two starts at the same moment cannot both pass the "already
 * running" check — only one creates the lock. A lock whose process is gone is taken over by one starter
 * only: the takeover itself is an exclusive file, so two starters after a crash cannot both clear it.
 */
export function claimStart(file, pid = process.pid) {
	const lock = `${file}.lock`;
	const take = `${lock}.takeover`;
	const holder = (f) => { try { return Number(fs.readFileSync(f, 'utf8')); } catch { return null; } };
	fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(lock, String(pid), { flag: 'wx', mode: 0o600 });
			let released = false;
			return { ok: true, release: () => { if (released) return; released = true; if (holder(lock) === pid) fs.rmSync(lock, { force: true }); } };
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const held = holder(lock);
			if (held !== null && alive(held)) return { ok: false, pid: held };
			const taker = holder(take);
			if (taker !== null && !alive(taker)) fs.rmSync(take, { force: true });
			try { fs.writeFileSync(take, String(pid), { flag: 'wx', mode: 0o600 }); } catch { return { ok: false, pid: held }; }
			try { if (holder(lock) === held) fs.rmSync(lock, { force: true }); } finally { fs.rmSync(take, { force: true }); }
		}
	}
	return { ok: false, pid: null };
}
