// HELD-OUT (cr-modules-006-h5-migration-empty-json-subdir): the stage migration on a workspace with no change
// request, with --json, from a subdirectory with and without --root, on a folder that is not a workspace, and
// --root resolved from the cwd. Never a stack trace. Written by the test stage from the review's steps.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rndWorkspace, cleanupAll } from '../helpers/rnd-workspace.mjs';
import { product, req, settle, migrate } from './lib/cr-stage-records.mjs';

after(() => cleanupAll());
const noTrace = (r) => assert.doesNotMatch(r.out + r.err, /^\s+at /m, 'no stack frame');

test('h5 — migration edges', () => {
	const ws = rndWorkspace();
	assert.equal(fs.existsSync(path.join(ws, 'data/rnd/change-requests')), false);
	// 1: from the root
	const runs = [[], ['--json'], ['--write'], ['--write', '--json']].map((args) => [args, migrate(ws, { args })]);
	for (const [args, r] of runs) {
		assert.equal(r.code, 0, `${args}: ${r.out}${r.err}`);
		assert.equal(r.err, '', `${args}: no stderr`);
		assert.doesNotMatch(r.out, /would set|cannot tell/);
		noTrace(r);
		if (args.includes('--json')) {
			const j = JSON.parse(r.out);
			for (const k of ['planned', 'set', 'cannot_tell', 'failed']) assert.deepEqual(j[k], [], k);
			assert.deepEqual(j.layers, {});
		} else assert.match(r.out, /nothing to set|0 set/);
	}
	assert.equal(execFileSync('git', ['status', '--porcelain', 'data/'], { cwd: ws, encoding: 'utf8' }), '');

	// 2: from data/ and modules/rnd with --root, byte for byte
	fs.mkdirSync(path.join(ws, 'data'), { recursive: true });
	for (const cwd of [path.join(ws, 'data'), path.join(ws, 'modules', 'rnd')]) {
		assert.equal(migrate(ws, { cwd, args: ['--root', ws] }).out, runs[0][1].out, cwd);
		assert.equal(migrate(ws, { cwd, args: ['--root', ws, '--json'] }).out, runs[1][1].out, cwd);
	}
	// 3: from data/ with no --root — walks up to the workspace
	const up = migrate(ws, { cwd: path.join(ws, 'data') });
	if (up.code === 0) assert.equal(up.out, runs[0][1].out);
	else { assert.equal(up.code, 1); assert.match(up.out, /--root/); }
	noTrace(up);
	// 4: not a workspace
	const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'h5-empty-'));
	for (const root of [empty, path.join(ws, 'does-not-exist')]) {
		const r = migrate(ws, { args: ['--root', root, '--write'] });
		assert.equal(r.code, 1, r.out + r.err);
		assert.equal(r.out.trim().split('\n').length, 1, r.out);
		assert.match(r.out, /no workspace|--root/);
		noTrace(r);
	}
	assert.deepEqual(fs.readdirSync(empty), []);
	fs.rmSync(empty, { recursive: true, force: true });
	// 5: --root .. from data/, one derivable request
	product(ws);
	req(ws, 'one', ['status: suggested']);
	settle(ws);
	const j = migrate(ws, { cwd: path.join(ws, 'data'), args: ['--root', '..', '--json'] });
	assert.equal(j.code, 0, j.out + j.err);
	assert.deepEqual(JSON.parse(j.out).planned, [{ id: 'one', stage: 'design', was: null }]);
	assert.doesNotMatch(fs.readFileSync(path.join(ws, 'data/rnd/change-requests/one.change-request.md'), 'utf8'), /^stage:/m);
});
