// The per-user STATE of dt web (cr-modules-017 §2): what outlives a server — its port, the workspace's level, the
// hashed client tokens, the pane's place, selection and queue — one file per workspace, named like the runtime file
// (the realpath hash), plus registry.json, the workspaces `dt web open` has seen. The dir is 0700 and every file 0600,
// written through a temp file and a rename; nothing here holds a sid, a code or a token in clear. The pane's sessions
// are NOT here: they live in the server's memory only (sessions.js), so a restart signs the pane out. The runtime
// dir (runtime.js) keeps only what one process owns: pid, control token, start lock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alive, workspaceKey } from './runtime.js';

export { workspaceKey };

/** $DT_WEB_STATE_DIR, else ~/Library/Application Support/dreamteamer/web/state on macOS, $XDG_STATE_HOME/dreamteamer/web
 *  on Linux (default ~/.local/state/dreamteamer/web), else ~/.local/state/dreamteamer/web. */
export function stateDir(env = process.env, platform = process.platform, home = os.homedir()) {
	if (env.DT_WEB_STATE_DIR) return env.DT_WEB_STATE_DIR;
	if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'dreamteamer', 'web', 'state');
	if (platform === 'linux' && env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'dreamteamer', 'web');
	return path.join(home, '.local', 'state', 'dreamteamer', 'web');
}

const LEVELS = new Set(['read', 'edit', 'admin']);
const PANE = { view: null, refs: [], place: null, at: null, queue: [], connectedAt: null, movedTo: null };
export const DEFAULT_STATE = Object.freeze({
	port: null, level: 'edit', raisedAt: null, hookSeenAt: null, clientTokens: Object.freeze([]),
	pane: Object.freeze({ ...PANE, refs: Object.freeze([]), queue: Object.freeze([]) }),
});
const defaults = () => ({ ...DEFAULT_STATE, clientTokens: [], pane: { ...PANE, refs: [], queue: [] } });
const HEX64 = /^[0-9a-f]{64}$/;
const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.chmodSync(dir, 0o700);
}
function writeFileAtomic(file, text) {
	ensureDir(path.dirname(file));
	const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
	fs.writeFileSync(tmp, text, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

export const workspaceStateFile = (root, dir = stateDir()) => path.join(dir, `${workspaceKey(root)}.json`);

/** The workspace's state; the defaults when absent or unreadable. A file that parses keeps each part that has the
 *  right shape (a port, a level, …); a half-written one reads as the defaults, and the next write replaces it. */
export function readWorkspaceState(root, dir = stateDir()) {
	const out = defaults();
	let text;
	try { text = fs.readFileSync(workspaceStateFile(root, dir), 'utf8'); } catch { return out; }
	let raw;
	try { raw = JSON.parse(text); } catch {
		const port = /^\s*\{\s*"port"\s*:\s*(\d{1,5})\s*[,}]/.exec(text);
		if (port && validPort(Number(port[1]))) out.port = Number(port[1]);
		return out;
	}
	if (!isPlain(raw)) return out;
	if (validPort(raw.port)) out.port = raw.port;
	if (LEVELS.has(raw.level)) out.level = raw.level;
	for (const k of ['raisedAt', 'hookSeenAt']) if (typeof raw[k] === 'string') out[k] = raw[k];
	// a `sessions` key (an earlier candidate's) is never read, and the next write drops it
	if (Array.isArray(raw.clientTokens)) out.clientTokens = raw.clientTokens.filter((t) => isPlain(t) && HEX64.test(String(t.sha256)) && LEVELS.has(t.level));
	if (isPlain(raw.pane)) {
		const p = raw.pane;
		if (isPlain(p.view)) out.pane.view = p.view;
		if (Array.isArray(p.refs)) out.pane.refs = p.refs.filter((r) => typeof r === 'string');
		for (const k of ['place', 'at', 'connectedAt']) if (typeof p[k] === 'string') out.pane[k] = p[k];
		if (Array.isArray(p.queue)) out.pane.queue = p.queue.filter(isPlain);
		if (isPlain(p.movedTo) || typeof p.movedTo === 'string') out.pane.movedTo = p.movedTo;
	}
	return out;
}

/** Written whole, atomically: dir 0700, file 0600. Refuses a state that carries sessions: they live in memory only. */
export function writeWorkspaceState(root, state, dir = stateDir()) {
	if (state && Object.hasOwn(state, 'sessions')) throw new Error('the pane\'s sessions live in the server\'s memory only, never in the state file');
	writeFileAtomic(workspaceStateFile(root, dir), JSON.stringify(state, null, '\t') + '\n');
}

const registryFile = (dir) => path.join(dir, 'registry.json');

/** The registered workspaces, `[{ id, root, name, lastOpened }]`; `[]` when absent or unreadable. */
export function readRegistry(dir = stateDir()) {
	try {
		const raw = JSON.parse(fs.readFileSync(registryFile(dir), 'utf8'));
		return Array.isArray(raw) ? raw.filter((e) => isPlain(e) && typeof e.id === 'string' && typeof e.root === 'string') : [];
	} catch { return []; }
}

export function lookup(id, dir = stateDir()) {
	return readRegistry(dir).find((e) => e.id === id) ?? null;
}

const LOCK_TRIES = 20;
const LOCK_WAIT_MS = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Upsert a workspace by id under registry.json.lock (exclusive create, 20 tries × 50 ms). A lock whose
 *  process is gone is taken over; a live one past the last try is an error naming the registry. */
export async function register({ root, name }, dir = stateDir(), now = Date.now) {
	ensureDir(dir);
	const lock = `${registryFile(dir)}.lock`;
	for (let attempt = 0; attempt < LOCK_TRIES; attempt++) {
		try {
			fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			let holder = null;
			try { holder = Number(fs.readFileSync(lock, 'utf8')); } catch { /* released meanwhile */ }
			if (holder !== null && Number.isInteger(holder) && holder > 0 && !alive(holder)) {
				try { if (Number(fs.readFileSync(lock, 'utf8')) === holder) fs.rmSync(lock, { force: true }); } catch { /* gone */ }
				continue;
			}
			await sleep(LOCK_WAIT_MS);
			continue;
		}
		try {
			const real = fs.realpathSync(root);
			const entry = { id: workspaceKey(real), root: real, name: String(name ?? path.basename(real)), lastOpened: new Date(now()).toISOString() };
			const list = readRegistry(dir).filter((e) => e.id !== entry.id);
			list.push(entry);
			writeFileAtomic(registryFile(dir), JSON.stringify(list, null, '\t') + '\n');
			return entry;
		} finally {
			fs.rmSync(lock, { force: true });
		}
	}
	throw new Error(`the workspace registry (${registryFile(dir)}) is locked by another dt web — try again`);
}
