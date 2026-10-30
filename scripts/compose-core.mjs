#!/usr/bin/env node
// COMPOSE @dreamteamer/core from the small official modules — copies, never a second authoring place.
//
// `modules/core/compose.json` names the origins; this script copies every shipped source file of each
// origin into modules/core under ONE deterministic rewrite, merges the eleven manifests into core's
// package.json, and records every copy with its hash in compose.json's `files`. The drift test
// (modules/core/test/compose.test.mjs) recomputes the same copies from the origins and fails when a
// copy differs — so a descriptor is still authored in exactly one module, and core is what npm gets
// when a workspace wants every core noun from one install line.
//
//   node scripts/compose-core.mjs            regenerate modules/core (copies, compose.json, package.json)
//   node scripts/compose-core.mjs --check    exit 1 on drift, write nothing
//
// Where a copy lands:
//   collections/<path>  → collections/<origin>/<path>   (an origin's overlay of another origin's base keeps its folder)
//   bin/<script>        → bin/<origin>-<script>          (users and projects both ship check-records.mjs)
//   src/**              → src/**                         (from the ONE origin that is an extension)
//   everything else     → the same path; a collision across origins fails the run
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE = path.join(ROOT, 'modules', 'core');
const KINDS = ['collections', 'mixins', 'skills', 'commands', 'command-bindings', 'ui-views', 'agents', 'bin', 'src', 'lib'];
const TEXT = /\.(md|ya?ml|m?js|cjs|json|txt|py|sh|css|html)$/;

/** The one text transform a copy undergoes: the origin's package name becomes core's, and a path into
 *  the origin's bin names core's prefixed script. Applied to every copied text file, and by the drift
 *  test to its expectation. */
export function rewrite(text, origin) {
	return text
		.replace(new RegExp(`@dreamteamer/${origin}/bin/`, 'g'), `@dreamteamer/core/bin/${origin}-`)
		.replace(new RegExp(`modules/${origin}/bin/`, 'g'), `modules/core/bin/${origin}-`)
		.replace(new RegExp(`@dreamteamer/${origin}(?![\\w-])`, 'g'), '@dreamteamer/core');
}

/** Where an origin's shipped file lands inside core. */
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

/** Every shipped source file of an origin, as { rel, dest, bytes } — README and package.json excluded. */
export function copiesOf(origin) {
	const root = path.join(ROOT, 'modules', origin);
	const pkg = readJson(path.join(root, 'package.json'));
	const out = [];
	for (const kind of pkg.files.filter((k) => KINDS.includes(k))) {
		const dir = path.join(root, kind);
		if (!fs.existsSync(dir)) continue;
		for (const rel of walk(dir).map((r) => `${kind}/${r}`)) {
			const raw = fs.readFileSync(path.join(root, rel));
			const bytes = TEXT.test(rel) ? Buffer.from(rewrite(raw.toString('utf8'), origin), 'utf8') : raw;
			out.push({ rel, dest: destOf(origin, rel), bytes });
		}
	}
	return out;
}

/** The composition as data: the copies and the merged manifest, computed from the origins alone. */
export function compose() {
	const spec = readJson(path.join(CORE, 'compose.json'));
	const copies = new Map(); // dest -> { from, bytes }
	const manifests = spec.origins.map((o) => ({ origin: o, pkg: readJson(path.join(ROOT, 'modules', o, 'package.json')) }));
	for (const { origin } of manifests) {
		for (const c of copiesOf(origin)) {
			if (copies.has(c.dest)) throw new Error(`${origin}/${c.rel} would land on ${c.dest}, already taken by ${copies.get(c.dest).from}`);
			copies.set(c.dest, { from: `${origin}/${c.rel}`, bytes: c.bytes });
		}
	}
	const dts = manifests.map((m) => m.pkg.dreamteamer ?? {});
	const extensions = manifests.filter((m) => m.pkg.dreamteamer?.extension);
	if (extensions.length > 1) throw new Error(`two origins are extensions: ${extensions.map((m) => m.origin).join(', ')} — core can declare one entry`);
	const internal = new Set(spec.origins.map((o) => `@dreamteamer/${o}`));
	for (const { origin, pkg } of manifests) for (const d of pkg.dreamteamer?.dependencies ?? []) {
		if (!internal.has(d)) throw new Error(`${origin} depends on ${d}, which is not an origin — core would not compile alone`);
	}
	// what core owns: every base collection among the copies, plus core's own bases
	const owned = new Set();
	const yamlName = (text) => text.match(/^name:\s*(\S+)/m)?.[1];
	for (const [dest, { bytes }] of copies) if (dest.endsWith('.collection.yaml') && !/^overlay:\s*true/m.test(bytes.toString('utf8'))) owned.add(yamlName(bytes.toString('utf8')));
	if (fs.existsSync(path.join(CORE, 'collections', 'core'))) {
		for (const rel of walk(path.join(CORE, 'collections', 'core')).filter((f) => f.endsWith('.collection.yaml'))) {
			const text = fs.readFileSync(path.join(CORE, 'collections', 'core', rel), 'utf8');
			if (!/^overlay:\s*true/m.test(text)) owned.add(yamlName(text));
		}
	}
	const union = (key) => [...new Set(dts.flatMap((d) => d[key] ?? []))].sort();
	const existing = fs.existsSync(path.join(CORE, 'package.json')) ? readJson(path.join(CORE, 'package.json')) : {};
	const kindsPresent = (list) => KINDS.filter((k) => list.some((f) => f.startsWith(`${k}/`)));
	const allDests = [...copies.keys(), ...(fs.existsSync(CORE) ? walk(CORE).filter((f) => !f.startsWith('test/')) : [])];
	const manifest = {
		name: '@dreamteamer/core',
		version: existing.version ?? '0.1.0',
		description: spec.description,
		license: 'Apache-2.0',
		type: 'module',
		repository: { type: 'git', url: 'git+https://github.com/dreamteamer/dreamteamer-modules.git', directory: 'modules/core' },
		keywords: ['dreamteamer', 'dreamteamer-module', 'core', ...spec.origins],
		files: ['README.md', 'compose.json', ...kindsPresent(allDests)],
		...(Object.keys(Object.assign({}, ...manifests.map((m) => m.pkg.dependencies ?? {}))).length
			? { dependencies: Object.assign({}, ...manifests.map((m) => m.pkg.dependencies ?? {})) } : {}),
		dreamteamer: {
			...(extensions.length ? { extension: extensions[0].pkg.dreamteamer.extension } : {}),
			title: spec.title,
			description: spec.orientation,
			engine: `>=${dts.map((d) => (d.engine ?? '>=0.0.0').replace(/^>=/, '')).reduce(newer)}`,
			...(union('env').length ? { env: union('env') } : {}),
			...(union('vars').length ? { vars: union('vars') } : {}),
			...(union('peer_collections').filter((p) => !owned.has(p)).length ? { peer_collections: union('peer_collections').filter((p) => !owned.has(p)) } : {}),
		},
	};
	return { spec, copies, manifest, owned };
}

/** What compose.json's `files` should say for these copies. */
export const filesEntry = (copies) => Object.fromEntries([...copies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dest, { from, bytes }]) => [dest, { from, hash: hash(bytes) }]));

export function main(argv) {
	const check = argv.includes('--check');
	const { spec, copies, manifest } = compose();
	const files = filesEntry(copies);
	const problems = [];
	for (const [dest, { bytes }] of copies) {
		const at = path.join(CORE, dest);
		if (!fs.existsSync(at)) problems.push(`missing ${dest}`);
		else if (!fs.readFileSync(at).equals(bytes)) problems.push(`drifted ${dest} (from ${files[dest].from})`);
	}
	for (const dest of Object.keys(spec.files ?? {})) if (!copies.has(dest)) problems.push(`stale ${dest} — listed, no origin ships it`);
	const pkgPath = path.join(CORE, 'package.json');
	if (!fs.existsSync(pkgPath) || JSON.stringify(readJson(pkgPath)) !== JSON.stringify(manifest)) problems.push('package.json is not the merged manifest');
	if (JSON.stringify(spec.files ?? {}) !== JSON.stringify(files)) problems.push('compose.json files do not match the copies');
	if (check) {
		if (problems.length) { console.error(`core is out of date:\n  ${problems.join('\n  ')}\n  run: node scripts/compose-core.mjs`); return 1; }
		console.log(`core is composed: ${copies.size} files from ${spec.origins.length} origins`);
		return 0;
	}
	for (const dest of Object.keys(spec.files ?? {})) fs.rmSync(path.join(CORE, dest), { force: true });
	for (const [dest, { bytes }] of copies) { fs.mkdirSync(path.dirname(path.join(CORE, dest)), { recursive: true }); fs.writeFileSync(path.join(CORE, dest), bytes); }
	fs.writeFileSync(path.join(CORE, 'compose.json'), JSON.stringify({ ...spec, files }, null, '\t') + '\n');
	fs.writeFileSync(pkgPath, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`composed ${copies.size} files from ${spec.origins.join(', ')}${problems.length ? ` (${problems.length} were out of date)` : ''}`);
	return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
