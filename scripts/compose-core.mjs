#!/usr/bin/env node
// COMPOSE a module from other official modules — copies, never a second authoring place.
//
// A module with `compose.json` at its root names its `origins` (and may name `engine`, a floor of the module's own, for what its own
// commands need of the engine beyond what the origins do, and `env` and `vars`, the keys its OWN collections and scripts read — core's
// `sessions` keeps its records under `${env:SESSIONS_FOLDER}`); this script copies every shipped
// source file of each origin into the module under ONE deterministic rewrite, merges the origins'
// manifests into the module's package.json, and records every copy with its hash in compose.json's
// `files`. The drift test beside each composed module (`modules/<id>/test/compose.test.mjs`)
// recomputes the same copies from the origins and fails when a copy differs — so a descriptor is
// still authored in exactly one module, and the composed package is what npm gets when a workspace
// wants the whole set from one install line.
//
// Two composed modules, two shapes. `core` authors no package of its own: its name, title and the two
// descriptions live in compose.json and the manifest is built from the origins alone. `rnd` authors a
// whole module (its collections under `collections/rnd/`, its skills, commands and agents) and
// composes `wikis` and `notebooklm` INTO it: its package.json keeps every authored field — name,
// title, namespaces, description, engine floor, peers — and the origins add their env, vars, peers,
// npm dependencies and `bin` entries, and the one extension entry (with its `src/`).
//
//   node scripts/compose-core.mjs                  regenerate every composed module
//   node scripts/compose-core.mjs rnd              regenerate one (copies, compose.json, package.json)
//   node scripts/compose-core.mjs --check [id…]    exit 1 on drift, write nothing
//
// Where a copy lands:
//   collections/<path>  → collections/<origin>/<path>   (an origin's overlay of another origin's base keeps its folder)
//   bin/<script>        → bin/<origin>-<script>          (users and projects both ship check-records.mjs)
//   src/**              → src/**                         (from the ONE origin that is an extension)
//   everything else     → the same path; a collision across origins fails the run unless the bytes
//                         are identical (the `lib/workspace-root.mjs` every script-bearing module carries)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODULES = path.join(ROOT, 'modules');
export const CORE = path.join(MODULES, 'core');
export const moduleRoot = (id) => path.join(MODULES, id);
/** Every module with a compose.json at its root. */
export const composedModules = () => fs.readdirSync(MODULES).filter((m) => fs.existsSync(path.join(MODULES, m, 'compose.json'))).sort();

const KINDS = ['collections', 'mixins', 'skills', 'commands', 'command-bindings', 'ui-views', 'agents', 'bin', 'src', 'lib'];
const TEXT = /\.(md|ya?ml|m?js|cjs|json|txt|py|sh|css|html)$/;
const REPO_URL = 'git+https://github.com/dreamteamer/dreamteamer-modules.git';

/** The one text transform a copy undergoes: the origin's package name becomes the composed module's,
 *  and a path into the origin's bin names the composed module's prefixed script. Applied to every
 *  copied text file, and by the drift test to its expectation. */
export function rewrite(text, origin, target = 'core') {
	return text
		.replace(new RegExp(`@dreamteamer/${origin}/bin/`, 'g'), `@dreamteamer/${target}/bin/${origin}-`)
		.replace(new RegExp(`modules/${origin}/bin/`, 'g'), `modules/${target}/bin/${origin}-`)
		.replace(new RegExp(`@dreamteamer/${origin}(?![\\w-])`, 'g'), `@dreamteamer/${target}`);
}

/** Where an origin's shipped file lands inside the composed module. */
export function destOf(origin, rel) {
	const [kind, ...rest] = rel.split('/');
	if (kind === 'collections') return path.posix.join('collections', origin, ...rest);
	if (kind === 'bin') return path.posix.join('bin', `${origin}-${rest.join('/')}`);
	return rel;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const walk = (dir, out = [], base = dir) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out, base);
		else out.push(path.relative(base, p).split(path.sep).join('/'));
	}
	return out;
};
const hash = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? a : b; return a; };
const floorOf = (range) => (range ?? '>=0.0.0').replace(/^>=/, '');

/** Every shipped source file of an origin, as { rel, dest, bytes } — README and package.json excluded. */
export function copiesOf(origin, target = 'core') {
	const root = moduleRoot(origin);
	const pkg = readJson(path.join(root, 'package.json'));
	const out = [];
	for (const kind of pkg.files.filter((k) => KINDS.includes(k))) {
		const dir = path.join(root, kind);
		if (!fs.existsSync(dir)) continue;
		for (const rel of walk(dir).map((r) => `${kind}/${r}`)) {
			const raw = fs.readFileSync(path.join(root, rel));
			const bytes = TEXT.test(rel) ? Buffer.from(rewrite(raw.toString('utf8'), origin, target), 'utf8') : raw;
			out.push({ rel, dest: destOf(origin, rel), bytes });
		}
	}
	return out;
}

/** The composition as data: the copies and the merged manifest, computed from the origins and the
 *  module's own authored manifest. A composed module's own sources are never touched. */
export function compose(target = 'core') {
	const root = moduleRoot(target);
	const spec = readJson(path.join(root, 'compose.json'));
	const listed = spec.files ?? {};
	const copies = new Map(); // dest -> { from, bytes }
	const manifests = spec.origins.map((o) => ({ origin: o, pkg: readJson(path.join(moduleRoot(o), 'package.json')) }));
	for (const { origin } of manifests) {
		for (const c of copiesOf(origin, target)) {
			const taken = copies.get(c.dest);
			if (taken && !taken.bytes.equals(c.bytes)) throw new Error(`${origin}/${c.rel} would land on ${c.dest}, already taken by ${taken.from}`);
			if (!taken) copies.set(c.dest, { from: `${origin}/${c.rel}`, bytes: c.bytes });
		}
	}
	const isCopy = (dest) => copies.has(dest) || dest in listed;
	const existing = fs.existsSync(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : {};
	const authored = existing.dreamteamer ?? {};
	const dts = [authored, ...manifests.map((m) => m.pkg.dreamteamer ?? {})];
	// the ONE extension: an origin's, or the module's own — never both, since both would ship src/
	const extensions = manifests.filter((m) => m.pkg.dreamteamer?.extension);
	if (extensions.length > 1) throw new Error(`two origins are extensions: ${extensions.map((m) => m.origin).join(', ')} — a module can declare one entry`);
	const extension = extensions[0]?.pkg.dreamteamer.extension ?? authored.extension;
	if (extensions.length && authored.extension && authored.extension !== extension) throw new Error(`${target} declares its own extension ${authored.extension} and ${extensions[0].origin} brings ${extension} — a module can declare one entry`);
	if (extensions.length && fs.existsSync(path.join(root, 'src')) && walk(path.join(root, 'src')).some((f) => !isCopy(`src/${f}`))) throw new Error(`${target}/src/ holds files of its own, and ${extensions[0].origin} lands its src/ there`);
	// an origin may depend only on another origin (or the module itself): the composition compiles alone
	const internal = new Set([...spec.origins, target].map((o) => `@dreamteamer/${o}`));
	for (const { origin, pkg } of manifests) for (const d of pkg.dreamteamer?.dependencies ?? []) {
		if (!internal.has(d)) throw new Error(`${origin} depends on ${d}, which is not an origin — ${target} would not compile alone`);
	}
	// what the module owns: every base collection among the copies, plus its own authored bases
	const owned = new Set();
	const yamlName = (text) => text.match(/^name:\s*(\S+)/m)?.[1];
	const isBase = (text) => !/^overlay:\s*true/m.test(text);
	for (const [dest, { bytes }] of copies) if (dest.endsWith('.collection.yaml') && isBase(bytes.toString('utf8'))) owned.add(yamlName(bytes.toString('utf8')));
	if (fs.existsSync(path.join(root, 'collections'))) {
		for (const rel of walk(path.join(root, 'collections')).filter((f) => f.endsWith('.collection.yaml'))) {
			if (isCopy(`collections/${rel}`)) continue; // a copy, judged above
			const text = fs.readFileSync(path.join(root, 'collections', rel), 'utf8');
			if (isBase(text)) owned.add(yamlName(text));
		}
	}
	const union = (key) => [...new Set([...(spec[key] ?? []), ...dts.flatMap((d) => d[key] ?? [])])].sort();
	const peers = union('peer_collections').filter((p) => !owned.has(p));
	const hardDeps = (authored.dependencies ?? []).filter((d) => !internal.has(d));
	const npmDeps = Object.assign({}, existing.dependencies ?? {}, ...manifests.map((m) => m.pkg.dependencies ?? {}));
	// the origins' npm `bin` entries, pointed at the prefixed copies — `npx dt-wiki` keeps working
	const bins = { ...(existing.bin ?? {}) };
	for (const { origin, pkg } of manifests) for (const [name, script] of Object.entries(pkg.bin ?? {})) {
		const at = destOf(origin, script.replace(/^\.\//, ''));
		if (bins[name] && bins[name] !== at) throw new Error(`bin ${name}: ${origin} brings ${at}, already ${bins[name]}`);
		bins[name] = at;
	}
	const kindsPresent = (list) => KINDS.filter((k) => list.some((f) => f.startsWith(`${k}/`)));
	const allDests = [...copies.keys(), ...(fs.existsSync(root) ? walk(root).filter((f) => !f.startsWith('test/')) : [])];
	const KNOWN = new Set(['name', 'version', 'description', 'license', 'type', 'repository', 'keywords', 'bin', 'files', 'dependencies', 'dreamteamer']);
	const KNOWN_DT = new Set(['extension', 'title', 'namespaces', 'description', 'engine', 'env', 'vars', 'peer_collections', 'dependencies']);
	const rest = (obj, known) => Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
	const manifest = {
		name: `@dreamteamer/${target}`,
		version: existing.version ?? '0.1.0',
		description: spec.description ?? existing.description,
		license: 'Apache-2.0',
		type: 'module',
		repository: { type: 'git', url: REPO_URL, directory: `modules/${target}` },
		keywords: [...new Set([...(existing.keywords ?? ['dreamteamer', 'dreamteamer-module', target]), ...spec.origins])],
		...(Object.keys(bins).length ? { bin: bins } : {}),
		files: ['README.md', 'compose.json', ...kindsPresent(allDests)],
		...(Object.keys(npmDeps).length ? { dependencies: npmDeps } : {}),
		...rest(existing, KNOWN),
		dreamteamer: {
			...(extension ? { extension } : {}),
			title: spec.title ?? authored.title,
			...(authored.namespaces ? { namespaces: authored.namespaces } : {}),
			description: spec.orientation ?? authored.description,
			engine: `>=${[...dts.map((d) => floorOf(d.engine)), floorOf(spec.engine)].reduce(newer)}`,
			...(union('env').length ? { env: union('env') } : {}),
			...(union('vars').length ? { vars: union('vars') } : {}),
			...(peers.length ? { peer_collections: peers } : {}),
			...(hardDeps.length ? { dependencies: hardDeps } : {}),
			...rest(authored, KNOWN_DT),
		},
	};
	return { spec, copies, manifest, owned, root };
}

/** What compose.json's `files` should say for these copies. */
export const filesEntry = (copies) => Object.fromEntries([...copies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dest, { from, bytes }]) => [dest, { from, hash: hash(bytes) }]));

/** Everything out of date in one composed module — `[]` when it is composed. */
export function problemsOf(target) {
	const { spec, copies, manifest, root } = compose(target);
	const files = filesEntry(copies);
	const problems = [];
	for (const [dest, { bytes }] of copies) {
		const at = path.join(root, dest);
		if (!fs.existsSync(at)) problems.push(`missing ${dest}`);
		else if (!fs.readFileSync(at).equals(bytes)) problems.push(`drifted ${dest} (from ${files[dest].from})`);
	}
	for (const dest of Object.keys(spec.files ?? {})) if (!copies.has(dest)) problems.push(`stale ${dest} — listed, no origin ships it`);
	const pkgPath = path.join(root, 'package.json');
	if (!fs.existsSync(pkgPath) || JSON.stringify(readJson(pkgPath)) !== JSON.stringify(manifest)) problems.push('package.json is not the merged manifest');
	if (JSON.stringify(spec.files ?? {}) !== JSON.stringify(files)) problems.push('compose.json files do not match the copies');
	return problems;
}

function composeOne(target, check) {
	const { spec, copies, manifest, root } = compose(target);
	const files = filesEntry(copies);
	const problems = problemsOf(target);
	if (check) {
		if (problems.length) { console.error(`${target} is out of date:\n  ${problems.join('\n  ')}\n  run: node scripts/compose-core.mjs ${target}`); return 1; }
		console.log(`${target} is composed: ${copies.size} files from ${spec.origins.length} origins`);
		return 0;
	}
	for (const dest of Object.keys(spec.files ?? {})) fs.rmSync(path.join(root, dest), { force: true });
	for (const [dest, { bytes }] of copies) { fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true }); fs.writeFileSync(path.join(root, dest), bytes); }
	fs.writeFileSync(path.join(root, 'compose.json'), JSON.stringify({ ...spec, files }, null, '\t') + '\n');
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`${target}: composed ${copies.size} files from ${spec.origins.join(', ')}${problems.length ? ` (${problems.length} were out of date)` : ''}`);
	return 0;
}

export function main(argv) {
	const check = argv.includes('--check');
	const named = argv.filter((a) => !a.startsWith('--'));
	const targets = named.length ? named : composedModules();
	let code = 0;
	for (const t of targets) {
		if (!fs.existsSync(path.join(moduleRoot(t), 'compose.json'))) { console.error(`${t} has no compose.json — nothing to compose`); return 1; }
		code = Math.max(code, composeOne(t, check));
	}
	return code;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
