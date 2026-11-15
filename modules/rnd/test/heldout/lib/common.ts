// Shared by the held-out prototype-harness tests: a prototype folder inside a throwaway workspace, an injected
// `dt(args)` that answers the bridge's `list <c> --json` and `get collections/<c> --json` calls from rows held
// in memory (shaped like the engine's output), quiet io, and the bin's own exit contract for a thrown error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const REPO = path.resolve(RND, '..', '..');
export const BIN = path.join(RND, 'bin', 'dt-prototype.mjs');

const made = [];
export const cleanup = () => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); };

/** a workspace root (package.json + package-lock.json) with an empty prototype folder `<name>` under it */
export function protoDir(name = 'northwind-proto') {
	const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'heldout-ws-'))); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), '{"name":"northwind","private":true,"type":"module"}\n');
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}\n');
	const dir = path.join(ws, name); fs.mkdirSync(dir, { recursive: true });
	return { ws, dir };
}

export function put(dir, rel, text) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; }
export const js = (v) => JSON.stringify(v, null, '\t');

/**
 * An injected runner: `rows` maps a collection (`rnd/screens`) to its rows, `descriptors` maps it to the
 * `get collections/<c> --json` answer (default `{ name, fields: {} }`). Every argv is recorded on `.calls`.
 * Any other verb records and returns '' (a `dt set` succeeds silently).
 */
export function fakeDt(rows, descriptors = {}) {
	const calls = [];
	const fn = (args) => {
		calls.push([...args]);
		if (args[0] === 'list' && args[2] === '--json') return JSON.stringify(rows[args[1]] ?? []);
		if (args[0] === 'get' && args[1].startsWith('collections/') && args[2] === '--json') {
			const c = args[1].slice('collections/'.length);
			return JSON.stringify(descriptors[c] ?? { name: c, fields: {} });
		}
		return '';
	};
	fn.calls = calls;
	return fn;
}

export const quiet = () => { const lines = []; return { lines, text: () => lines.join('\n'), log: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) }; };

/** run a verb's `run()` under the bin's contract: a thrown error prints its message and exits 1 */
export async function exitOf(fn, io) {
	try { return await fn(); } catch (e) { io.error(e.message); return 1; }
}

export const bytes = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
