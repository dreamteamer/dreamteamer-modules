// The workspace switcher's server half (cr-modules-017 §7): the workspaces `dt web open` registered on this machine,
// and the handoff of the pane to one of them. A handoff reaches only a REGISTERED id; it starts the target through
// the dt-web the target itself has installed, asks the target (its control token, the same user) for a pairing capped
// at the lower of this page's level and the target's stored level — never writing that stored level (the 03:45
// revision) — and leaves a movedTo the hook answers once.
import fs from 'node:fs';
import path from 'node:path';
import { lowerLevel } from '@dreamteamer/protocol/pane-scope';
import { ensureRunning } from './cli.js';
import { alive, readState, runtimeDir as defaultRuntimeDir, stateFile } from './runtime.js';
import { lookup, readRegistry, readWorkspaceState } from './state.js';

const TARGET_BIN = path.join('node_modules', '@dreamteamer', 'web', 'bin', 'dt-web.mjs');
const isRunning = (root, rdir) => {
	try { const r = readState(stateFile(root, rdir)); return Boolean(r && alive(r.pid)); } catch { return false; }
};

/** `GET /_dt/workspaces`: `[{ id, name, running, current }]` — never a root path. */
export function listWorkspaces({ selfId, stateDir, runtimeDir = defaultRuntimeDir() }) {
	return readRegistry(stateDir).map((e) => ({ id: e.id, name: e.name, running: fs.existsSync(e.root) && isRunning(e.root, runtimeDir), current: e.id === selfId }));
}

/** What a registered root lacks to be handed the pane, or null. */
export function missingFor(root) {
	let pkg = null;
	try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* none */ }
	if (!pkg || typeof pkg !== 'object' || !('dreamteamer' in pkg)) return 'its folder, or its package.json with a "dreamteamer" key, is gone';
	if (!fs.existsSync(path.join(root, TARGET_BIN))) return `${TARGET_BIN.split(path.sep).join('/')} is not installed there (npm i @dreamteamer/web)`;
	return null;
}

/**
 * `POST /_dt/handoff { id }`. → `{ status, body }`: 200 `{ url }`, 404 for an id never registered, 409 for a root
 * that cannot serve, 400 for this workspace itself, 502 when the target did not pair.
 * @param {{ id: unknown, pageLevel: 'read'|'edit'|'admin', selfId: string, stateDir: string, runtimeDir?: string,
 *           moved: (to: { name: string, at: string }) => void, now?: () => number }} o
 */
export async function handoff({ id, pageLevel, selfId, stateDir, runtimeDir = defaultRuntimeDir(), moved, now = Date.now }) {
	const entry = typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? lookup(id, stateDir) : null;
	if (!entry) return { status: 404, body: { error: `no workspace ${String(id)} was opened on this machine` } };
	if (entry.id === selfId) return { status: 400, body: { error: `the pane already shows ${entry.name}` } };
	const missing = missingFor(entry.root);
	if (missing) return { status: 409, body: { error: `${entry.name} cannot take the pane: ${missing}` } };
	const env = { ...process.env, DT_WEB_RUNTIME_DIR: runtimeDir, DT_WEB_STATE_DIR: stateDir };
	let rt;
	try {
		rt = await ensureRunning(entry.root, { env, bin: path.join(entry.root, TARGET_BIN), log: () => {} });
	} catch (e) {
		return { status: 502, body: { error: `${entry.name} did not start: ${String(e?.message ?? e).split('\n')[0]}` } };
	}
	const cap = lowerLevel(pageLevel, readWorkspaceState(entry.root, stateDir).level);
	let url = null;
	try {
		const r = await fetch(`http://127.0.0.1:${rt.port}/_dt/pair`, {
			method: 'POST',
			headers: { authorization: `Bearer ${rt.controlToken}`, 'content-type': 'application/json' },
			body: JSON.stringify({ cap }),
			signal: AbortSignal.timeout(10_000),
		});
		if (r.ok) url = (await r.json())?.url ?? null;
	} catch { /* below */ }
	if (typeof url !== 'string' || !url.startsWith(`http://127.0.0.1:${rt.port}/sign-in/`)) return { status: 502, body: { error: `${entry.name} did not pair` } };
	moved({ name: entry.name, at: new Date(now()).toISOString() });
	return { status: 200, body: { url } };
}
