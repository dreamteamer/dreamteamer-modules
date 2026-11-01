// THE BOARD — an rnd ui-view that draws change requests as kanban columns by `stage`, in the enum's order
// (the extension's kanban takes its columns from `lanes_by`, enum order), and opens from the nav.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { rndWorkspace, cleanupAll } from './helpers/rnd-workspace.mjs';
import { compileAndCheck, packedFiles } from '../../../tests/helpers/workspace.mjs';

after(() => cleanupAll());

const VIEW = 'rnd-change-requests-board';

describe('the change-request board', () => {
	test('compiles and checks clean, and the compiled view is a kanban by stage in the nav', () => {
		const root = rndWorkspace();
		compileAndCheck(root);
		const f = path.join(root, '.dreamteamer', 'ui-views', `${VIEW}.ui-view.yaml`);
		assert.ok(fs.existsSync(f), 'compiled');
		const v = yaml.load(fs.readFileSync(f, 'utf8'));
		assert.equal(v.route, '/rnd/change-requests/board');
		assert.equal(v.scope, 'collection');
		assert.equal(v.collection, 'collections/rnd/change-requests');
		assert.equal(v.display.nav.title, 'Board');
		assert.equal(v.display.list.layout, 'kanban');
		assert.equal(v.display.list.options.lanes_by, 'stage');
		assert.equal(v.display.list.options.group_by, undefined, 'no bands: group_by draws bands, not columns');
		assert.equal(v.display.list.sort, '-created');
		assert.match(v.display.list.options.card_title, /\{\{ name \}\}/);
	});

	test('the package ships it', () => {
		assert.ok(packedFiles('rnd').includes(`ui-views/${VIEW}.ui-view.yaml`));
	});
});
