// THE R&D NAV — the lifecycle first, then a Product section and a Knowledge section.
//
// rnd's collections are drawn in one folder, ordered by `display.nav.order`. The daily lifecycle
// (requests → issues → reviews → findings → products → designs → plans → tests → releases) comes
// first; what defines a product and what the team learns are `display.nav.section`s, which an editor
// draws as folders inside rnd's own. `notebooks` and `wikis` are composed in from their origins, so
// their keys are authored there and copied here (compose.test.mjs guards the copies).
//
// Two cases: the table as authored in the YAML, and the table as the engine resolves it after
// compiling core and rnd packed into a fresh workspace — which is where an overlay (notebooklm's
// `wikis`) could mask the base's display.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES, virginWorkspace, installPacked, compileAndCheck, compiledDescriptor, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);

/** [collection, order, section] — the design's table, top to bottom. */
const NAV = [
	['rnd/change-requests', 20], ['rnd/issues', 21], ['rnd/reviews', 22], ['rnd/review-findings', 23],
	['rnd/products', 24], ['rnd/design-docs', 25], ['rnd/implementation-plans', 26], ['rnd/tests', 27],
	['rnd/releases', 28],
	['rnd/user-journeys', 30, 'product'], ['rnd/user-stories', 31, 'product'], ['rnd/screens', 32, 'product'],
	['rnd/prototypes', 33, 'product'], ['rnd/features', 34, 'product'], ['rnd/personas', 35, 'product'],
	['rnd/design-systems', 36, 'product'],
	['rnd/experiments', 40, 'knowledge'], ['rnd/references', 41, 'knowledge'], ['rnd/research-docs', 42, 'knowledge'],
	['rnd/draft-docs', 43, 'knowledge'], ['rnd/open-questions', 44, 'knowledge'], ['notebooks', 45, 'knowledge'],
	['wikis', 46, 'knowledge'],
];

/** Where each row is AUTHORED: rnd's own folder, or the origin module a composed copy comes from. */
const authoredAt = (name) => name === 'notebooks' ? path.join(MODULES, 'notebooklm', 'collections', 'notebooks.collection.yaml')
	: name === 'wikis' ? path.join(MODULES, 'wikis', 'collections', 'wikis.collection.yaml')
	: path.join(MODULES, 'rnd', 'collections', `${name}.collection.yaml`);
const navOf = (doc) => doc?.display?.nav ?? {};

test('the authored table: every rnd row and the two composed origins carry the design\'s order and section', () => {
	for (const [name, order, section] of NAV) {
		const nav = navOf(yaml.load(fs.readFileSync(authoredAt(name), 'utf8')));
		assert.equal(nav.order, order, `${name}: display.nav.order`);
		assert.equal(nav.section, section, `${name}: display.nav.section`);
	}
	const orders = NAV.map(([, o]) => o);
	assert.equal(new Set(orders).size, orders.length, 'no two rows share an order');
	// the table names every collection rnd ships — a collection added later fails until it is placed
	const own = fs.readdirSync(path.join(MODULES, 'rnd', 'collections', 'rnd'))
		.filter((f) => f.endsWith('.collection.yaml')).map((f) => `rnd/${f.replace('.collection.yaml', '')}`);
	assert.deepEqual(NAV.map(([n]) => n).sort(), [...own, 'notebooks', 'wikis'].sort());
});

test('the compiled resolution: core and rnd packed into a fresh workspace resolve to the table', () => {
	const root = virginWorkspace();
	installPacked(root, ['core', 'rnd']);
	compileAndCheck(root);
	for (const name of ['wikis', 'notebooks', 'rnd/prototypes', 'rnd/change-requests', 'rnd/open-questions']) {
		const [, order, section] = NAV.find(([n]) => n === name);
		const text = compiledDescriptor(root, name);
		assert.ok(text, `${name} is compiled`);
		const nav = navOf(yaml.load(text));
		assert.equal(nav.order, order, `${name}: compiled display.nav.order`);
		assert.equal(nav.section, section, `${name}: compiled display.nav.section`);
	}
});

test('released as 0.10.0 (on engine 0.47.0, the setup units composed in): the version, UPDATING.md and the README release note — 0.9.0\'s notes kept', () => {
	const read = (f) => fs.readFileSync(path.join(MODULES, 'rnd', f), 'utf8');
	assert.match(JSON.parse(read('package.json')).version, /^0\.10\.\d+$/, 'a 0.10.x patch keeps the 0.10.0 notes');
	assert.match(read('UPDATING.md'), /## 0\.10\.0 — on engine 0\.47\.0/);
	assert.match(read('UPDATING.md'), /### Also in 0\.9\.0 — the R&D nav/);
	assert.match(read('README.md'), /## 0\.10\.0 — on engine 0\.47\.0/);
	assert.match(read('README.md'), /## 0\.9\.0 — from 0\.8\.0/);
	for (const [m, v] of [['notebooklm', /^0\.2\.\d+$/], ['wikis', /^0\.2\.\d+$/]]) {
		assert.match(JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8')).version, v, m);
	}
});
