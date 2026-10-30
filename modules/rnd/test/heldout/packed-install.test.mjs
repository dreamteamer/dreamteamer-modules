// HELD-OUT (prototype-harness-heldout-packed-install): the packed rnd tarball holds every file dt-prototype
// imports and every browser file vendor copies, compiles in a workspace, and its installed bin runs `init` from
// its own files and refuses an unknown verb with the usage. Written by the test stage against the built code.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, installPacked, packedFiles, run, cleanup, pkgOf } from '../../../../tests/helpers/workspace.mjs';
import { RND, REPO } from './lib/common.mjs';

after(cleanup);
const VERSION = pkgOf('rnd').version;

/** relative imports (static and dynamic, template prefixes resolved against `expand`) of one source file */
function importsOf(file) {
	const text = fs.readFileSync(file, 'utf8');
	const out = new Set();
	for (const m of text.matchAll(/(?:^|[^\w.])(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) out.add(m[1]);
	for (const m of text.matchAll(/^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) out.add(m[1]);
	for (const m of text.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) out.add(m[1]);
	return [...out].map((r) => path.resolve(path.dirname(file), r));
}

describe('held-out: the packed install', () => {
	test('step 1: the composed modules have not drifted (compose-core --check)', () => {
		const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'compose-core.mjs'), '--check'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
		assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
	});

	test('steps 2–3: every file the bin reaches and every browser file vendor copies is in the tarball', () => {
		const files = new Set(packedFiles('rnd'));
		const bin = path.join(RND, 'bin', 'dt-prototype.mjs');
		// the bin loads each verb's module by a template path: `../lib/prototype/node/${file}.mjs`
		const verbs = [...fs.readFileSync(bin, 'utf8').matchAll(/^\t(\w+): \['(\w+)'/gm)].map((m) => m[2]);
		assert.deepEqual([...new Set(verbs)].sort(), ['check', 'export', 'play', 'shoot', 'vendor', 'walk']);
		const seen = new Set(); const todo = [bin, ...verbs.map((v) => path.join(RND, 'lib', 'prototype', 'node', `${v}.mjs`))];
		while (todo.length) {
			const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
			assert.ok(fs.existsSync(f), `${path.relative(RND, f)} is imported but does not exist in the source`);
			for (const d of importsOf(f)) if (d.startsWith(RND)) todo.push(d);
		}
		const browser = path.join(RND, 'lib', 'prototype', 'browser');
		for (const f of fs.readdirSync(browser).filter((x) => /\.(js|css)$/.test(x))) seen.add(path.join(browser, f));
		const missing = [...seen].map((f) => path.relative(RND, f).split(path.sep).join('/')).filter((r) => !files.has(r)).sort();
		assert.deepEqual(missing, [], `missing from the tarball: ${missing.join(', ')}`);
		assert.ok(seen.size >= 15, `only ${seen.size} files reached — the import walk is broken`);
	});

	test('steps 4–5: compile and check in a workspace; the installed bin inits a prototype and refuses a bogus verb', () => {
		const ws = virginWorkspace();
		installPacked(ws, ['rnd']);
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}\n');
		// npm links a package's `bin` entries into node_modules/.bin on install and makes each target executable
		// (bin-links); the helper only unpacks, so do what npm does
		fs.mkdirSync(path.join(ws, 'node_modules', '.bin'), { recursive: true });
		for (const [name, rel] of Object.entries(pkgOf('rnd').bin ?? {})) {
			fs.chmodSync(path.join(ws, 'node_modules', '@dreamteamer', 'rnd', rel), 0o755);
			fs.symlinkSync(path.join('..', '@dreamteamer', 'rnd', rel), path.join(ws, 'node_modules', '.bin', name));
		}
		const c = run(ws, ['compile']);
		assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
		assert.doesNotMatch(c.stdout + c.stderr, /not a known kind/);
		const k = run(ws, ['check']);
		assert.equal(k.status, 0, `${k.stdout}\n${k.stderr}`);

		const dir = path.join(ws, 'prototypes', 'northwind'); fs.mkdirSync(dir, { recursive: true });
		const installed = path.join(ws, 'node_modules', '@dreamteamer', 'rnd', 'bin', 'dt-prototype.mjs');
		const i = spawnSync(process.execPath, [installed, 'init'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
		assert.equal(i.status, 0, `${i.stdout}\n${i.stderr}`);
		const player = path.join(dir, 'public', 'harness', 'player.js');
		assert.ok(fs.existsSync(player), 'public/harness/player.js was not written');
		assert.match(fs.readFileSync(player, 'utf8').split('\n')[0], new RegExp(`^// @dreamteamer/rnd ${VERSION.replace(/\./g, '\\.')} prototype-harness`));
		assert.ok(fs.existsSync(path.join(dir, 'harness.config.mjs')), 'harness.config.mjs was not written');

		const b = spawnSync('npx', ['--no-install', 'dt-prototype', 'bogus'], { cwd: ws, encoding: 'utf8', timeout: 60_000 });
		assert.equal(b.status, 2, `${b.stdout}\n${b.stderr}`);
		const usage = `${b.stdout}${b.stderr}`;
		assert.match(usage, /usage/);
		for (const v of ['init', 'vendor', 'export', 'check', 'play', 'shoot', 'walk']) assert.match(usage, new RegExp(`\\b${v}\\b`), `usage does not name ${v}`);
	});
});
