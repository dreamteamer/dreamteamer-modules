// EVERY COLUMN A VIEW ASKS FOR MUST BE A FIELD THAT EXISTS — including the ones the engine
// generates, and excluding the ones a release deleted.
//
// ⚠ Written after 0.2.0 shipped with two dead columns, both invisible to every other gate. The
// descriptors were right, the nav-order test was right, `compile` was happy and `check` reported
// zero violations over 5,521 real records — because a column naming a missing field is not a
// violation of anything. It renders as an empty cell, and an empty cell reads as "this project has
// no activities" rather than "nobody updated this view".
//
//   projects.ui-view.yaml     `activities_count`  — deleted in 0.2.0; the count comes off the
//                                                   generated `activities` mirror now
//   content-perspective-sources.ui-view.yaml
//                             `session`           — the retired run link. The rename swept the
//                                                   descriptors and the scripts; a column is
//                                                   neither, so it survived in both files.
//
// A generated mirror IS a legal column: it is a real field at runtime, just not one written in the
// descriptor. That is why this reads the `x-inverse` graph rather than the properties alone.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');

/** Every collection in the package, with the fields it declares and the mirrors pointed at it. */
function fieldIndex() {
	const props = new Map();      // "ns/name" → Set(field)
	const templates = new Map();  // template name → [field]
	const pending = [];           // [collection, [template names]]

	for (const m of fs.readdirSync(MODULES)) {
		const tdir = path.join(MODULES, m, 'collection-templates');
		if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
			const d = yaml.load(fs.readFileSync(path.join(tdir, f), 'utf8'));
			templates.set(`collection-templates/${d.name}`, Object.keys(d.template?.schema?.properties ?? {}));
		}
	}
	const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []);

	const docs = [];
	for (const m of fs.readdirSync(MODULES)) {
		for (const f of walk(path.join(MODULES, m, 'collections')).filter((x) => x.endsWith('.collection.yaml'))) {
			docs.push(yaml.load(fs.readFileSync(f, 'utf8')));
		}
	}
	for (const d of docs) {
		props.set(d.name, new Set(Object.keys(d.schema?.properties ?? {})));
		pending.push([d.name, d.templates ?? []]);
	}
	for (const [name, tpls] of pending) for (const t of tpls) for (const f of templates.get(t) ?? []) props.get(name).add(f);

	// The mirrors: a field carrying x-inverse creates that named field ON its target collection.
	for (const d of docs) {
		for (const spec of Object.values(d.schema?.properties ?? {})) {
			const raw = spec?.['x-inverse'] ?? spec?.items?.['x-inverse'] ?? spec?.['x-inverse-of'];
			if (!raw) continue;
			// `x-inverse` is a bare field name or `{ field, description }`; either way the field is the mirror
			const mirror = typeof raw === 'object' ? raw.field : raw;
			if (!mirror) continue;
			const ref = spec['x-reference'] ?? spec.items?.['x-reference'];
			for (const target of typeof ref === 'string' ? [ref] : Array.isArray(ref) ? ref : []) {
				if (props.has(target)) props.get(target).add(mirror);
			}
		}
	}
	return props;
}

const props = fieldIndex();
// The engine synthesises these onto every row in `src/server.js` — they are not schema fields and
// never appear in a descriptor, but a view may legitimately ask for them.
const ALWAYS = new Set(['id', 'path', 'last-modified', '$last-modified-by', '$last-commit-message']);

const views = [];
for (const m of fs.readdirSync(MODULES)) {
	const dir = path.join(MODULES, m, 'ui-views');
	if (!fs.existsSync(dir)) continue;
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ui-view.yaml'))) {
		views.push([`${m}/${f}`, yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'))]);
	}
}

test('the package ships views to check', () => {
	assert.ok(views.length >= 9, `only ${views.length} views found — this gate is not looking where it thinks it is`);
});

for (const [rel, v] of views) {
	const target = String(v.collection ?? '').replace(/^collections\//, '');
	const named = [...(v.options?.columns ?? []), ...(v.options?.fields ?? []), ...(v.options?.group_by ? [v.options.group_by] : [])];
	if (!target || !named.length) continue;

	test(`${rel} names only fields ${target} has`, () => {
		const known = props.get(target);
		assert.ok(known, `${rel} points at "${target}", which is not a collection this package defines`);
		const missing = named.filter((c) => !known.has(c) && !ALWAYS.has(c));
		assert.deepEqual(missing, [], `a column for a field that does not exist renders as an empty cell, which reads as data:\n  ${missing.join(', ')}`);
	});
}
