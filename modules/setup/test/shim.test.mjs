// The shim: dt-setup doctor and setup hand over to the engine's own verbs (and say so once, on stderr);
// link / unlink / guard are untouched; an engine before 0.47 is refused with the upgrade line.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, cleanup, engineMeets, ENGINE_VERSION, MODULES } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const BIN = path.join(MODULES, 'setup', 'bin', 'setup.mjs');
const run = (root, args) => { const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; };

describe('dt-setup, the shim', { skip: !engineMeets('core') && `needs engine >=0.47.0, this is ${ENGINE_VERSION}` }, () => {
	test('doctor prints the pointer and the engine\'s status board; setup hands over to dt setup; unknown verbs still refuse', () => {
		const root = virginWorkspace();
		const d = run(root, ['doctor']);
		assert.equal(d.code, 0, d.stderr);
		assert.match(d.stderr, /dt-setup doctor is `dt status` now/);
		assert.match(d.stdout, /compiled: /);
		const s = run(root, ['setup']);
		assert.equal(s.code, 0, s.stderr);
		assert.match(s.stderr, /dt-setup setup is `dt setup/);
		assert.match(s.stdout, /no installed module declares setup/);
		assert.equal(run(root, ['frobnicate']).code, 2);
	});
	test('an engine before 0.47 under node_modules is refused with the upgrade line', () => {
		const root = virginWorkspace();
		// the engine link replaced by a stub that claims an old version
		fs.rmSync(path.join(root, 'node_modules', 'dreamteamer'), { recursive: true, force: true });
		fs.mkdirSync(path.join(root, 'node_modules', 'dreamteamer', 'bin'), { recursive: true });
		fs.writeFileSync(path.join(root, 'node_modules', 'dreamteamer', 'package.json'), JSON.stringify({ name: 'dreamteamer', version: '0.46.1' }));
		fs.writeFileSync(path.join(root, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js'), '');
		const r = run(root, ['doctor']);
		assert.equal(r.code, 2);
		assert.match(r.stderr, /runs dreamteamer 0\.46\.1, before 0\.47/);
	});
});
