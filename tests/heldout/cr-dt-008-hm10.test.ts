// HELD-OUT cr-dt-008-hm10 (rnd/tests dreamteamer-modules/heldout-dt008-m-move-up-on-the-first-unplaced-row).
//
// Move up, Move down and a drop on the boundary between placed rows and the alphabetical tail move the row one place
// and nothing else on screen. Five collections whose titles are their names; the document places Work (holding tasks)
// and contacts, so the top level draws Work, contacts, then the tail assets, companies, users. Each recipe op is
// applied with applyNavOp, drawn with buildTree, and the top-level labels compared with the held-out's expected; the
// same gestures are made on the REAL NavSidebar.vue (bundled with the ui runner's own SFC compile and host stub) and
// the ops it sends compared with the recipes; with no document the same Move gestures move one row one place.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import * as sfc from 'vue/compiler-sfc';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PROTOCOL = path.join(ROOT, 'modules', 'protocol');
const { buildTree, tailOrder } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'host', 'nav.js')).href);
const { applyNavOp, NavOpError } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'nav-doc.js')).href);

const NAMES = ['assets', 'companies', 'contacts', 'tasks', 'users'];
const descriptors = NAMES.map((name) => ({ name, title: name }));
const titleOf = (d) => d.title;
const ctx = { collections: tailOrder(descriptors, titleOf), namespaces: [] };
const ORIGINAL = () => ({ tree: [{ folder: 'Work', items: ['tasks'] }, 'contacts'], hidden: [] });
const draw = (doc) => buildTree({ descriptors, doc, namespaces: [], titleOf });
const top = (doc) => draw(doc).map((n) => n.label);

/** Every collection name the document places, counted (a name twice is a failure). */
function namedCounts(doc) {
	const out = new Map();
	const walk = (items) => {
		for (const e of items) {
			const c = typeof e === 'string' ? e : e?.collection;
			if (typeof c === 'string') out.set(c, (out.get(c) ?? 0) + 1);
			if (e && typeof e === 'object' && Array.isArray(e.items)) walk(e.items);
		}
	};
	walk(doc.tree);
	for (const h of doc.hidden) out.set(h, (out.get(h) ?? 0) + 1);
	return out;
}
/** The labels in `after` are `before` with exactly one label taken out and put back at another place. */
function oneRowMoved(before, after, row) {
	assert.deepEqual([...after].sort(), [...before].sort(), 'the set of top-level rows changed');
	assert.notDeepEqual(after, before, 'the Move left the drawing unchanged');
	const without = (xs) => xs.filter((x) => x !== row);
	assert.deepEqual(without(after), without(before), `a row other than ${row} changed its place`);
}

const CASES = [
	{ id: 'a', row: 'assets', op: { op: 'move', target: { name: 'assets' }, after: { folder: ['Work'] } }, expected: ['Work', 'assets', 'contacts', 'companies', 'users'], gesture: { menu: ['c/assets', 'move-up'] } },
	{ id: 'b', row: 'companies', op: { op: 'move', target: { name: 'companies' }, after: { name: 'contacts' } }, expected: ['Work', 'contacts', 'companies', 'assets', 'users'], gesture: { menu: ['c/companies', 'move-up'] } },
	{ id: 'c', row: 'users', op: { op: 'move', target: { name: 'users' }, after: { name: 'assets' } }, expected: ['Work', 'contacts', 'assets', 'users', 'companies'], gesture: { menu: ['c/users', 'move-up'] } },
	{ id: 'd', row: 'contacts', op: { op: 'move', target: { name: 'contacts' }, after: { name: 'assets' } }, expected: ['Work', 'assets', 'contacts', 'companies', 'users'], gesture: { menu: ['c/contacts', 'move-down'] } },
	{ id: 'e', row: 'assets', op: { op: 'move', target: { name: 'assets' }, after: { name: 'companies' } }, expected: ['Work', 'contacts', 'companies', 'assets', 'users'], gesture: { menu: ['c/assets', 'move-down'] } },
	{ id: 'f', row: 'tasks', op: { op: 'move', target: { name: 'tasks' }, after: { name: 'users' } }, expected: ['Work', 'contacts', 'assets', 'companies', 'users', 'tasks'], gesture: { open: ['f/Work'], drop: ['c/tasks', 'c/users'] } },
	{ id: 'g-top', row: 'users', op: { op: 'move', target: { name: 'users' }, position: 'top' }, expected: ['users', 'Work', 'contacts', 'assets', 'companies'], gesture: { menu: ['c/users', 'move-top'] } },
	// (g) bottom, amended 2026-11-14 by decisions/2026-11-14--hide-takes-a-row-out-of-the-tree-and-lists-it-in-hidden-move-
	// to-bottom-keeps-the-recorded-tails-first-rule: the recorded tails-first rule stands — a move to the bottom of a level
	// with unplaced tails places those tails first (in drawn order) so the row draws last. users already draws last, so
	// the drawing is unchanged and the document places the tails; the sidebar keeps Move to bottom disabled on the last
	// row and sends nothing.
	{ id: 'g-bottom', row: 'users', op: { op: 'move', target: { name: 'users' }, position: 'bottom' }, expected: ['Work', 'contacts', 'assets', 'companies', 'users'], unchanged: true, tree: [{ folder: 'Work', items: ['tasks'] }, 'contacts', 'assets', 'companies', 'users'], sends: [], gesture: { menu: ['c/users', 'move-bottom'] } },
	// (g) bottom on rows that are NOT last, added 2026-11-14 at the test review (finding hm10-g-bottom-is-now-a-no-op-case):
	// the case above moves nothing, so the tails-first rule is proved here, with the one-row-moved check on. A placed row
	// (contacts) and an unplaced tail row (assets) each draw last; the tails before them are placed first, in drawn order,
	// and no other row changes its place.
	{ id: 'g-bottom-placed', row: 'contacts', op: { op: 'move', target: { name: 'contacts' }, position: 'bottom' }, expected: ['Work', 'assets', 'companies', 'users', 'contacts'], tree: [{ folder: 'Work', items: ['tasks'] }, 'assets', 'companies', 'users', 'contacts'], gesture: { menu: ['c/contacts', 'move-bottom'] } },
	{ id: 'g-bottom-tail', row: 'assets', op: { op: 'move', target: { name: 'assets' }, position: 'bottom' }, expected: ['Work', 'contacts', 'companies', 'users', 'assets'], tree: [{ folder: 'Work', items: ['tasks'] }, 'contacts', 'companies', 'users', 'assets'], gesture: { menu: ['c/assets', 'move-bottom'] } },
];

describe('step 1: the original document draws Work, contacts, then the tail by title', () => {
	test('top level', { timeout: 120_000 }, () => assert.deepEqual(top(ORIGINAL()), ['Work', 'contacts', 'assets', 'companies', 'users']));
});

describe('steps 2-3: each recipe op through applyNavOp, drawn with buildTree', () => {
	for (const c of CASES) {
		test(`(${c.id}) ${JSON.stringify(c.op)} → ${c.expected.join(', ')}`, { timeout: 120_000 }, () => {
			const doc = ORIGINAL();
			const before = top(doc);
			let next;
			assert.doesNotThrow(() => { next = applyNavOp(doc, c.op, ctx); }, `the op threw (an unplaced anchor must be placed, never refused)`);
			assert.deepEqual(doc, ORIGINAL(), 'applyNavOp touched its input');
			const drawn = top(next);
			// the general rules first, so a failure says which one broke
			for (const [name, n] of namedCounts(next)) assert.equal(n, 1, `${name} is named ${n} times in the document`);
			if (c.id !== 'f' && !c.unchanged) oneRowMoved(before, drawn, c.row);
			assert.deepEqual(drawn, c.expected);
			if (c.tree) assert.deepEqual(next.tree, c.tree, 'the tails are not placed first, in drawn order');
			if (c.id === 'f') {
				const work = draw(next).find((n) => n.label === 'Work');
				assert.ok(work, 'Work is no longer drawn');
				assert.deepEqual(work.children, [], 'Work is not drawn empty');
			}
			// materialised rows are written in their drawn order: the document's order of collection names equals the
			// drawing's order of the same names
			const docOrder = [];
			const walk = (items) => { for (const e of items) { if (typeof e === 'string') docOrder.push(e); else if (e?.items) walk(e.items); } };
			walk(next.tree);
			const drawnOrder = [];
			const walkNodes = (nodes) => { for (const n of nodes) { if (n.kind === 'collection') drawnOrder.push(n.target.name); if (n.children) walkNodes(n.children); } };
			walkNodes(draw(next));
			assert.deepEqual(drawnOrder.filter((x) => docOrder.includes(x)), docOrder, 'the document does not list its rows in their drawn order');
			// applying the op a second time does not throw; a move to the top or the bottom applied again changes nothing
			let again;
			assert.doesNotThrow(() => { again = applyNavOp(next, c.op, ctx); }, 'the op threw on its second application');
			if (c.op.position) assert.deepEqual(top(again), drawn, `a second ${c.op.position} moved something`);
		});
	}
});

// ── step 4: the REAL sidebar ───────────────────────────────────────────────────────────────────────────────────
const UI = path.join(ROOT, 'modules', 'ui');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm10-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
async function bundleSidebar() {
	const out = path.join(tmp, 'sidebar.mjs');
	await esbuild.build({
		entryPoints: [path.join(HERE, 'cr-dt-008-hm10.sidebar.ts')],
		outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['node:*'], logLevel: 'silent',
		plugins: [{
			name: 'stub-vscode',
			setup(build) {
				build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
				build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
			},
		}, {
			// the ui runner's own SFC compile (modules/ui/scripts/test.mjs, the render tier)
			name: 'vue-sfc',
			setup(build) {
				build.onLoad({ filter: /\.vue$/ }, ({ path: p }) => {
					const { descriptor } = sfc.parse(readFileSync(p, 'utf8'), { filename: p });
					const id = path.basename(p);
					if (!descriptor.script && !descriptor.scriptSetup) {
						const template = sfc.compileTemplate({ source: descriptor.template?.content ?? '', filename: p, id });
						return { contents: `${template.code}\nexport default { render };`, loader: 'ts' };
					}
					const compiled = sfc.compileScript(descriptor, { id, inlineTemplate: !!descriptor.template });
					return { contents: `${compiled.content.replace(/export default/, 'const __sfc__ =')}\nexport default __sfc__;`, loader: 'ts' };
				});
			},
		}, {
			name: 'host-stub',
			setup(build) {
				const stub = path.join(UI, 'test', 'webview', 'host-stub.ts');
				build.onResolve({ filter: /(^|\/)transport$/ }, () => ({ path: stub }));
			},
		}],
	});
	return out;
}
const wsModel = (nodes) => [{ kind: 'workspace', key: 'workspace', label: 'hm10', route: '/settings/schema/activity', children: nodes }];
function sidebar(bundle, cases) {
	const r = spawnSync(process.execPath, [bundle], { encoding: 'utf8', env: { ...process.env, HM10_CASES: JSON.stringify(cases) }, timeout: 60_000 });
	const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('HM10:'));
	assert.ok(line, `the sidebar harness printed nothing:\n${r.stdout}\n${r.stderr}`);
	return JSON.parse(line.slice(5));
}

describe('step 4: the same gestures through the ui sidebar send exactly the recipe ops', () => {
	let bundle;
	test('the sidebar harness bundles with the ui runner\'s SFC compile', { timeout: 120_000 }, async () => { bundle = await bundleSidebar(); assert.ok(fs.existsSync(bundle)); });
	test('each Move entry (and the drop) sends the recipe op', { timeout: 120_000 }, () => {
		const model = wsModel(draw(ORIGINAL()));
		const sent = sidebar(bundle, CASES.map((c) => ({ id: c.id, model, gesture: c.gesture })));
		const wrong = [];
		for (const c of CASES) {
			const got = sent[c.id];
			if (JSON.stringify(got?.patches) !== JSON.stringify(c.sends ?? [c.op])) wrong.push(`(${c.id}) ${c.gesture.menu?.join(' ') ?? `drop ${c.gesture.drop.join(' onto ')}`}: sent ${JSON.stringify(got?.patches)}${got?.state === 'disabled' ? ' (the entry is disabled)' : ''}, the recipe is ${JSON.stringify(c.op)}`);
		}
		assert.deepEqual(wrong, []);
	});

	// with no document: the flat five, assets · companies · contacts · tasks · users; the same Move gestures (a)-(e)
	// computed by the sidebar from the flat drawing, applied, move that one row one place
	const FLAT = [
		{ id: 'a', row: 'assets', menu: 'move-up' },
		{ id: 'b', row: 'companies', menu: 'move-up' },
		{ id: 'c', row: 'users', menu: 'move-up' },
		{ id: 'd', row: 'contacts', menu: 'move-down' },
		{ id: 'e', row: 'assets', menu: 'move-down' },
	];
	test('doc = null: (a)-(e) through the sidebar move the row one place over the flat five', { timeout: 120_000 }, () => {
		const flat = top(null);
		assert.deepEqual(flat, ['assets', 'companies', 'contacts', 'tasks', 'users']);
		const sent = sidebar(bundle, FLAT.map((f) => ({ id: f.id, model: wsModel(draw(null)), gesture: { menu: [`c/${f.row}`, f.menu] } })));
		for (const f of FLAT) {
			const i = flat.indexOf(f.row);
			const edge = (f.menu === 'move-up' && i === 0) || (f.menu === 'move-down' && i === flat.length - 1);
			if (edge) { assert.equal(sent[f.id].state, 'disabled', `(${f.id}) ${f.menu} on the ${i === 0 ? 'first' : 'last'} row is offered`); continue; }
			assert.equal(sent[f.id].patches.length, 1, `(${f.id}) sent ${JSON.stringify(sent[f.id].patches)}`);
			const next = applyNavOp(null, sent[f.id].patches[0], ctx);
			const drawn = top(next);
			const want = [...flat];
			const j = f.menu === 'move-up' ? i - 1 : i + 1;
			[want[i], want[j]] = [want[j], want[i]];
			assert.deepEqual(drawn, want, `(${f.id}) ${f.menu} on ${f.row}: ${JSON.stringify(sent[f.id].patches[0])}`);
			for (const [name, n] of namedCounts(next)) assert.equal(n, 1, `(${f.id}) ${name} named ${n} times`);
			assert.doesNotThrow(() => applyNavOp(next, sent[f.id].patches[0], ctx));
		}
	});
});

test('NavOpError is what a refusal throws (sanity: an unknown anchor)', { timeout: 120_000 }, () => {
	assert.throws(() => applyNavOp(ORIGINAL(), { op: 'move', target: { name: 'users' }, after: { name: 'ghost' } }, ctx), NavOpError);
});
