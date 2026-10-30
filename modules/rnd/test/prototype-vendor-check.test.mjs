// vendor, check and the bin. What a fixture pins: the stamp (version, LF-normalised hash, js and css forms), an
// unchanged second run, the refusal of a local edit and --force, a CRLF checkout reading unchanged, each check
// mismatch, a stale stamp warning, and --apply running only `dt set` on record ids — never verified, never commit.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vendorInto, vendorStatus, parseStamp, hashBody, sourceFiles, run as vendorRun } from '../lib/prototype/node/vendor.mjs';
import { compare, run as checkRun } from '../lib/prototype/node/check.mjs';
import { normalize } from '../lib/prototype/node/config.mjs';
import { VERSION } from '../lib/prototype/node/export.mjs';
import { main, parse } from '../bin/dt-prototype.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p = 'proto-vendor-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); made.push(d); return fs.realpathSync(d); };
const quiet = () => { const out = []; return { out, log: (l) => out.push(l), error: (l) => out.push(l) }; };

describe('vendor', () => {
	test('stamps every browser file with the version and the hash of its body, js and css alike', () => {
		const dir = tmp(); const r = vendorInto(dir);
		assert.deepEqual(r.written, sourceFiles());
		assert.deepEqual(sourceFiles(), ['catalog.js', 'dom.js', 'harness.css', 'meta.js', 'playback.js', 'player.js']);
		const js = fs.readFileSync(path.join(dir, 'player.js'), 'utf8');
		assert.match(js.split('\n')[0], new RegExp(`^// @dreamteamer/rnd ${VERSION.replace(/\./g, '\\.')} prototype-harness — vendored, do not edit — sha256:[0-9a-f]{64}$`));
		assert.match(fs.readFileSync(path.join(dir, 'harness.css'), 'utf8').split('\n')[0], /^\/\* @dreamteamer\/rnd .* sha256:[0-9a-f]{64} \*\/$/);
		const s = parseStamp(js); assert.equal(s.hash, hashBody(s.body));
		assert.ok(vendorStatus(dir).every((v) => v.state === 'ok'));
	});
	test('a second run is unchanged; a CRLF checkout of an unchanged file reads unchanged', () => {
		const dir = tmp(); vendorInto(dir);
		assert.deepEqual(vendorInto(dir).unchanged, sourceFiles());
		const f = path.join(dir, 'meta.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
		const css = path.join(dir, 'harness.css'); fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replace(/\n/g, '\r\n'));
		assert.equal(vendorStatus(dir).find((v) => v.file === 'meta.js').state, 'ok');
		assert.equal(vendorStatus(dir).find((v) => v.file === 'harness.css').state, 'ok');
		assert.deepEqual(vendorInto(dir).refused, []);
	});
	test('a local edit is refused by name, and --force puts the package\'s bytes back', () => {
		const dir = tmp(); vendorInto(dir);
		const f = path.join(dir, 'player.js'); const orig = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, orig.replace('const EN = {', 'const EN = { local: 1,'));
		assert.equal(vendorStatus(dir).find((v) => v.file === 'player.js').state, 'edited');
		assert.deepEqual(vendorInto(dir).refused, [{ file: 'player.js', why: 'edited since it was vendored' }]);
		assert.deepEqual(vendorInto(dir, { force: true }).written, ['player.js']);
		assert.equal(fs.readFileSync(f, 'utf8'), orig);
	});
	test('this version\'s number on bytes the package does not ship is stale, not current', () => {
		const dir = tmp(); vendorInto(dir);
		const f = path.join(dir, 'dom.js');
		const body = 'export const older = 1;\n';
		fs.writeFileSync(f, `// @dreamteamer/rnd ${VERSION} prototype-harness — vendored, do not edit — sha256:${hashBody(body)}\n${body}`);
		assert.deepEqual(vendorStatus(dir).find((v) => v.file === 'dom.js'), { file: 'dom.js', state: 'stale', version: VERSION });
	});
	test('a css stamp missing its closing */ is not a stamp', () => {
		const dir = tmp(); vendorInto(dir);
		const f = path.join(dir, 'harness.css'); const text = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, text.replace(/ \*\/\n/, '\n'));
		assert.equal(parseStamp(fs.readFileSync(f, 'utf8')), null);
		assert.equal(vendorStatus(dir).find((v) => v.file === 'harness.css').state, 'unstamped');
	});
	test('a stamp of another version is stale; a file with no stamp is refused', () => {
		const dir = tmp(); vendorInto(dir, { version: '0.0.1' });
		assert.ok(vendorStatus(dir).every((v) => v.state === 'stale' && v.version === '0.0.1'));
		assert.deepEqual(vendorInto(dir).written.length, sourceFiles().length, 'a clean stale copy is upgraded');
		fs.writeFileSync(path.join(dir, 'dom.js'), 'export const mine = 1;\n');
		assert.deepEqual(vendorInto(dir).refused, [{ file: 'dom.js', why: 'not a vendored file' }]);
	});
});

/** a prototype folder in a workspace, with a node-importable registry */
function prototype(registry, extra = '') {
	const ws = tmp('proto-check-');
	fs.writeFileSync(path.join(ws, 'package.json'), '{}'); fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	const dir = path.join(ws, 'proto'); fs.mkdirSync(path.join(dir, 'public/app/screens'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'public/app/screens/index.js'), `export const screens = ${JSON.stringify(registry)};\n`);
	fs.writeFileSync(path.join(dir, 'harness.config.mjs'), `export default { products: { 'rnd/products/grantee-portal': { key: 'gp' } }, app: '__nw', registry: 'public/app/screens/index.js'${extra} };\n`);
	vendorInto(path.join(dir, 'public/harness'));
	return dir;
}
const ROWS = {
	products: [{ id: 'grantee-portal' }],
	screens: [
		{ id: 'un-gp-home', key: 'un-gp-home', product: 'rnd/products/grantee-portal', route: '/gp/home', kind: 'app', scope_rows: ['GRT-R-001'] },
		{ id: 'un-gp-apply', key: 'un-gp-apply', product: 'rnd/products/grantee-portal', route: '/gp/apply', build_status: 'verified' },
		{ id: 'gp-home', key: 'gp-home', product: 'rnd/products/legacy', route: '/legacy' },
	],
	stories: [{ id: '2026-01-10--open', key: 'open', screen: 'rnd/screens/un-gp-home' }],
	questions: [{ id: 'q-deadline', status: 'open', blocks: ['rnd/screens/un-gp-home'] }, { id: 'q-old', status: 'resolved', blocks: ['rnd/screens/un-gp-home'] }],
	journeys: [], personas: [],
};
const GOOD = [
	{ key: 'gp-home', portal: 'gp', route: '/gp/home', kind: 'app', prd: ['GRT-R-001'], open: ['q-deadline'], stories: ['open'] },
	{ key: 'gp-apply', portal: 'gp', route: '/gp/apply', stub: true },
	{ key: 'landing', portal: null, route: '/' },
];
const strip = { screenKey: (k) => k.replace(/^un-/, '') };
const dtFake = (rows, calls = []) => (args) => {
	calls.push(args.join(' '));
	const map = { 'rnd/screens': 'screens', 'rnd/user-journeys': 'journeys', 'rnd/user-stories': 'stories', 'rnd/personas': 'personas', 'rnd/open-questions': 'questions', 'rnd/products': 'products' };
	if (args[0] === 'get') return JSON.stringify({ fields: {} });
	if (args[0] === 'list') return JSON.stringify(rows[map[args[1]]]);
	return '';
};

describe('check', () => {
	const c = (extra = {}) => normalize({ products: { 'rnd/products/grantee-portal': { key: 'gp' } }, app: '__nw', registry: 'r.js', ...strip, ...extra }, prototype([]));
	test('a registry that agrees with the records, through screenKey, has no mismatch', () => {
		const r = compare(c(), ROWS, GOOD);
		assert.deepEqual(r.mismatches, []);
		assert.deepEqual(r.matched.map((m) => [m.id, m.key, m.stub]), [['un-gp-home', 'gp-home', false], ['un-gp-apply', 'gp-apply', true]]);
	});
	test('two records that screenKey maps to one key are a mismatch, and --apply writes nothing', () => {
		const rows = structuredClone(ROWS); rows.screens.push({ id: 'gp-home', key: 'gp-home', product: 'rnd/products/grantee-portal', route: '/gp/home' });
		assert.deepEqual(compare(c(), rows, GOOD).mismatches.map((m) => `${m.kind}:${m.key}`), ['duplicate record:gp-home']);
	});
	test('a route written with or without its leading # is the same route', () => {
		const rows = structuredClone(ROWS); rows.screens[0].route = '#/gp/home'; rows.screens[1].route = '#/gp/apply';
		assert.deepEqual(compare(c(), rows, GOOD).mismatches, []);
	});
	test('each mismatch, by kind', () => {
		const kinds = (reg) => compare(c(), ROWS, reg).mismatches.map((m) => `${m.kind}:${m.key}`);
		assert.deepEqual(kinds([GOOD[0]]), ['no module:gp-apply']);
		assert.deepEqual(kinds([...GOOD, { key: 'gp-extra', portal: 'gp', route: '/gp/extra' }]), ['no record:gp-extra']);
		assert.deepEqual(kinds([{ ...GOOD[0], route: '/gp/start' }, GOOD[1]]), ['route:gp-home']);
		assert.deepEqual(kinds([{ ...GOOD[0], kind: 'static' }, GOOD[1]]), ['kind:gp-home']);
		assert.deepEqual(kinds([{ ...GOOD[0], prd: [] }, GOOD[1]]), ['rules:gp-home']);
		assert.deepEqual(kinds([{ ...GOOD[0], open: [] }, GOOD[1]]), ['open:gp-home']);
		assert.deepEqual(kinds([{ ...GOOD[0], stories: ['open', 'other'] }, GOOD[1]]), ['stories:gp-home']);
		assert.deepEqual(kinds([GOOD[0], GOOD[1], { ...GOOD[1], route: '/gp/other' }]), ['duplicate key:gp-apply']);
		assert.deepEqual(kinds([GOOD[0], { ...GOOD[1], route: '/gp/home' }]), ['duplicate route:gp-apply', 'route:gp-apply']);
		assert.deepEqual(kinds([{ ...GOOD[0], portal: 'bo' }, GOOD[1]]), ['no module:gp-home']);
	});
	test('--apply sets build_status and prototype on RECORD ids only, never verified, never a commit', async () => {
		const dir = prototype(GOOD, `, screenKey: (k) => k.replace(/^un-/, ''), prototype: 'northwind-proto'`);
		const calls = []; const q = quiet();
		assert.equal(await checkRun(dir, { apply: true, dt: dtFake(ROWS, calls), ...q }), 0, q.out.join('\n'));
		const writes = calls.filter((x) => !/^(get|list) /.test(x));
		assert.deepEqual(writes, ['set rnd/screens/un-gp-home build_status=built prototype=rnd/prototypes/northwind-proto']);
		assert.ok(q.out.includes('dreamteamer set rnd/screens/un-gp-home build_status=built prototype=rnd/prototypes/northwind-proto'));
		assert.ok(!calls.some((x) => /commit|verified/.test(x)));
	});
	test('--apply without a prototype in the config exits 2 naming the key', async () => {
		const q = quiet();
		assert.equal(await checkRun(prototype(GOOD), { apply: true, dt: dtFake(ROWS), ...q }), 2);
		assert.match(q.out.join('\n'), /needs "prototype"/);
	});
	test('a stale stamp warns (fails under --strict); an edited vendored file fails', async () => {
		const dir = prototype(GOOD, `, screenKey: (k) => k.replace(/^un-/, '')`);
		vendorInto(path.join(dir, 'public/harness'), { force: true, version: '0.0.1' });
		const q = quiet();
		assert.equal(await checkRun(dir, { dt: dtFake(ROWS), ...q }), 0);
		assert.match(q.out.join('\n'), /warn {2}vendored {8}player\.js {2}stamped 0\.0\.1/);
		assert.equal(await checkRun(dir, { strict: true, dt: dtFake(ROWS), ...quiet() }), 1);
		const f = path.join(dir, 'public/harness/dom.js'); fs.appendFileSync(f, '// local\n');
		const e = quiet();
		assert.equal(await checkRun(dir, { dt: dtFake(ROWS), ...e }), 1);
		assert.match(e.out.join('\n'), /fail {2}vendored {8}dom\.js {2}body no longer matches its stamp/);
	});
});

describe('the bin', () => {
	test('parses verbs and flags, and refuses an unknown verb or flag with usage, exit 2', async () => {
		assert.deepEqual(parse(['play', '--only', 'a,b', '--jobs', '2']).flags.only, ['a', 'b']);
		const q = quiet();
		assert.equal(await main(['dance'], q), 2); assert.match(q.out[0], /^usage: dt-prototype/);
		assert.equal(await main(['export', '--loud'], quiet()), 2);
		assert.equal(await main([], quiet()), 2);
	});
	test('init writes a skeleton config and vendors; a second init leaves the config alone', async () => {
		const ws = tmp('proto-init-'); fs.writeFileSync(path.join(ws, 'package.json'), '{}'); fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		const dir = path.join(ws, 'p'); fs.mkdirSync(dir);
		assert.equal(await vendorRun(dir, { init: true, ...quiet() }), 0);
		assert.ok(fs.existsSync(path.join(dir, 'harness.config.mjs')));
		assert.deepEqual(fs.readdirSync(path.join(dir, 'public/harness')).sort(), sourceFiles());
		const q = quiet();
		assert.equal(await main(['init', '--dir', dir], q), 0);
		assert.match(q.out.join('\n'), /harness\.config\.mjs exists — left alone/);
	});
});
