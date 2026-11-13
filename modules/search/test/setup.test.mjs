// The search SETUP UNIT, pure: checks and actions against a fake PATH and temp folders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/search-setup.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-search-')));
const bins = (names) => { const d = tmp(); for (const n of names) fs.writeFileSync(path.join(d, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); return d; };
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'search') });

describe('search: qmd on PATH', () => {
	test('absent → blocked naming it, the install action ready; present → configured, the action done', () => {
		const root = tmp();
		const without = SETUP_UNIT.plan(ctx(root, { PATH: bins([]) }), {});
		assert.equal(without.checks[0].status, 'blocked');
		assert.match(without.checks[0].detail, /qmd is not on PATH/);
		assert.equal(without.actions.find((a) => a.id === 'install-qmd').state, 'ready');
		assert.deepEqual(without.actions[0].effects.map((e) => e.kind).sort(), ['machine', 'network']);
		const withIt = SETUP_UNIT.plan(ctx(root, { PATH: bins(['qmd']) }), {});
		assert.equal(withIt.checks[0].status, 'configured');
		assert.equal(withIt.actions[0].state, 'done');
		assert.deepEqual(SETUP_UNIT.apply(ctx(root, {}), withIt.actions[0]).changed, []);
		assert.equal(SETUP_UNIT.version, 1); assert.deepEqual(SETUP_UNIT.inputs, []);
	});
});
