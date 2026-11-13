// The perspective SETUP UNIT, pure: checks and actions against a fake PATH and temp folders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/perspective-setup.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-perspective-')));
const bins = (names) => { const d = tmp(); for (const n of names) fs.writeFileSync(path.join(d, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); return d; };
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'perspective') });

describe('perspective: ASANA_PAT in .env', () => {
	test('unset → missing (optional: no needs beyond the hint); set-asana_pat writes .env; the value never appears in a check', () => {
		const root = tmp();
		execFileSync('git', ['init', '-q'], { cwd: root });
		fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
		const c = ctx(root, { PATH: process.env.PATH });
		assert.equal(SETUP_UNIT.inspect(c).checks[0].status, 'missing');
		assert.equal(SETUP_UNIT.inputs[0].required, false);
		const p = SETUP_UNIT.plan(c, { asana_pat: 'secret-token-123' });
		assert.equal(p.checks[0].status, 'configured');
		assert.doesNotMatch(JSON.stringify(p), /secret-token-123/);
		assert.equal(SETUP_UNIT.apply(c, p.actions[0], { asana_pat: 'secret-token-123' }).ok, true);
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^ASANA_PAT=/m);
	});
});
