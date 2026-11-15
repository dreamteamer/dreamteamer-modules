// THE SHIPPED NAV FRAGMENTS (cr-dt-008, task 6; rnd/tests dreamteamer-modules/rnd-fragment).
//
// A module (or a module preset) that names `dreamteamer.nav` ships a yaml file in the nav.yaml grammar with
// only `tree`; on install the engine places each collection it names into the workspace's own nav.yaml, unless
// the workspace already places it. A fragment may place only what its package owns or overlays (a preset:
// what its members own or overlay), so each one here is held to exactly its own collections, once each, in the
// design's order (§4).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES, moduleIds, pkgOf, packedFiles, folderOf, cleanup } from './helpers/workspace.mjs';
import { descriptorsOf } from './helpers/descriptors.mjs';

after(cleanup);
const fragment = (m) => yaml.load(fs.readFileSync(path.join(MODULES, m, pkgOf(m).dreamteamer.nav), 'utf8'));
/** Every collection name a fragment places, in drawing order (folders and namespaces walked depth first). */
const names = (entries) => entries.flatMap((e) => (typeof e === 'string' ? [e] : e.collection ? [e.collection] : names(e.items ?? [])));
const owned = (m) => descriptorsOf(m).filter((d) => !d.doc.overlay).map((d) => d.doc.name);

describe('every fragment a manifest names', () => {
	const shipping = moduleIds().filter((m) => pkgOf(m).dreamteamer?.nav);
	test('core, rnd and knowledge name one, and nothing else does', () => {
		assert.deepEqual(shipping, ['core', 'knowledge', 'rnd']);
	});
	for (const m of shipping) {
		test(`${m}: the file is in files and in the tarball, and holds only a tree`, () => {
			const file = pkgOf(m).dreamteamer.nav;
			assert.ok(pkgOf(m).files.includes(file), `${file} is not in files`);
			assert.ok(packedFiles(m).includes(file), `the tarball does not ship ${file}`);
			assert.deepEqual(Object.keys(fragment(m)), ['tree']);
			const all = names(fragment(m).tree);
			assert.equal(new Set(all).size, all.length, `a name listed twice: ${all.filter((n, i) => all.indexOf(n) !== i).join(', ')}`);
		});
	}
});

describe('rnd', () => {
	const ORDER = ['rnd/change-requests', 'rnd/issues', 'rnd/reviews', 'rnd/review-findings', 'rnd/products', 'rnd/design-docs', 'rnd/implementation-plans', 'rnd/tests', 'rnd/releases',
		'rnd/user-journeys', 'rnd/user-stories', 'rnd/screens', 'rnd/prototypes', 'rnd/features', 'rnd/personas', 'rnd/design-systems',
		'rnd/experiments', 'rnd/references', 'rnd/research-docs', 'rnd/draft-docs', 'rnd/open-questions'];
	test('one namespace entry, rnd, holding every collection rnd owns once, in the design\'s order', () => {
		const { tree } = fragment('rnd');
		assert.equal(tree.length, 1);
		assert.equal(tree[0].namespace, 'rnd');
		assert.deepEqual(names(tree), ORDER);
		assert.deepEqual([...owned('rnd')].sort(), [...ORDER].sort(), 'the fragment and rnd\'s collections differ');
	});
	test('the lifecycle rows first, then the Product and Knowledge folders', () => {
		const items = fragment('rnd').tree[0].items;
		assert.deepEqual(items.filter((e) => typeof e !== 'string').map((e) => e.folder), ['Product', 'Knowledge']);
		assert.deepEqual(items.filter((e) => typeof e === 'string'), ORDER.slice(0, 9));
	});
});

describe('knowledge', () => {
	test('one Knowledge folder with its three collections, nothing else', () => {
		assert.deepEqual(fragment('knowledge'), { tree: [{ folder: 'Knowledge', items: ['blurbs', 'briefs', 'meta-analyses'] }] });
		assert.deepEqual([...owned('knowledge')].sort(), ['blurbs', 'briefs', 'meta-analyses']);
	});
});

describe('core', () => {
	const FOLDERS = {
		Work: ['tasks', 'projects', 'deliverables', 'decisions', 'risks', 'workflows'],
		People: ['users', 'teams', 'roles', 'responsibilities', 'agents'],
		CRM: ['companies', 'contacts', 'engagements'],
		Meetings: ['meetings', 'meeting-preps', 'meeting-recordings', 'meeting-summaries', 'meeting-analyses'],
		Library: ['files', 'file-drives', 'assets', 'artifacts'],
		Activity: ['sessions', 'metrics'],
	};
	test('the design\'s six folders, in order, each with its rows', () => {
		const { tree } = fragment('core');
		assert.deepEqual(tree.map((e) => e.folder), Object.keys(FOLDERS));
		for (const e of tree) assert.deepEqual(e.items, FOLDERS[e.folder], e.folder);
	});
	test('exactly the members\' collections plus agents (the row sessions overlays), each once', () => {
		const members = Object.keys(pkgOf('core').dreamteamer.preset).map(folderOf);
		const expected = [...new Set([...members.flatMap(owned), 'agents'])].sort();
		assert.ok(descriptorsOf('sessions').some((d) => d.doc.name === 'agents' && d.doc.overlay), 'sessions no longer overlays agents');
		assert.deepEqual([...names(fragment('core').tree)].sort(), expected);
	});
});
