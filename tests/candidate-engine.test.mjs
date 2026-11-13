// scripts/use-candidate.mjs (cr-dt-007, D60, D72): the candidate engine installed over
// node_modules/dreamteamer, verified by hash first — a missing tarball, a wrong hash or a tarball that is
// not the engine is a refusal; package.json and the lockfile are never touched. Run against a scratch
// root, never this repo's own node_modules. When DT_CANDIDATES is set (CI after the step), the engine in
// place is that candidate.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './helpers/workspace.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'use-candidate.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-cand-'))); made.push(d); return d; };
const use = (folder, root) => spawnSync(process.execPath, [SCRIPT, folder, '--root', root], { encoding: 'utf8' });
const ENGINE_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'dreamteamer', 'package.json'), 'utf8'));

/** A scratch repo root: a package.json, a lockfile, and node_modules holding the engine's dependencies as stubs. */
function scratchRoot() {
	const root = tmp();
	fs.writeFileSync(path.join(root, 'package.json'), '{"name":"scratch","private":true}\n');
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
	for (const d of Object.keys(ENGINE_PKG.dependencies ?? {})) { fs.mkdirSync(path.join(root, 'node_modules', d), { recursive: true }); fs.writeFileSync(path.join(root, 'node_modules', d, 'package.json'), `{"name":"${d}"}`); }
	return root;
}
/** A candidate folder: the installed engine packed, its sums written (or a wrong one). */
function candidate({ wrong = false } = {}) {
	const dir = tmp();
	const out = execFileSync('npm', ['pack', path.join(ROOT, 'node_modules', 'dreamteamer'), '--pack-destination', dir, '--json', '--silent'], { cwd: ROOT, encoding: 'utf8' });
	const file = JSON.parse(out)[0].filename;
	const sha = createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
	fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${wrong ? '0'.repeat(64) : sha}  ${file}\n`);
	return { dir, file, sha };
}

describe('use-candidate', () => {
	test('a folder with no tarball is refused naming the path', () => {
		const dir = tmp();
		const r = use(dir, scratchRoot());
		assert.equal(r.status, 1);
		assert.match(r.stderr, /expected exactly one dreamteamer-<version>\.tgz there \(found none\)/);
	});
	test('a wrong hash is refused naming both; no SHA256SUMS is refused', () => {
		const c = candidate({ wrong: true });
		const r = use(c.dir, scratchRoot());
		assert.equal(r.status, 1);
		assert.match(r.stderr, new RegExp(`is ${c.sha}, SHA256SUMS says 0{64}`));
		fs.rmSync(path.join(c.dir, 'SHA256SUMS'));
		assert.match(use(c.dir, scratchRoot()).stderr, /no SHA256SUMS beside/);
	});
	test('the right one lands over node_modules/dreamteamer; package.json and the lockfile are untouched', () => {
		const c = candidate();
		const root = scratchRoot();
		const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8'), lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
		const r = use(c.dir, root);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, new RegExp(`node_modules/dreamteamer is the candidate ${ENGINE_PKG.version.replace(/\./g, '\\.')}`));
		assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'dreamteamer', 'package.json'), 'utf8')).version, ENGINE_PKG.version);
		assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), pkg);
		assert.equal(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), lock);
	});
	test('a candidate whose dependency this repo does not hold is refused naming it', () => {
		const c = candidate();
		const root = scratchRoot();
		const dep = Object.keys(ENGINE_PKG.dependencies)[0];
		fs.rmSync(path.join(root, 'node_modules', dep), { recursive: true });
		const r = use(c.dir, root);
		assert.equal(r.status, 1);
		assert.match(r.stderr, new RegExp(`depends on ${dep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
	});
	test('in CI after the step: the engine in place is the candidate the folder holds', { skip: !process.env.DT_CANDIDATES && 'DT_CANDIDATES is not set — the step did not run here' }, () => {
		const folder = path.resolve(process.env.DT_CANDIDATES);
		const file = fs.readdirSync(folder).find((f) => f.endsWith('.tgz'));
		const v = /^dreamteamer-(.+)\.tgz$/.exec(file)[1];
		assert.equal(ENGINE_PKG.version, v);
	});
});
