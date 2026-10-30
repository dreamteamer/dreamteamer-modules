// HELD-OUT (prototype-harness-heldout-vendor-drift): a one-byte edit to a vendored file is refused and named,
// --force restores the package's bytes, a clean file is never rewritten, and a stale stamp over a matching body is
// upgraded. The bin is run as a person runs it, from the prototype's folder. Written by the test stage.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { protoDir, put, js, BIN, RND, cleanup } from './lib/common.mjs';

after(cleanup);

const PKG = JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8')).version;
const SRC_DIR = path.join(RND, 'lib', 'prototype', 'browser');
const SRC = (f) => fs.readFileSync(path.join(SRC_DIR, f));
const FILES = fs.readdirSync(SRC_DIR).filter((f) => /\.(js|css)$/.test(f)).sort();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let dir, H;
const vendor = (...flags) => { const r = spawnSync(process.execPath, [BIN, 'vendor', ...flags], { cwd: dir, encoding: 'utf8', timeout: 60_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
const file = (f) => path.join(H, f);
const read = (f) => fs.readFileSync(file(f));
const snapshot = () => Object.fromEntries(FILES.map((f) => [f, read(f)]));
/** change one byte in the body: append a space to the last non-empty line */
function editOneByte(f) {
	const t = fs.readFileSync(file(f), 'utf8');
	const i = t.trimEnd().length;
	fs.writeFileSync(file(f), `${t.slice(0, i)} ${t.slice(i)}`);
}

describe('held-out: vendored files cannot drift silently', () => {
	let case1;
	before(() => {
		({ dir } = protoDir('northwind-proto'));
		put(dir, 'harness.config.mjs', `export default ${js({ products: { 'rnd/products/northwind-portal': { key: 'np' } }, app: '__np', registry: 'public/app/screens/index.js' })};\n`);
		fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
		H = path.join(dir, 'public', 'harness');
	});

	test('case 1: vendor stamps every file with the package version and the sha256 of the package bytes', () => {
		const r = vendor();
		assert.equal(r.code, 0, r.out);
		const jsStamp = new RegExp(`^// @dreamteamer/rnd ${esc(PKG)} prototype-harness — vendored, do not edit — sha256:([0-9a-f]{64})$`);
		const cssStamp = new RegExp(`^/\\* @dreamteamer/rnd ${esc(PKG)} prototype-harness — vendored, do not edit — sha256:([0-9a-f]{64}) \\*/$`);
		for (const f of FILES) {
			const b = read(f); const nl = b.indexOf(0x0a);
			const first = b.subarray(0, nl).toString('utf8'); const body = b.subarray(nl + 1);
			const m = (f.endsWith('.css') ? cssStamp : jsStamp).exec(first);
			assert.ok(m, `${f} stamp: ${first}`);
			assert.ok(body.equals(SRC(f)), `${f}: the bytes below the stamp are not the package's`);
			assert.equal(sha(body), m[1], `${f}: the stamp's hash is not the body's`);
		}
		case1 = snapshot();
	});

	test('case 2: a second vendor reports every file unchanged and moves no mtime', () => {
		const mt = Object.fromEntries(FILES.map((f) => [f, fs.statSync(file(f)).mtimeMs]));
		const r = vendor();
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, new RegExp(`0 written · ${FILES.length} unchanged · 0 refused`));
		for (const f of FILES) assert.equal(fs.statSync(file(f)).mtimeMs, mt[f], `${f} mtime moved`);
	});

	test('case 3: a one-byte edit to player.js is refused by name and left as edited; nothing else changes', () => {
		editOneByte('player.js');
		const edited = read('player.js'); const others = snapshot();
		const r = vendor();
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /player\.js/);
		assert.ok(read('player.js').equals(edited), 'player.js lost its edit');
		for (const f of FILES) if (f !== 'player.js') assert.ok(read(f).equals(others[f]), `${f} changed`);
	});

	test('case 4: a one-byte edit to harness.css is refused by name', () => {
		assert.equal(vendor('--force').code, 0); // restore player.js first
		editOneByte('harness.css');
		const r = vendor();
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /harness\.css/);
		assert.equal(vendor('--force').code, 0); // leave a clean tree for the next case
	});

	test('case 5: a stale version over a matching body is rewritten with the package stamp, never refused', () => {
		const t = fs.readFileSync(file('playback.js'), 'utf8');
		fs.writeFileSync(file('playback.js'), t.replace(new RegExp(`^(// @dreamteamer/rnd )${esc(PKG)}( )`), '$10.0.1$2'));
		assert.match(fs.readFileSync(file('playback.js'), 'utf8').split('\n')[0], /@dreamteamer\/rnd 0\.0\.1 /);
		const r = vendor();
		assert.equal(r.code, 0, r.out);
		assert.match(fs.readFileSync(file('playback.js'), 'utf8').split('\n')[0], new RegExp(`@dreamteamer/rnd ${esc(PKG)} `));
		assert.ok(read('playback.js').equals(case1['playback.js']));
	});

	test('case 6: --force over an edited player.js restores its case-1 bytes', () => {
		editOneByte('player.js');
		assert.ok(!read('player.js').equals(case1['player.js']));
		const r = vendor('--force');
		assert.equal(r.code, 0, r.out);
		assert.ok(read('player.js').equals(case1['player.js']), 'player.js is not byte-identical to case 1');
	});
});
