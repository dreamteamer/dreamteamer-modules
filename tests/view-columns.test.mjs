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
import { OWNER, fieldsOf } from './helpers/descriptors.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');

/** Every collection, with every field it has once everything is installed — its own, its mixins',
 *  and the mirror fields other modules' overlays add to it. */
function fieldIndex() {
	return new Map([...OWNER.keys()].map((name) => [name, new Set(fieldsOf(name).keys())]));
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
