// The files SETUP UNIT, pure: checks and actions against a fake PATH and temp folders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/files-setup.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-files-')));
const bins = (names) => { const d = tmp(); for (const n of names) fs.writeFileSync(path.join(d, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); return d; };
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'files') });

describe('files: FILES_FOLDER in .env, and the folder on disk', () => {
	test('unset → missing; set-files_folder writes .env and is idempotent; set but absent → blocked; present → configured', () => {
		const root = tmp();
		execFileSync('git', ['init', '-q'], { cwd: root });
		fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
		const folder = tmp();
		const c = ctx(root, { PATH: process.env.PATH });
		assert.equal(SETUP_UNIT.inspect(c).checks[0].status, 'missing');
		const p = SETUP_UNIT.plan(c, { files_folder: folder });
		assert.deepEqual(p.needs, []);
		assert.equal(p.checks[0].status, 'configured', 'the plan judges the folder the person named');
		const set = p.actions[0];
		assert.equal(set.state, 'ready'); assert.deepEqual(set.effects.map((e) => e.kind), ['workspace-files']);
		assert.equal(SETUP_UNIT.apply(c, set, { files_folder: folder }).ok, true);
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^FILES_FOLDER=/m);
		const again = SETUP_UNIT.plan(ctx(root, { PATH: process.env.PATH, FILES_FOLDER: folder }), { files_folder: folder }).actions[0];
		assert.equal(again.state, 'done');
		assert.equal(SETUP_UNIT.inspect(ctx(root, { FILES_FOLDER: path.join(folder, 'gone') })).checks[0].status, 'blocked');
		assert.deepEqual(SETUP_UNIT.plan(c, {}).needs, ['files_folder']);
	});
});
