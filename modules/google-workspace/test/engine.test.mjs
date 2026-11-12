// The extension through the real engine (the one under test: repo devDependency or DT_ENGINE_DIR), in
// a fresh workspace with the packed module only. Proves the API 1 seam carries the command and the
// doctor rows; proves nothing about Google, since no account, client or server exists here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { virginWorkspace, installPacked, run, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);

test('dreamteamer google-setup and the doctor rows arrive through the extension seam, and write nothing', () => {
	const root = virginWorkspace();
	installPacked(root, ['google-workspace']);
	const compiled = run(root, ['compile']);
	assert.equal(compiled.status, 0, compiled.stderr);
	const before = fs.readdirSync(root).sort().join();

	const inspected = run(root, ['google-setup', 'inspect', '--json']);
	assert.equal(inspected.status, 0, inspected.stderr);
	const result = JSON.parse(inspected.stdout);
	assert.equal(result.module, '@dreamteamer/google-workspace');
	assert.equal(result.checks.find((c) => c.id === 'google.account-authorization').status, 'unverified');

	const planned = JSON.parse(run(root, ['google-setup', 'plan', '--json']).stdout);
	assert.equal(planned.workspace.root, fs.realpathSync(root));

	assert.equal(run(root, ['google-setup', 'frobnicate']).status, 2);

	const doctor = run(root, ['doctor']);
	assert.match(doctor.stdout, /google-workspace — DEGRADED/, 'an unconfigured optional module degrades, it does not fail');
	assert.match(doctor.stdout, /OAuth client configuration/);
	assert.doesNotMatch(doctor.stdout + doctor.stderr, /Account authorization/);
	assert.equal(run(root, ['doctor', '--strict']).status, 0, '--strict keeps its exit code: no row is bad');
	assert.equal(fs.readdirSync(root).sort().join(), before, 'inspect, plan and doctor created nothing in the workspace');
});
