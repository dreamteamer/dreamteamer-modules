#!/usr/bin/env node
// migrate-personas — bring a workspace's records to the one-persona-collection shape of rnd 0.3.0:
// `rnd/product-user-personas` folds into `rnd/personas` under `kind: product-role`, every existing
// persona becomes `kind: panel`, and `rnd/persona-probes` is dropped.
//
//   node node_modules/@dreamteamer/rnd/bin/migrate-personas.mjs --dry-run   # the plan, nothing written
//   node node_modules/@dreamteamer/rnd/bin/migrate-personas.mjs --write     # apply it
//   … [--root <workspace>] [--json]
//
// What changes, file by file:
//   data/rnd/product-user-personas/<id>.*.md → data/rnd/personas/<id>.persona.md, `kind: product-role` added
//   data/rnd/personas/<id>.persona.md        gains `kind: panel` when it carries no `kind`
//   rnd/product-user-personas/<id>           → rnd/personas/<id>, in every text file under data/
//   data/rnd/persona-probes/                 DELETED — the held-out questions a panel was scored against have
//                                            no collection any more; copy what you want to keep out first
//   rnd/persona-probes/<id>                  reported with its file and line, never rewritten: the target is
//                                            gone, so each one is yours to resolve
// A workspace already in shape is a no-op (`records 0 · refs 0`), so a second run changes nothing. A role
// whose id an existing persona already holds is a collision: the plan names it and --write refuses whole.
// The script edits files, not the engine's store — the collection it moves records out of has left the
// compiled schema by the time it runs. Run `dt compile` on 0.3.0, then this, then `dt relations rebuild
// rnd/personas` (the generated mirrors a moved role now owns) and `dt check`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

export const FROM = 'rnd/product-user-personas';
export const TO = 'rnd/personas';
export const PROBES = 'rnd/persona-probes';
const SUFFIX = 'persona';
const TEXT = /\.(md|ya?ml|json|txt)$/;
const REF_FROM = /\brnd\/product-user-personas\//g;
const REF_PROBE = /\brnd\/persona-probes\//g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** `kind: <kind>` into a record's frontmatter when it has no top-level `kind`; a record with none gets one. */
export function stampKind(text, kind) {
	const m = FRONTMATTER.exec(text);
	if (!m) return { text: `---\nkind: ${kind}\n---\n${text}`, changed: true };
	if (/^kind:/m.test(m[1])) return { text, changed: false };
	return { text: text.replace(/^---\r?\n/, (head) => `${head}kind: ${kind}\n`), changed: true };
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.isFile() && TEXT.test(e.name)) yield p;
	}
}

/**
 * The plan for one workspace — pure, reads only. `files` is every file the write touches, each with
 * where it goes, the kind it gains and the references it rewrites; `records` counts the moved and the
 * stamped, `refs` the rewritten reference strings.
 */
export function plan(root) {
	const data = path.join(root, 'data');
	const fromDir = path.join(data, FROM), toDir = path.join(data, TO), probesDir = path.join(data, PROBES);
	const files = new Map();
	const touch = (from) => files.get(from) ?? files.set(from, { from, to: from, kind: null, refs: 0 }).get(from);
	const collisions = [];
	if (isDir(fromDir)) {
		for (const f of fs.readdirSync(fromDir).sort()) {
			const m = /^([^.]+)\.[^.]+\.md$/.exec(f);
			if (!m || !fs.statSync(path.join(fromDir, f)).isFile()) continue;
			const to = path.join(toDir, `${m[1]}.${SUFFIX}.md`);
			if (fs.existsSync(to)) collisions.push({ id: m[1], role: rel(root, path.join(fromDir, f)), persona: rel(root, to) });
			const entry = touch(path.join(fromDir, f));
			entry.to = to;
			entry.kind = 'product-role';
		}
	}
	if (isDir(toDir)) {
		for (const f of fs.readdirSync(toDir).sort()) {
			const file = path.join(toDir, f);
			if (!f.endsWith(`.${SUFFIX}.md`) || !fs.statSync(file).isFile()) continue;
			if (stampKind(fs.readFileSync(file, 'utf8'), 'panel').changed) touch(file).kind = 'panel';
		}
	}
	const probeRefs = [];
	const probes = isDir(probesDir) ? [...walk(probesDir)].map((p) => rel(root, p)) : [];
	if (isDir(data)) {
		for (const file of walk(data)) {
			if (file.startsWith(probesDir + path.sep)) continue;
			const text = fs.readFileSync(file, 'utf8');
			const n = (text.match(REF_FROM) ?? []).length;
			if (n) touch(file).refs = n;
			text.split('\n').forEach((line, i) => { if (REF_PROBE.test(line)) probeRefs.push(`${rel(root, file)}:${i + 1}`); REF_PROBE.lastIndex = 0; });
		}
	}
	const list = [...files.values()].sort((a, b) => a.from.localeCompare(b.from));
	const records = list.filter((f) => f.kind || f.to !== f.from).length;
	const refs = list.reduce((n, f) => n + f.refs, 0);
	return { root, files: list, records, refs, probes, probeRefs, collisions };
}

/** Apply a plan. Refuses whole on a collision, so a half-moved workspace is never left behind. */
export function apply(p) {
	if (p.collisions.length) throw new Error(`refusing to write: ${p.collisions.map((c) => `${c.role} would land on ${c.persona}`).join('; ')}`);
	for (const f of p.files) {
		let text = fs.readFileSync(f.from, 'utf8');
		if (f.kind) text = stampKind(text, f.kind).text;
		if (f.refs) text = text.replace(REF_FROM, `${TO}/`);
		fs.mkdirSync(path.dirname(f.to), { recursive: true });
		fs.writeFileSync(f.to, text);
		if (f.to !== f.from) fs.unlinkSync(f.from);
	}
	const probesDir = path.join(p.root, 'data', PROBES);
	if (isDir(probesDir)) fs.rmSync(probesDir, { recursive: true, force: true });
	const fromDir = path.join(p.root, 'data', FROM);
	if (isDir(fromDir) && fs.readdirSync(fromDir).length === 0) fs.rmdirSync(fromDir);
}

export function render(p, { write }) {
	// the workspace first, always: the resolver falls back to the script's own tree when there is no
	// lockfile above the current folder, and a plan for the wrong workspace must be visible as one
	const lines = [`workspace ${p.root}`];
	for (const f of p.files) {
		const marks = [];
		if (f.to !== f.from) marks.push(`→ ${rel(p.root, f.to)}`);
		if (f.kind) marks.push(`kind: ${f.kind}`);
		if (f.refs) marks.push(`refs ${f.refs}`);
		lines.push(`${write ? '✔' : '·'} ${rel(p.root, f.from)}  ${marks.join(' · ')}`);
	}
	if (p.probes.length) lines.push(`${write ? '✔' : '·'} data/${PROBES}/  ${p.probes.length} file(s) ${write ? 'deleted' : 'to delete'}`);
	for (const r of p.probeRefs) lines.push(`! ${r}  names ${PROBES}/… — the target is gone; rewrite or remove it by hand`);
	for (const c of p.collisions) lines.push(`✕ ${c.role}  would land on ${c.persona} — rename one before --write`);
	lines.push(`records ${p.records} · refs ${p.refs}`);
	lines.push(write ? 'written' : 'nothing written — pass --write to apply');
	if (write && p.records) lines.push(`then: dreamteamer relations rebuild ${TO} (the generated journeys and user_stories mirrors) · dreamteamer check`);
	return lines.join('\n');
}

const USAGE = 'usage: migrate-personas.mjs (--dry-run | --write) [--root <workspace>] [--json]';

export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
	const args = [...argv];
	let write = false, dry = false, json = false, root = null;
	while (args.length) {
		const a = args.shift();
		if (a === '--write') write = true;
		else if (a === '--dry-run') dry = true;
		else if (a === '--json') json = true;
		else if (a === '--root') root = args.shift() ?? null;
		else { error(`${USAGE}\nunknown argument: ${a}`); return 2; }
	}
	if (write && dry) { error(`${USAGE}\n--dry-run and --write exclude each other`); return 2; }
	root = root ? path.resolve(cwd, root) : (findWorkspace(cwd) ?? findWorkspace(path.dirname(fileURLToPath(import.meta.url))));
	if (!root) { error('no workspace here or above this script (no package.json beside a package-lock.json)'); return 1; }
	const p = plan(root);
	if (write) {
		if (p.collisions.length) { error(render(p, { write: false })); error(`refusing to write: ${p.collisions.length} collision(s)`); return 1; }
		apply(p);
	}
	if (json) log(JSON.stringify({ written: write, root, records: p.records, refs: p.refs, probes: p.probes.length, probe_refs: p.probeRefs, collisions: p.collisions, files: p.files.map((f) => ({ from: rel(root, f.from), to: rel(root, f.to), kind: f.kind, refs: f.refs })) }, null, 2));
	else log(render(p, { write }));
	return 0;
}

/** Run as a script, including through a symlink: `process.argv[1]` is the path as invoked and
 *  `import.meta.url` the path resolved, so both are realpathed before they are compared. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) process.exit(main(process.argv.slice(2)));
