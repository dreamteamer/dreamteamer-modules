// Tier 1 — a list sorted by, or showing, Last modified SAVES (cr-vscode-011), through the transport and
// the REAL engine under test. The engine's name for the built-in is `last_modified` (its injected
// field, and the only spelling compile accepts in a view); the host's v1 row key `last-modified` is a
// wire key and nothing else. Until 0.24.27 the browse seeded every list with no authored sort with
// `-last-modified`, and Save / Save as… wrote that seed verbatim — so the FIRST save of such a list was
// refused: `display.list.sort: … has no field last-modified — declare it first`.
//
// The presentations below are what the browse held at 0.24.26 on an untouched list: the legacy
// spelling, fed through the writers exactly as the drawer feeds them. Two collections, neither with an
// authored sort: one of the workspace's own, and one an installed package ships (its display Save
// becomes an overlay in the workspace module — the shape of a module-shipped collection). Synthetic
// names only.
//
// ⚠ An engine older than the package overlays (no `moveUiView`, as api-view-authoring.test.ts tells
// them apart) refuses ANY write over a package's collection, Last modified or not; there the package
// half asserts that refusal instead, so the gate means something whichever engine DT_ENGINE names.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { WorkspaceApi } from '../../src/api';
import { ENGINE, NO_ENGINE } from './engine-under-test';
import { initEngine } from '../../src/engine';
import { v2Workspace, quiet, type V2Workspace } from './v2-workspace';
import { collectionListWrite, namedViewWrite, newViewWrite, type ListPresentation } from '../../src/lib/view-write';
import type { UiViewRecord } from '../../src/ui-views';

const GADGETS = `name: gadgets
description: One gadget.
use_when: a gadget is named
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
  status:
    type: string
    enum: [on, off]
display:
  list:
    columns: [name, status]
`;

/** A collection an installed package ships, with no authored sort. */
const JOURNEYS = `name: journeys
description: One traced journey.
use_when: a journey is traced
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
  description:
    type: string
display:
  list:
    columns: [name, description]
`;

/** What the browse held on an untouched list at 0.24.26 — the legacy default sort. */
const UNTOUCHED: ListPresentation = { layout: 'table', columns: ['name', 'last_modified'], sort: '-last-modified', options: {} };

let hasOverlays = false;

describe('a list sorted by or showing Last modified saves (cr-vscode-011)', { skip: NO_ENGINE }, () => {
	let ws: V2Workspace;
	let api: WorkspaceApi;
	const file = (rel: string) => path.join(ws.root, rel);
	const yamlAt = (rel: string) => yaml.load(fs.readFileSync(file(rel), 'utf8')) as any;
	const ok = (r: { status: number; body: unknown }, what: string) => assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body)}`);

	before(async () => {
		hasOverlays = typeof (await import(path.join(ENGINE as string, 'src', 'api.js'))).moveUiView === 'function';
		ws = v2Workspace('save-last-modified', { 'collections/gadgets.collection.yaml': GADGETS });
		const pkg = file('node_modules/@harbor/journeys');
		fs.mkdirSync(path.join(pkg, 'collections'), { recursive: true });
		fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@harbor/journeys', dreamteamer: {} }, null, '\t'));
		fs.writeFileSync(path.join(pkg, 'collections', 'journeys.collection.yaml'), JOURNEYS);
		const pkgFile = file('package.json');
		const root = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		fs.writeFileSync(pkgFile, JSON.stringify({ ...root, dependencies: { ...root.dependencies, '@harbor/journeys': '*' } }, null, '\t') + '\n');
		const c = ws.dt('compile');
		assert.equal(c.status, 0, c.stderr + c.stdout);
		ws.git('add', '-A');
		ws.git('commit', '-qm', 'fixture: an installed package shipping a collection with no authored sort');
		await initEngine(ws.root);
		api = new WorkspaceApi(ws.root);
	});

	async function ownList(collection: string): Promise<{ layout?: string; options?: Record<string, unknown> } | undefined> {
		const r = await api.handle('GET', `/collections/collections/records/${collection}`);
		return (r.body as any).fields?.display?.list;
	}

	test('Save to the collection\'s own display, on the workspace\'s collection: accepted, and the descriptor says last_modified', async () => {
		const { changes } = collectionListWrite(await ownList('gadgets'), UNTOUCHED, undefined);
		ok(await quiet(() => api.handle('PATCH', '/collections/collections/records/gadgets', changes)), 'collection Save');
		const list = yamlAt('modules/default/collections/gadgets.collection.yaml').display.list;
		assert.equal(list.sort, '-last_modified');
		assert.deepEqual(list.columns, ['name', 'last_modified']);
	});

	test('Save to the collection\'s own display, on an installed package\'s collection: the overlay says last_modified', async () => {
		const { changes } = collectionListWrite(await ownList('journeys'), UNTOUCHED, undefined);
		const r = await quiet(() => api.handle('PATCH', '/collections/collections/records/journeys', changes));
		if (!hasOverlays) {
			assert.ok(r.status >= 400);
			assert.match(String((r.body as any).error), /node_modules/);
			return;
		}
		ok(r, 'collection Save over a package');
		const overlay = yamlAt('modules/default/collections/journeys.collection.yaml');
		assert.equal(overlay.overlay, true);
		assert.equal(overlay.display.list.sort, '-last_modified');
		assert.deepEqual(overlay.display.list.columns, ['name', 'last_modified']);
	});

	for (const collection of ['gadgets', 'journeys']) {
		test(`Save as… on ${collection}, then Save over it ascending and descending: accepted, and the view file follows`, async () => {
			const created = newViewWrite(`/${collection}/recent`, collection, { title: 'Recent' }, UNTOUCHED, undefined);
			const r = await quiet(() => api.handle('POST', '/collections/ui-views/records', created));
			ok(r, 'Save as…');
			const id = `${collection}-recent`;
			const rel = `modules/default/ui-views/${id}.ui-view.yaml`;
			assert.equal(yamlAt(rel).display.list.sort, '-last_modified');
			assert.deepEqual(yamlAt(rel).display.list.columns, ['name', 'last_modified']);

			// the drawer's Save over a named view: the whole view, rebuilt from the record it read, POSTed with its id
			for (const [sort, written] of [['last-modified', 'last_modified'], ['-last-modified', '-last_modified']] as const) {
				const read = await api.handle('GET', `/collections/ui-views/records/${id}`);
				const existing = { id, ...(read.body as any).fields } as UiViewRecord;
				const view = namedViewWrite(existing, collection, { ...UNTOUCHED, columns: ['name', 'last-modified'], sort }, undefined);
				ok(await quiet(() => api.handle('POST', '/collections/ui-views/records', { id, ...view })), `Save over, sort ${sort}`);
				assert.equal(yamlAt(rel).display.list.sort, written);
				assert.deepEqual(yamlAt(rel).display.list.columns, ['name', 'last_modified']);
			}
		});
	}

	test('after every save: compile and check pass, and no source names last-modified', () => {
		const c = ws.dt('compile');
		assert.equal(c.status, 0, `dt compile: ${c.stderr}${c.stdout}`);
		const k = ws.dt('check');
		assert.equal(k.status, 0, `dt check: ${k.stderr}${k.stdout}`);
		const hits: string[] = [];
		const walk = (dir: string) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (fs.readFileSync(p, 'utf8').includes('last-modified')) hits.push(path.relative(ws.root, p));
			}
		};
		walk(file('modules'));
		assert.deepEqual(hits, []);
	});
});
