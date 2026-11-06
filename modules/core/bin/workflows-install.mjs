#!/usr/bin/env node
// `npx dt-workflows` — the workflows the installed modules ship, copied into this workspace.
//
// A module installed from npm cannot own records (node_modules is never committed), and a workflow is
// the workspace's to edit. So a module ships each workflow at `data/workflows/<id>.workflow.md` inside
// its package — a folder compile does not read — and this copies one, verbatim, into the workspace's
// own `workflows` folder. It refuses a workflow that names a command or a collection the workspace has
// not compiled, and never overwrites the workspace's copy without --force.
//
//   npx dt-workflows list                          every shipped workflow: missing · installed · edited
//   npx dt-workflows install <id>… | --all         copy into data/workflows/ [--force] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

const USAGE = [
	'usage: npx dt-workflows list',
	'       npx dt-workflows install <id>… | --all  [--force] [--dry-run]',
].join('\n');

/** The module roots the last compile recorded, workspace-relative — the workspace's own root excluded. */
export function moduleRoots(ws) {
	const manifest = path.join(ws, '.dreamteamer', 'manifest.yaml');
	if (!fs.existsSync(manifest)) return null;
	const text = fs.readFileSync(manifest, 'utf8');
	const block = text.split(/^modules:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
	const out = [];
	for (const entry of block.split(/^\s*-\s+(?=name:)/m).slice(1)) {
		const name = /name:\s*'?([^'\n]+)'?/.exec(entry)?.[1]?.trim();
		const root = /root:\s*'?([^'\n]+)'?/.exec(entry)?.[1]?.trim();
		if (!name || !root || path.resolve(ws, root) === path.resolve(ws)) continue;
		out.push({ name, root });
	}
	return out;
}

/** Does this module keep its LIVE records beside itself? Then its data/ is a store, not shipped workflows. */
const ownsData = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dreamteamer?.owns_data === true; } catch { return false; } };

/** Every workflow the compiled modules ship: { id, module, file }. The first module to ship an id wins. */
export function shippedWorkflows(ws) {
	const roots = moduleRoots(ws) ?? [];
	const seen = new Map();
	for (const { name, root } of roots) {
		const dir = path.join(ws, root);
		const wf = path.join(dir, 'data', 'workflows');
		if (ownsData(dir) || !fs.existsSync(wf)) continue;
		for (const f of fs.readdirSync(wf).filter((n) => n.endsWith('.workflow.md')).sort()) {
			const id = f.slice(0, -'.workflow.md'.length);
			if (!seen.has(id)) seen.set(id, { id, module: name, file: path.join(wf, f) });
		}
	}
	return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The frontmatter of a markdown record, as text. */
const frontmatterOf = (text) => (text.startsWith('---') ? text.slice(3, text.indexOf('\n---', 3) === -1 ? undefined : text.indexOf('\n---', 3)) : '');

/** Every `commands/<id>` and `collections/<name>` reference in a workflow's frontmatter, de-duplicated. */
export function refsOf(text) {
	return [...new Set(frontmatterOf(text).match(/\b(?:commands|collections)\/[a-z0-9][a-z0-9/-]*[a-z0-9]/g) ?? [])].sort();
}

/** The references this workspace has not compiled — a command or a collection no installed module provides. */
export function missingRefs(ws, refs) {
	const rt = path.join(ws, '.dreamteamer');
	return refs.filter((ref) => {
		const [kind, ...rest] = ref.split('/');
		const id = rest.join('/');
		return !fs.existsSync(kind === 'commands' ? path.join(rt, 'commands', `${id}.command.md`) : path.join(rt, 'collections', `${id}.collection.yaml`));
	});
}

/** Where `workflows` records live in this workspace, from the compiled descriptor; null when it is not compiled. */
export function workflowsDir(ws) {
	const f = path.join(ws, '.dreamteamer', 'collections', 'workflows.collection.yaml');
	if (!fs.existsSync(f)) return null;
	const at = /^storage:\s*\n(?:[ \t]+.*\n)*?[ \t]+path:\s*'?([^'\n]+)'?/m.exec(fs.readFileSync(f, 'utf8'))?.[1]?.trim();
	return at ? path.resolve(ws, at) : null;
}

/** The state of one shipped workflow in this workspace. */
export function stateOf(ws, wf, dir = workflowsDir(ws)) {
	const at = dir && path.join(dir, `${wf.id}.workflow.md`);
	if (!at || !fs.existsSync(at)) return 'missing';
	return fs.readFileSync(at).equals(fs.readFileSync(wf.file)) ? 'installed' : 'edited';
}

/** Install one shipped workflow. Returns { ok, line } — never throws for a refusal. */
export function install(ws, wf, { force = false, dryRun = false } = {}) {
	const dir = workflowsDir(ws);
	if (!dir) return { ok: false, line: `✖ ${wf.id}: the workflows collection is not compiled here — install @dreamteamer/core (or @dreamteamer/core) and run dt compile` };
	const missing = missingRefs(ws, refsOf(fs.readFileSync(wf.file, 'utf8')));
	if (missing.length) return { ok: false, line: `✖ ${wf.id}: names ${missing.join(', ')}, which this workspace has not compiled — install the module that ships ${missing.length > 1 ? 'them' : 'it'}, then dt compile` };
	const state = stateOf(ws, wf, dir);
	const dest = path.relative(ws, path.join(dir, `${wf.id}.workflow.md`));
	if (state === 'installed') return { ok: true, line: `✔ ${wf.id}: already installed, identical to the one ${wf.module} ships — ${dest}` };
	if (state === 'edited' && !force) return { ok: false, line: `✖ ${wf.id}: ${dest} differs from the one ${wf.module} ships — it is this workspace's copy; --force replaces it (git keeps the old one)` };
	if (dryRun) return { ok: true, line: `would ${state === 'edited' ? 'replace' : 'write'} ${dest} from ${wf.module}` };
	fs.mkdirSync(dir, { recursive: true });
	fs.copyFileSync(wf.file, path.join(dir, `${wf.id}.workflow.md`));
	return { ok: true, line: `✔ ${wf.id}: ${state === 'edited' ? 'replaced' : 'wrote'} ${dest} from ${wf.module} — now: dt check, then dt commit workflows/${wf.id}` };
}

export function main(argv, ws = findWorkspace()) {
	const [verb, ...rest] = argv;
	if (!verb || verb === '--help' || verb === '-h') { console.error(USAGE); return verb ? 0 : 2; }
	if (!ws) { console.error('✖ no workspace here — run from inside one (a folder with package.json and package-lock.json)'); return 2; }
	if (!moduleRoots(ws)) { console.error('✖ no compiled runtime — run dt compile first'); return 2; }
	const shipped = shippedWorkflows(ws);
	if (verb === 'list') {
		if (!shipped.length) { console.log('no installed module ships a workflow'); return 0; }
		const dir = workflowsDir(ws);
		for (const wf of shipped) {
			const missing = missingRefs(ws, refsOf(fs.readFileSync(wf.file, 'utf8')));
			console.log(`${wf.id}  ${wf.module}  ${stateOf(ws, wf, dir)}${missing.length ? `  (needs ${missing.join(', ')})` : ''}`);
		}
		return 0;
	}
	if (verb !== 'install') { console.error(USAGE); return 2; }
	const flags = new Set(rest.filter((a) => a.startsWith('--')));
	const unknown = [...flags].filter((f) => !['--all', '--force', '--dry-run'].includes(f));
	if (unknown.length) { console.error(`✖ unknown flag ${unknown.join(', ')}\n${USAGE}`); return 2; }
	const ids = rest.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^workflows\//, ''));
	if (!ids.length && !flags.has('--all')) { console.error(USAGE); return 2; }
	const byId = new Map(shipped.map((w) => [w.id, w]));
	const unshipped = ids.filter((id) => !byId.has(id));
	if (unshipped.length) { console.error(`✖ no installed module ships ${unshipped.join(', ')} — npx dt-workflows list shows what is shipped`); return 1; }
	let code = 0;
	for (const wf of flags.has('--all') ? shipped : ids.map((id) => byId.get(id))) {
		const r = install(ws, wf, { force: flags.has('--force'), dryRun: flags.has('--dry-run') });
		(r.ok ? console.log : console.error)(r.line);
		if (!r.ok) code = 1;
	}
	return code;
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
