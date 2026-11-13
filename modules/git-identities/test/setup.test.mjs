// The git-identities SETUP UNIT, pure: checks and actions against a fake PATH and temp folders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/git-identities-setup.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-git-identities-')));
const bins = (names) => { const d = tmp(); for (const n of names) fs.writeFileSync(path.join(d, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); return d; };
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'git-identities') });

describe('git-identities: a committer identity in this repository', () => {
	test('no identity → missing naming both; one set → missing naming the other; both → configured; no git → blocked', () => {
		const root = tmp();
		execFileSync('git', ['init', '-q'], { cwd: root });
		const env = { PATH: process.env.PATH, HOME: tmp(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
		const id = () => SETUP_UNIT.inspect(ctx(root, env)).checks.find((c) => c.id === 'git-identities.identity');
		assert.equal(id().status, 'missing'); assert.match(id().detail, /user\.name and user\.email not set/);
		execFileSync('git', ['config', 'user.name', 'Probe'], { cwd: root });
		assert.match(id().detail, /^user\.email not set$/);
		execFileSync('git', ['config', 'user.email', 'probe@example.invalid'], { cwd: root });
		assert.equal(id().status, 'configured');
		assert.doesNotMatch(JSON.stringify(SETUP_UNIT.inspect(ctx(root, env)).checks), /probe@example/, 'values are never shown');
		assert.equal(SETUP_UNIT.inspect(ctx(root, { PATH: bins([]) })).checks[0].status, 'blocked');
		assert.deepEqual(SETUP_UNIT.plan(ctx(root, env), {}).actions, []);
	});
});
