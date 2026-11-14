// PLACEMENT LEFT THE DESCRIPTORS (cr-dt-008, task 2; rnd/tests dreamteamer-modules/no-placement-keys).
//
// The left nav is nav.yaml at the workspace root (engine 0.49): its order and its folders are the
// operator's, filled at install by the fragments a module ships. A collection descriptor keeps only what
// the row looks like — `display.nav.icon` — and never says where the row goes: no `display.nav.order`,
// no `display.nav.section`, in any descriptor of any module (a composed copy included, while one exists).
// A ui-view is a child row of its collection, and its order among its siblings stays its own.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES, ALL } from './helpers/descriptors.mjs';

const walk = (dir, suffix, out = []) => {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, suffix, out);
		else if (p.endsWith(suffix)) out.push(p);
	}
	return out;
};
const modules = fs.readdirSync(MODULES).filter((m) => fs.existsSync(path.join(MODULES, m, 'package.json')));
const rel = (f) => path.relative(path.dirname(MODULES), f);

/** The ui-views that ordered themselves among their collection's views at base 383cd1f — composed copies
 *  aside, which follow their origin. */
const VIEWS_WITH_ORDER = [
	'modules/assets/ui-views/assets-gallery.ui-view.yaml',
	'modules/perspective/ui-views/by-contributor.ui-view.yaml',
	'modules/perspective/ui-views/projects.ui-view.yaml',
	'modules/perspective/ui-views/timeline-by-collaborator.ui-view.yaml',
	'modules/perspective/ui-views/timeline-by-topic.ui-view.yaml',
	'modules/perspective/ui-views/timeline-correspondence.ui-view.yaml',
	'modules/perspective/ui-views/timeline-decisions.ui-view.yaml',
	'modules/perspective/ui-views/timeline-deliverables.ui-view.yaml',
	'modules/perspective/ui-views/timeline-weeks.ui-view.yaml',
	'modules/perspective/ui-views/timeline.ui-view.yaml',
	'modules/perspective/ui-views/weeks.ui-view.yaml',
	'modules/rnd/ui-views/rnd-change-requests-board.ui-view.yaml',
	'modules/tasks/ui-views/tasks-board.ui-view.yaml',
	'modules/tasks/ui-views/tasks-list.ui-view.yaml',
];

describe('collection descriptors carry no placement', () => {
	const every = modules.flatMap((m) => walk(path.join(MODULES, m, 'collections'), '.collection.yaml'));
	test('the scan sees the whole repo', () => {
		assert.ok(every.length >= 100, `expected every descriptor, saw ${every.length}`);
	});
	test('no descriptor carries display.nav.order or display.nav.section', () => {
		const placed = [];
		for (const f of every) {
			const nav = yaml.load(fs.readFileSync(f, 'utf8'))?.display?.nav ?? {};
			for (const k of ['order', 'section']) if (k in nav) placed.push(`${rel(f)}: display.nav.${k}`);
		}
		assert.deepEqual(placed, [], `placement belongs to nav.yaml:\n  ${placed.join('\n  ')}`);
	});
	test('every collection a module owns keeps display.nav.icon', () => {
		const bare = ALL.filter((d) => !d.doc.overlay && !d.doc.display?.nav?.icon).map((d) => d.file);
		assert.deepEqual(bare, []);
	});
});

describe('ui-views keep their own order', () => {
	for (const f of VIEWS_WITH_ORDER) {
		test(`${f} still orders itself among its collection's views`, () => {
			const nav = yaml.load(fs.readFileSync(path.join(path.dirname(MODULES), f), 'utf8'))?.display?.nav ?? {};
			assert.equal(typeof nav.order, 'number', `${f}: display.nav.order`);
		});
	}
});
