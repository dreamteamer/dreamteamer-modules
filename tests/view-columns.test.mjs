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
import { ALL, OWNER, fieldsOf } from './helpers/descriptors.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');

/** Every collection, with every field it has once everything is installed — its own, its mixins',
 *  and the mirror fields other modules' overlays add to it. */
function fieldIndex() {
	return new Map([...OWNER.keys()].map((name) => [name, new Set(fieldsOf(name).keys())]));
}

const props = fieldIndex();
// The three injected fields every record carries; a view may list them like any declared field.
const ALWAYS = new Set(['id', 'created', 'last_modified']);

/** Every field a list names: its columns, the field a layout option takes (group_by, lanes_by,
 *  color_by, start/end, lat/lng), and its sort key. */
const OPTION_FIELDS = ['group_by', 'lanes_by', 'color_by', 'start', 'end', 'lat', 'lng'];
function named(display) {
	const list = display?.list ?? {};
	const out = [...(list.columns ?? [])];
	for (const k of OPTION_FIELDS) if (typeof list.options?.[k] === 'string') out.push(list.options[k]);
	if (typeof list.sort === 'string') out.push(list.sort.replace(/^-/, ''));
	if (typeof display?.record?.badge === 'string') out.push(display.record.badge);
	if (typeof display?.record?.color_by === 'string') out.push(display.record.color_by);
	return out;
}

// The lists to check: every view, and every collection's own display (its default view).
const lists = [];
for (const m of fs.readdirSync(MODULES)) {
	const dir = path.join(MODULES, m, 'ui-views');
	if (fs.existsSync(dir)) {
		for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ui-view.yaml'))) {
			const v = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
			lists.push([`${m}/ui-views/${f}`, String(v.collection ?? '').replace(/^collections\//, ''), v.display]);
		}
	}
}
for (const [name] of props) {
	const own = ALL.find((d) => d.doc.name === name && !d.doc.overlay);
	if (own?.doc.display) lists.push([own.file, name, own.doc.display]);
}

test('the repo has lists to check', () => {
	assert.ok(lists.length >= 20, `only ${lists.length} lists found — this gate is not looking where it thinks it is`);
});

for (const [rel, target, display] of lists) {
	const fields = named(display);
	if (!target || !fields.length) continue;
	test(`${rel} names only fields ${target} has`, () => {
		const known = props.get(target);
		assert.ok(known, `${rel} points at "${target}", which is not a collection this repo defines`);
		const missing = fields.filter((c) => !known.has(c) && !ALWAYS.has(c));
		assert.deepEqual(missing, [], `a column for a field that does not exist renders as an empty cell, which reads as data:\n  ${missing.join(', ')}`);
	});
}
