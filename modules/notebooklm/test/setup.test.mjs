// The notebooklm SETUP UNIT, pure: checks and actions against a fake PATH and temp folders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/notebooklm-setup.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-notebooklm-')));
const bins = (names) => { const d = tmp(); for (const n of names) fs.writeFileSync(path.join(d, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); return d; };
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'notebooklm') });

describe('notebooklm: the vendor CLI, and a login nothing local proves', () => {
	test('CLI absent → blocked; present → configured; the login is always unverified here; no action', () => {
		const root = tmp();
		const without = SETUP_UNIT.inspect(ctx(root, { PATH: bins([]) })).checks;
		assert.equal(without.find((c) => c.id === 'notebooklm.cli').status, 'blocked');
		const withIt = SETUP_UNIT.inspect(ctx(root, { PATH: bins(['notebooklm']) })).checks;
		assert.equal(withIt.find((c) => c.id === 'notebooklm.cli').status, 'configured');
		assert.equal(withIt.find((c) => c.id === 'notebooklm.login').status, 'unverified');
		assert.deepEqual(SETUP_UNIT.plan(ctx(root, {}), {}).actions, []);
	});
});
