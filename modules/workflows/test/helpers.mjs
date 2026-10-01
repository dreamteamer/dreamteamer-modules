// Test support for @dreamteamer/workflows: the shared tier-2 fixture with THIS package installed.
//
// `workspace()` is `test-support/fixture.mjs`'s workspace with `packages: ['workflows']` — the
// package linked under node_modules and declared as a dependency, so the engine activates the
// extension and discovers its content module exactly as it would in a stranger's workspace. Every
// command runs through the real CLI (`ws.dt(...)`); an in-process call binds the SAME engine API the
// fixture loaded (`bind(api)` below), never a second engine copy.
import fs from 'node:fs';
import path from 'node:path';
import * as fixture from '../../../test-support/fixture.mjs';
import { bind } from '../src/engine.js';

export const { api, git, dt, dtStdin, dtIn, readFile, writeCollection, simpleCollection, compileError, GIT_ENV } = fixture;
bind(api);

/**
 * A fresh workspace with @dreamteamer/workflows installed.
 *
 * @param {object} [opts]
 * @param {object} [opts.pkg]          keys merged into the workspace's `dreamteamer` section
 * @param {object} [opts.collections]  name → descriptor, written to the workspace module
 * @param {object} [opts.records]      collection → [fields], added through the Store (not committed)
 * @param {boolean}[opts.compile]      false → leave it uncompiled
 */
export function workspace(opts = {}) {
	const w = fixture.workspace({ packages: ['workflows'], pkg: opts.pkg ?? {}, compile: false });
	for (const [name, d] of Object.entries(opts.collections ?? {})) writeCollection(w.root, name, d);
	const ws = api.findWorkspace(w.root);
	const handle = { ...w, ws, land: (...a) => w.dt('land', ...a), prove: (...a) => w.dt('prove', ...a) };
	if (opts.compile === false) return handle;
	const out = w.dt('compile');
	if (out.code !== 0) throw new Error(`fixture compile failed:\n${out.stdout}\n${out.stderr}`);
	const store = new api.Store(ws);
	for (const [collection, rows] of Object.entries(opts.records ?? {})) {
		for (const fields of rows) store.add(collection, { ...fields });
	}
	return { ...handle, store, out };
}

/** Write a proof source at `modules/default/proofs/<id>.proof.yaml`. The default `about` names the
 *  one skill every fixture has (the engine's), and the default is the cheapest valid gate. */
export function writeProof(root, id, fields = {}) {
	const file = path.join(root, 'modules', 'default', 'proofs', `${id}.proof.yaml`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, api.dumpYaml({ name: id, about: ['skills/using-dreamteamer'], kind: 'gate', steps: [{ run: 'true' }], ...fields }));
	return file;
}

/** Run `fn` with console output captured — for an in-process call whose chatter is not the point. */
export async function quietly(fn) {
	const lines = [];
	const saved = { log: console.log, warn: console.warn, error: console.error };
	console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
	try { return { value: await fn(), lines }; } finally { Object.assign(console, saved); }
}
