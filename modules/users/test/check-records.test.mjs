// The users guard — agents are users, and every agent has a human babysitter. Carried with the rule
// from the projects module's plan guard, where these assertions were first pinned.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userViolationsOf } from '../bin/check-records.mjs';

const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'check-records.mjs');

describe('users — the agent fold', () => {
	test('an agent with no owner is unsupervised automation — refused', () => {
		assert.equal(userViolationsOf('helper', { name: 'helper', kind: 'agent' }).length, 1);
		assert.deepEqual(userViolationsOf('helper', { name: 'helper', kind: 'agent', human_owner: 'users/dana-oren' },
			new Map([['dana-oren', { kind: 'human' }]])), []);
	});
	test('an agent owned by an agent is a loop with nobody at the end — refused', () => {
		const v = userViolationsOf('helper', { name: 'helper', kind: 'agent', human_owner: 'users/other-bot' },
			new Map([['other-bot', { kind: 'agent' }]]));
		assert.equal(v.length, 1);
	});
	test('a human carrying agent-only fields is a modelling mistake', () => {
		assert.equal(userViolationsOf('dana-oren', { name: 'Dana', human_owner: 'users/x' }).length, 1);
		assert.equal(userViolationsOf('dana-oren', { name: 'Dana', agent: 'agents/helper' }).length, 1);
	});
	test('as a script: exit 1 and a named violation on a bad workspace, exit 0 on a good one', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'users-guard-'));
		try {
			const dir = path.join(tmp, 'data', 'users');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'dana-oren.user.md'), '---\nname: Dana Oren\n---\n');
			let r = spawnSync(process.execPath, [BIN], { cwd: tmp, encoding: 'utf8', timeout: 20_000 });
			assert.equal(r.status, 0, r.stderr);
			assert.match(r.stdout, /1 checked, 0 violations/);
			fs.writeFileSync(path.join(dir, 'helper.user.md'), '---\nname: helper\nkind: agent\n---\n');
			r = spawnSync(process.execPath, [BIN], { cwd: tmp, encoding: 'utf8', timeout: 20_000 });
			assert.equal(r.status, 1);
			assert.match(r.stderr, /helper: `kind: agent` needs `human_owner`/);
		} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
	});
});
