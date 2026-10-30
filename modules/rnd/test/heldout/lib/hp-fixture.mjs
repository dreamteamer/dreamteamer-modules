// HP, the held-out prototype: the smallest app the player's contract allows. Its app object carries ONLY
// store, session, screens, byKey, current, onRender and renderAll (no mount, initialHash, closeDrawer,
// drawerOpen or ui); its store snapshots to a JSON STRING; its session has only set() and user(); the page has
// no #demo-root. Records are held in memory and turned into journeys.js / meta.js by the package's own build().
// Shared by prototype-harness-heldout-minimal-app-contract and -play-fails-honestly.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { normalize } from '../../../lib/prototype/node/config.mjs';
import { build } from '../../../lib/prototype/node/export.mjs';
import { protoDir, put, js, BIN } from './common.mjs';

export const CONFIG = { products: { 'rnd/products/northwind-portal': { key: 'np' } }, app: '__hp', registry: 'public/app/screens/index.js', data: 'public/app/data', playback: 'public/app/demo/journeys' };

const INDEX = `<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Northwind HP</title><link rel="stylesheet" href="./harness/harness.css"></head>
<body>
<script type="module" src="./app/main.js"></script>
</body>
</html>
`;

const STATE = (lossy) => `// the fake store: named mutations, two fixtures, a refusal; snapshot() is a JSON STRING
const FIXTURES = { default: { grants: [], seq: 0 }, 'two-grants': { grants: [{ id: 'G-1', status: 'draft' }, { id: 'G-2', status: 'submitted' }], seq: 2 } };
let state = structuredClone(FIXTURES.default);
export const store = {
	loadFixture(n) { if (!FIXTURES[n]) return false; state = structuredClone(FIXTURES[n]); return true; },
	list: (kind) => (kind === 'grants' ? state.grants.map((g) => ({ ...g })) : []),
	act(name, args = {}) {
		if (name === 'create') { state.grants.push({ id: 'G-' + ++state.seq, status: 'draft', owner: args.actor }); return { ok: true }; }
		const g = state.grants.find((x) => x.id === args.id);
		if (name === 'submit') { if (g && g.status === 'draft') { g.status = 'submitted'; return { ok: true }; } return { ok: false, rule: 'NW-R-001', reason: 'not a draft' }; }
		if (name === 'approve') { if (g && g.status === 'submitted') { g.status = 'approved'; return { ok: true }; } return { ok: false, rule: 'NW-R-002', reason: 'not submitted' }; }
		return { ok: false, reason: 'unknown ' + name };
	},
	snapshot: () => JSON.stringify(state),
	restore(s) { state = JSON.parse(s);${lossy ? ' delete state.seq;' : ''} },
	user: (id) => ({ id, name: 'Dana Oren' }),
};
// the session: ONLY set and user — no snapshot, restore or clearView
const signedIn = {};
export const session = { set(portal, id) { signedIn[portal] = id; }, user: (portal) => signedIn[portal] };
`;

const SCREENS = `// the registry: node-importable; render touches the DOM only when called
const node = (tag, attrs, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.textContent = text; return n; };
export const screens = [
	{ key: 'np-home', portal: 'np', route: '/np/home', kind: 'page', title: 'Home', render: () => node('section', { 'data-demo': 'fill-the-form see-status' }, 'Your grants') },
	{ key: 'np-grant', portal: 'np', route: '/np/grant', kind: 'page', title: 'Grant', render: () => node('button', { 'data-demo': 'submit-grant', type: 'button' }, 'Submit') },
	{ key: 'np-admin', portal: 'np', route: '/np/admin', kind: 'page', title: 'Admin', stub: true },
];
export const byKey = Object.fromEntries(screens.map((s) => [s.key, s]));
`;

const MAIN = `import { store, session } from './state.js';
import { screens, byKey } from './screens/index.js';
import * as data from './data/journeys.js';
import * as player from '../harness/player.js';
import * as meta from '../harness/meta.js';
import { stubScreen } from '../harness/catalog.js';

const main = document.createElement('main'); document.body.prepend(main);
const listeners = new Set();
let cur = null;
const route = () => { const p = location.hash.slice(1).split('?')[0]; return screens.find((s) => s.route === p) || screens[0]; };
function renderAll() {
	const s = route(); cur = { screen: s };
	main.replaceChildren(s.stub ? stubScreen(s, null, {}) : s.render());
	for (const f of listeners) f();
}
const app = { store, session, screens, byKey, current: () => cur, onRender: (f) => { listeners.add(f); }, renderAll };
window.__hp = app;
meta.init({ storageKey: 'hp', metaDefault: () => 'off' });
window.addEventListener('hashchange', renderAll);
renderAll();
player.init(app, { storageKey: 'hp', playbackBase: '../app/demo/journeys/', data, defaultUser: { np: 'U-dana' } });
`;

const GRANT_FLOW = (anchor) => `export default { key: 'np-grant-flow', steps: [
	{ user: 'U-dana', action: { name: 'create', args: {} } },
	{ user: 'U-dana', action: { name: 'submit', args: (s) => ({ id: s.list('grants').at(-1).id }) }${anchor ? `, anchor: ${JSON.stringify(anchor)}` : ''} },
	{},
] };
`;
const REFUSAL = (expect) => `export default { key: 'np-refusal', steps: [
	{ setup: 'two-grants' },
	{ action: { name: 'submit', args: { id: 'G-2' } }${expect ? ', expectRefusal: true' : ''} },
] };
`;

export const RECORDS = () => ({
	products: [{ id: 'northwind-portal', name: 'Northwind portal' }],
	screens: [
		{ id: 'np-home', key: 'np-home', name: 'Home', route: '/np/home', product: 'rnd/products/northwind-portal' },
		{ id: 'np-grant', key: 'np-grant', name: 'Grant', route: '/np/grant', product: 'rnd/products/northwind-portal' },
		{ id: 'np-admin', key: 'np-admin', name: 'Admin', route: '/np/admin', product: 'rnd/products/northwind-portal' },
	],
	stories: [
		{ id: '2026-01-10--fill-the-form', key: 'fill-the-form', name: 'As Dana I fill the form', screen: 'rnd/screens/np-home', journeys: ['rnd/user-journeys/np-grant-flow'] },
		{ id: '2026-01-10--see-status', key: 'see-status', name: 'As Dana I see the status', screen: 'rnd/screens/np-home', journeys: ['rnd/user-journeys/np-refusal'] },
		{ id: '2026-01-10--submit-grant', key: 'submit-grant', name: 'As Dana I submit the grant', screen: 'rnd/screens/np-grant', journeys: ['rnd/user-journeys/np-grant-flow', 'rnd/user-journeys/np-refusal'] },
	],
	personas: [], questions: [],
	journeys: [
		{ id: 'np-grant-flow', key: 'np-grant-flow', name: 'A grant from draft to admin', products: ['rnd/products/northwind-portal'], steps: [
			{ screen: 'rnd/screens/np-home', story: 'rnd/user-stories/2026-01-10--fill-the-form' },
			{ screen: 'rnd/screens/np-grant', story: 'rnd/user-stories/2026-01-10--submit-grant' },
			{ screen: 'rnd/screens/np-admin', system: true, caption: 'The admin sees the grant' },
		] },
		{ id: 'np-refusal', key: 'np-refusal', name: 'A submitted grant cannot be submitted again', products: ['rnd/products/northwind-portal'], steps: [
			{ screen: 'rnd/screens/np-home', story: 'rnd/user-stories/2026-01-10--see-status' },
			{ screen: 'rnd/screens/np-grant', story: 'rnd/user-stories/2026-01-10--submit-grant' },
		] },
	],
	dropped: {},
});

/**
 * Build HP into a fresh temp folder → its path. Mutations (play-fails-honestly): `anchor` gives
 * np-grant-flow's module step 2 that anchor; `noExpectRefusal` drops np-refusal step 2's expectRefusal;
 * `lossyRestore` makes store.restore drop `seq`.
 */
export async function buildHP({ anchor = null, noExpectRefusal = false, lossyRestore = false } = {}) {
	const { dir } = protoDir('hp');
	put(dir, 'harness.config.mjs', `export default ${js(CONFIG)};\n`);
	put(dir, 'package.json', '{"name":"northwind-hp","private":true,"type":"module"}\n');
	put(dir, 'public/index.html', INDEX);
	const v = spawnSync(process.execPath, [BIN, 'vendor'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
	if (v.status !== 0) throw new Error(`HP: vendor exited ${v.status}\n${v.stdout}${v.stderr}`);
	put(dir, 'public/app/state.js', STATE(lossyRestore));
	put(dir, 'public/app/screens/index.js', SCREENS);
	put(dir, 'public/app/main.js', MAIN);
	put(dir, 'public/app/demo/journeys/np-grant-flow.js', GRANT_FLOW(anchor));
	put(dir, 'public/app/demo/journeys/np-refusal.js', REFUSAL(!noExpectRefusal));
	const playback = {};
	for (const k of ['np-grant-flow', 'np-refusal']) playback[k] = (await import(`${pathToFileURL(path.join(dir, `public/app/demo/journeys/${k}.js`)).href}?hp=${Date.now()}`)).default;
	const r = build(normalize(CONFIG, dir), RECORDS(), { playback });
	if (r.errors.length) throw new Error(`HP: build failed\n${r.errors.join('\n')}`);
	put(dir, 'public/app/data/journeys.js', r.journeysJs);
	put(dir, 'public/app/data/meta.js', r.metaJs);
	return dir;
}

/** `node <bin> play [args]` in HP → { code, out, coverage } */
export function play(dir, ...args) {
	const r = spawnSync(process.execPath, [BIN, 'play', ...args], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
	const f = path.join(dir, 'tools', 'out', 'coverage.json');
	return { code: r.status, out: `${r.stdout}${r.stderr}`, coverage: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null };
}
