// The perspective SETUP UNIT: pure — its check, and the env action its plan names (cr-dt-007: the engine
// writes .env, the unit has no apply) — and through the engine under test, where the write happens.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_UNIT } from '../lib/perspective-setup.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets, closure } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-perspective-')));
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'perspective') });

describe('perspective: ASANA_PAT in .env', () => {
	test('unset → missing (optional); the plan names one env action and no apply; the value never appears in a check', () => {
		const root = tmp();
		const c = ctx(root, { PATH: process.env.PATH });
		assert.equal(SETUP_UNIT.inspect(c).checks[0].status, 'missing');
		assert.equal(SETUP_UNIT.inputs[0].required, false);
		assert.equal(SETUP_UNIT.apply, undefined);
		const p = SETUP_UNIT.plan(c, { asana_pat: 'secret-token-123' });
		assert.equal(p.checks[0].status, 'configured');
		assert.doesNotMatch(JSON.stringify(p.checks), /secret-token-123/);
		assert.deepEqual(p.actions.map((a) => [a.id, Object.keys(a.env)]), [['set-asana_pat', ['ASANA_PAT']]]);
		assert.equal(SETUP_UNIT.plan(c, {}).actions[0].state, 'needs-input');
	});
});

describe('through the engine', { skip: !engineMeets('perspective') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('dt setup writes ASANA_PAT into .env and never prints it, --json included; the fix line prints whole', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('perspective'));
		const i = run(root, ['install', '@dreamteamer/perspective', '--from', from, '--no-input']);
		assert.equal(i.status, 0, i.stderr + i.stdout);
		assert.match(run(root, ['status']).stdout, /perspective\s+configured\s+ASANA_PAT missing\s+→ dt setup perspective --input asana_pat=<token>/);
		const SECRET = 'pat-value-never-printed-42';
		const r = run(root, ['setup', 'perspective', '--input', `asana_pat=${SECRET}`, '--json']);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(!(r.stdout + r.stderr).includes(SECRET), 'never printed');
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), new RegExp(`^ASANA_PAT=${SECRET}$`, 'm'));
	});
});
