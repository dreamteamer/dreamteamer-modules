// The left nav: no order, no section — the ui-view orders stay.
//
// Through perspective 0.4.0 each of its collections carried a numeric `display.nav.order`, the pipeline the
// work follows, ten apart. From cr-dt-008 (engine 0.49) placement is nav.yaml at the workspace root, which the
// operator arranges by drag and drop; a descriptor keeps only `display.nav.icon`. A named view is a child row
// of its collection, and its order among its siblings is still its own — those orders stay, contiguous from 1.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const MOD = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective');
const COLS = path.join(MOD, 'collections', 'perspective');
const VIEWS = path.join(MOD, 'ui-views');

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

test('the scan sees every perspective collection', () => {
	assert.ok(descriptors.size >= 20, `expected perspective's collections, saw ${descriptors.size}`);
});

test('no descriptor sets a nav order or a nav section — nav.yaml places the rows; every one keeps its icon', () => {
	for (const [name, d] of descriptors) {
		assert.ok(d.display?.nav?.order === undefined, `${name} sets display.nav.order`);
		assert.ok(d.display?.nav?.section === undefined, `${name} sets display.nav.section`);
		assert.ok(d.display?.nav?.icon, `${name} has no display.nav.icon`);
		assert.ok(!d.internal, `${name} is marked internal`);
	}
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
