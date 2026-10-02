// The left nav, ordered by the pipeline the work actually follows.
//
// The studio sorts collections by a numeric `display.nav.order` on the descriptor (the engine's presentation
// layer falls back to 999) and puts view entries above them by `nav.order`. Neither was set
// deliberately here: NO collection carried an `order` at all, so all twenty sorted on the fallback,
// and among the ten named views `nav.order` 1 was unused while 8 and 9 were each used twice.
//
// ⚠ `display.nav.section` (the old `group:`) is deliberately NOT used. The engine is retiring it in favour of module ownership
// (compile.js: "it exists to REPLACE `group:` as the workspace's partition rather than to sit beside
// it"), and a descriptor that sets both would partition the nav twice.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const MOD = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective');
const COLS = path.join(MOD, 'collections', 'perspective');
const VIEWS = path.join(MOD, 'ui-views');

// The pipeline, ten apart so a collection can be inserted between two without renumbering the rest.
const ORDER = {
	'retrospective-sessions': 10,   // the run itself
	gates: 15,                      // the conditions each stage had to meet
	sources: 20,                    // what it could see
	conversations: 30,              // ── the evidence it condensed
	'activity-weeks': 40,
	tickets: 50,
	threads: 60,
	deliverables: 70,
	activities: 80,         // ── the observed world it reconstructed, in the real world's nouns
	projects: 90,
	topics: 100,
	users: 110,
	terms: 115,                     // the vocabulary in two steps — the word, verbatim…
	concepts: 120,                  // …then the meaning several words share
	decisions: 130,
	workflows: 140,
	goals: 150,
	findings: 160,                  // ── what it concluded
	insights: 170,
	assumptions: 175,               // and what it had to believe in order to conclude it
	questions: 180,
	proposals: 190,
	perspectives: 200,              // the answer
};

/** Every descriptor under `collections/perspective/`, keyed by its name RELATIVE to that folder —
 *  so `users.collection.yaml` is `users`. ⚠ Recursive: `compile` enumerates
 *  `collections/` recursively so a namespaced descriptor can be authored at `collections/<ns>/<c>`,
 *  and a flat readdir here would silently stop testing five collections. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

const descriptors = new Map(
	descriptorNames(COLS).map((n) => [n, yaml.load(fs.readFileSync(path.join(COLS, `${n}.collection.yaml`), 'utf8'))]),
);
const views = fs.readdirSync(VIEWS).filter((f) => f.endsWith('.ui-view.yaml'))
	.map((f) => ({ file: f, ...yaml.load(fs.readFileSync(path.join(VIEWS, f), 'utf8')) }));

test('the table covers every collection, and nothing else', () => {
	assert.deepEqual(Object.keys(ORDER).sort(), [...descriptors.keys()].sort());
});

for (const [name, order] of Object.entries(ORDER)) {
	test(`${name} sits at ${order} in the nav`, () => {
		assert.equal(descriptors.get(name).display?.nav?.order, order);
	});
}

test('no descriptor sets a nav section — module ownership is the partition', () => {
	for (const [name, d] of descriptors) {
		assert.ok(d.display?.nav?.section === undefined, `${name} sets display.nav.section`);
		assert.ok(!d.internal, `${name} is marked internal`);
	}
});

test('the order runs in the pipeline direction, with no duplicate', () => {
	const values = Object.values(ORDER);
	assert.equal(new Set(values).size, values.length, 'two collections share a position');
	assert.deepEqual(values, [...values].sort((a, b) => a - b), 'the table is not in ascending order');
});

test('every named view has a unique nav.order, contiguous from 1', () => {
	const orders = views.filter((v) => v.display?.nav).map((v) => v.display.nav.order).sort((a, b) => a - b);
	assert.ok(orders.length >= 8, `expected the named views, found ${orders.length}`);
	assert.deepEqual(orders, orders.map((_, i) => i + 1),
		`nav orders are ${orders.join(',')} — 1 was unused and 8 and 9 were each used twice before this release`);
});

// A view is a named variant of its collection's default view, which the collection draws itself —
// so a view the nav does not list is reachable by nothing.
test('every view has a nav entry', () => {
	for (const v of views) assert.ok(v.display?.nav, `${v.file} has no display.nav — it is unreachable`);
});

test('every named view carries a title and an icon', () => {
	for (const v of views.filter((x) => x.display?.nav)) {
		assert.ok(v.display.nav.title, `${v.file} has no display.nav.title`);
		assert.ok(v.display.nav.icon, `${v.file} has no display.nav.icon`);
	}
});
