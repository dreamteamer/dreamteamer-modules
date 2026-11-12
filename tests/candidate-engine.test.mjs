// DT_CANDIDATES: the candidate engine every behaviour test runs on, verified by hash before anything
// runs — a missing tarball or a wrong hash is a refusal at import, never a silent devDependency.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './helpers/workspace.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-cand-')); made.push(d); return d; };
/** Import the helper in a child with DT_CANDIDATES set; returns { code, stdout, stderr }. */
const load = (dir) => spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(ROOT, 'tests', 'helpers', 'workspace.mjs')}').then((m) => console.log(m.ENGINE_VERSION))`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DT_CANDIDATES: dir, DT_ENGINE_DIR: '' } });

describe('DT_CANDIDATES', () => {
	test('a folder with no tarball is refused naming the path', () => {
		const dir = tmp();
		const r = load(dir);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, new RegExp(`DT_CANDIDATES=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: expected exactly one dreamteamer-<version>\\.tgz`));
	});

	test('a wrong hash is refused naming both hashes; the right one loads and reads the tarball\'s version', () => {
		const dir = tmp();
		// the devDependency engine, packed: a real candidate-shaped tarball
		const out = execFileSync('npm', ['pack', path.join(ROOT, 'node_modules', 'dreamteamer'), '--pack-destination', dir, '--json', '--silent'], { cwd: ROOT, encoding: 'utf8' });
		const file = JSON.parse(out)[0].filename;
		const actual = createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
		fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${'0'.repeat(64)}  ${file}\n`);
		const bad = load(dir);
		assert.notEqual(bad.status, 0);
		assert.match(bad.stderr, new RegExp(`${file.replace('.', '\\.')} is ${actual}, SHA256SUMS says 0{64}`));
		fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${actual}  ${file}\n`);
		const ok = load(dir);
		assert.equal(ok.status, 0, ok.stderr);
		assert.equal(ok.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'dreamteamer', 'package.json'), 'utf8')).version);
		// no SHA256SUMS at all is a refusal too
		fs.rmSync(path.join(dir, 'SHA256SUMS'));
		assert.match(load(dir).stderr, /no SHA256SUMS beside/);
	});
});
