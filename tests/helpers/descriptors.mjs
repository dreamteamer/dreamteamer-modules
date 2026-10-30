// Every collection descriptor in the repo, read in the v2 shape: `fields` keyed by name, a field's
// `type` either a scalar or the name of the collection it points at, `many` for a list, `mirror_of`
// for a generated far side, `mixins` for a shared field set, and `overlay: true` for a file that adds
// fields to a collection another module owns. Shared by the gates that judge descriptors.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const MODULES = path.join(ROOT, 'modules');

/** The field types that name a value rather than a collection. */
export const SCALARS = new Set(['string', 'markdown', 'url', 'email', 'integer', 'number', 'boolean', 'date', 'datetime', 'object', 'map', 'reference']);
/** The engine's own collections a module may point at without owning or declaring them. */
export const CORE = new Set(['repos', 'modules', 'collections', 'skills', 'agents', 'commands', 'command-bindings', 'ui-views', 'collection-templates', 'mixins']);

function* files(dir, suffix) {
	if (!fs.existsSync(dir)) return;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* files(p, suffix);
		else if (p.endsWith(suffix)) yield p;
	}
}

export const moduleIds = () => fs.readdirSync(MODULES).filter((m) => fs.existsSync(path.join(MODULES, m, 'package.json'))).sort();

/** A COMPOSED module (`compose.json` at its root) carries copies of other modules' files. The copies are
 *  the origins' sources, judged where they are authored; the gates below see only what the module adds.
 *  `composed(m)` is the set of copied repo-relative paths; `originsOf(m)` the modules it is composed from. */
const composeOf = (m) => { const f = path.join(MODULES, m, 'compose.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
export const composed = (m) => new Set(Object.keys(composeOf(m)?.files ?? {}).map((d) => path.join('modules', m, d)));
export const originsOf = (m) => composeOf(m)?.origins ?? [];

/** Every descriptor module `m` AUTHORS: { module, file (repo-relative), doc }. Overlays included; a
 *  composed copy excluded (it is its origin's). */
export const descriptorsOf = (m) => {
	const copies = composed(m);
	return [...files(path.join(MODULES, m, 'collections'), '.collection.yaml')]
		.filter((f) => !copies.has(path.relative(ROOT, f)))
		.map((f) => ({ module: m, file: path.relative(ROOT, f), doc: yaml.load(fs.readFileSync(f, 'utf8')) }));
};

/** Every mixin of module `m`: name → fields. */
export const mixinsOf = (m) => new Map([...files(path.join(MODULES, m, 'mixins'), '.mixin.yaml')]
	.map((f) => yaml.load(fs.readFileSync(f, 'utf8'))).map((d) => [d.name, d.fields ?? {}]));

export const ALL = moduleIds().flatMap(descriptorsOf);
/** collection name → the module that owns it (never an overlay). */
export const OWNER = new Map(ALL.filter((d) => !d.doc.overlay).map((d) => [d.doc.name, d.module]));

/** The collections a field points at — none for a scalar; one or several for a reference. */
export const targetsOf = (spec) => (Array.isArray(spec?.type) ? spec.type : [spec?.type]).filter((t) => typeof t === 'string' && !SCALARS.has(t));

/** Every field a collection has once installed with everything: its own, its mixins', and each overlay's. */
export function fieldsOf(name) {
	const out = new Map();
	for (const d of ALL.filter((x) => x.doc.name === name)) {
		const mixins = mixinsOf(d.module);
		for (const mx of d.doc.mixins ?? []) for (const [k, s] of Object.entries(mixins.get(mx) ?? {})) out.set(k, s);
		for (const [k, s] of Object.entries(d.doc.fields ?? {})) out.set(k, s);
	}
	return out;
}
