// The packed install: what a consumer gets from npm. rnd is packed, unpacked into a fresh workspace's
// node_modules, compiled with the Northwind records, and the INSTALLED dt-prototype bin vendors into and exports
// for a copy of the synthetic prototype — so a bin with nothing behind it (a lib/ folder left out of `files`)
// fails here, where every other test imports from the source tree.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, installPacked, packedFiles, run, cleanup } from '../../../tests/helpers/workspace.mjs';
import { seedNorthwind, seedJourneys, settle } from './helpers/rnd-workspace.mjs';

after(cleanup);
const FIXTURE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'prototype-northwind');

test('the tarball ships the bin and the whole harness behind it', () => {
	const files = packedFiles('rnd');
	for (const f of ['bin/dt-prototype.mjs', 'bin/migrate-journey-steps.mjs', 'lib/prototype/browser/player.js', 'lib/prototype/browser/harness.css', 'lib/prototype/node/export.mjs', 'lib/prototype/node/play.mjs', 'lib/workspace-root.mjs']) assert.ok(files.includes(f), `${f} is not in the tarball`);
	assert.ok(!files.some((f) => f.startsWith('test/')), 'tests do not ship');
});

test('the installed dt-prototype vendors into a prototype and exports its records', () => {
	const ws = virginWorkspace();
	installPacked(ws, ['rnd']);
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}\n');
	assert.equal(run(ws, ['compile']).status, 0);
	seedNorthwind(ws); seedJourneys(ws); settle(ws);
	const dir = path.join(ws, 'prototypes', 'northwind');
	fs.cpSync(FIXTURE, dir, { recursive: true });
	const bin = path.join(ws, 'node_modules', '@dreamteamer', 'rnd', 'bin', 'dt-prototype.mjs');
	const dt = (...args) => spawnSync(process.execPath, [bin, ...args, '--dir', dir], { encoding: 'utf8', timeout: 60_000 });
	const v = dt('vendor');
	assert.equal(v.status, 0, v.stderr + v.stdout);
	assert.match(v.stdout, /6 written · 0 unchanged · 0 refused/);
	const e = dt('export');
	assert.equal(e.status, 0, e.stderr + e.stdout);
	assert.match(e.stdout, /wrote public\/app\/data\/journeys\.js, public\/app\/data\/meta\.js · 2 journeys · 6 steps/);
	const c = dt('export', '--check');
	assert.equal(c.status, 0, c.stderr + c.stdout);
});
