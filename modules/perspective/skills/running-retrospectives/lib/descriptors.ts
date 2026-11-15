// A collection descriptor, read one way whichever copy is on disk. Every script that needs to know
// where a collection keeps its records, or what its fields are, asks here and never parses a
// descriptor itself.
//
// Two copies can answer. The workspace's COMPILED descriptor (`.dreamteamer/collections/<name>`)
// is the authority when it exists: an overlay may re-home a collection or add fields, and only
// compile has merged them. A fixture with no compiled runtime falls back to the descriptor this
// module SHIPS, in the authored shape: `fields` keyed by name, `mixins` naming the shared field sets
// under `mixins/`, and `storage: { path, format }` with the record suffix left to compile.
//
// The answer is the same shape from either copy:
//   { name, compiled, runtime, storage: { path, suffix, under }, fields }
// `fields` is in the authored vocabulary — `type` a scalar or the target collection's name, `many`
// for a list, `required`, `enum`, `mirror_of` — which is also what compile writes under
// `compiled.fields`. `under` is `{ field, path, collection }` when the collection is stored inside
// another's records, else null. `runtime` is true for the engine's own system collections.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

// `collections/` and `mixins/` sit three levels above this file both in the package and in
// `.dreamteamer/`, where compile copies the skill.
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SHIPPED_COLLECTIONS = path.join(MODULE_ROOT, 'collections');
const SHIPPED_MIXINS = path.join(MODULE_ROOT, 'mixins');
export const NAMESPACE = 'perspective';

/** The engine's rule for what one record of a collection is called: `activities` → `activity`,
 *  `sources` → `source`. Applied to the bare name, and the default of a record file's suffix. */
export function singular(name) {
	return name.endsWith('ies') ? name.slice(0, -3) + 'y' : name.endsWith('s') ? name.slice(0, -1) : name;
}

/** `perspective/activity-weeks` → `activity-weeks`; a name outside the namespace is already bare. */
const bareName = (name) => (name.startsWith(`${NAMESPACE}/`) ? name.slice(NAMESPACE.length + 1) : name);

const load = (file) => {
	if (!fs.existsSync(file)) return null;
	try { return yaml.load(fs.readFileSync(file, 'utf8')) ?? null; } catch { return null; }
};

/** The values of an enum, whether authored as a list or as a map of value → decoration. */
export function enumValues(e) {
	if (Array.isArray(e)) return e;
	if (e && typeof e === 'object') return Object.keys(e);
	return null;
}

let mixinCache = null;
/** Every mixin this module ships: name → its fields. */
function shippedMixins() {
	if (mixinCache) return mixinCache;
	mixinCache = new Map();
	if (fs.existsSync(SHIPPED_MIXINS)) {
		for (const f of fs.readdirSync(SHIPPED_MIXINS).filter((n) => n.endsWith('.mixin.yaml')).sort()) {
			const doc = load(path.join(SHIPPED_MIXINS, f));
			if (doc?.name) mixinCache.set(doc.name, doc.fields ?? {});
		}
	}
	return mixinCache;
}

/** The authored descriptor this module ships for `name`, or null. Its mixins' fields are merged in
 *  ahead of the body field, as compile places them. */
export function shippedDescriptor(name) {
	const doc = load(path.join(SHIPPED_COLLECTIONS, `${name}.collection.yaml`));
	if (!doc) return null;
	const own = Object.entries(doc.fields ?? {});
	const added = (doc.mixins ?? []).flatMap((m) => Object.entries(shippedMixins().get(m) ?? {}));
	const bodyAt = own.findIndex(([, f]) => f?.body);
	const fields = Object.fromEntries(bodyAt < 0 ? [...own, ...added] : [...own.slice(0, bodyAt), ...added, ...own.slice(bodyAt)]);
	return { ...doc, fields };
}

/** The descriptor `name` has in the workspace at `workspaceRoot`: the compiled copy, else the shipped
 *  one, else null. */
export function readDescriptor(workspaceRoot, name) {
	const compiled = load(path.join(workspaceRoot, '.dreamteamer', 'collections', `${name}.collection.yaml`));
	if (compiled?.compiled) {
		// compile records what it decided under `compiled`: the RESOLVED storage path in
		// `compiled.defaults.storage` (it differs from the authored one under an owns-data module), the
		// suffix there when the descriptor left it out, and the parent collection of `storage.under`.
		const c = compiled.compiled;
		const authored = compiled.storage ?? {};
		const supplied = c.defaults?.storage ?? {};
		const p = supplied.path ?? authored.path;
		const u = authored.under;
		return {
			name,
			compiled: Boolean(p),
			runtime: c.runtime === true,
			storage: {
				path: String(p ?? `data/${name}`),
				suffix: String(authored.suffix ?? supplied.suffix ?? singular(bareName(name))),
				under: u?.parent && u?.subfolder && c.under_collection ? { field: u.parent, path: u.subfolder, collection: c.under_collection } : null,
			},
			fields: c.fields ?? {},
		};
	}
	const doc = shippedDescriptor(name);
	if (!doc) return null;
	const s = doc.storage ?? {};
	const parent = s.under?.parent;
	return {
		name,
		compiled: false,
		runtime: false,
		storage: {
			path: String(s.path ?? `data/${name}`),
			suffix: String(s.suffix ?? singular(bareName(name))),
			under: parent && s.under.subfolder ? { field: parent, path: s.under.subfolder, collection: doc.fields[parent]?.type } : null,
		},
		fields: doc.fields,
	};
}
