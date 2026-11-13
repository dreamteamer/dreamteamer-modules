// The files SETUP UNIT: pure — its checks, and the env action its plan names (cr-dt-007: the engine writes
// .env, the unit has no apply) — and through the engine under test, where the write actually happens.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_UNIT } from '../lib/files-setup.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets, closure } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-files-')));
const ctx = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'files') });

describe('files: FILES_FOLDER in .env, and the folder on disk', () => {
	test('unset → missing; the plan names one env action and no apply; set but absent → blocked; present → configured', () => {
		const root = tmp();
		const folder = tmp();
		const c = ctx(root, { PATH: process.env.PATH });
		assert.equal(SETUP_UNIT.inspect(c).checks[0].status, 'missing');
		assert.equal(SETUP_UNIT.apply, undefined, 'the engine performs the env action; the unit declares no apply');
		const p = SETUP_UNIT.plan(c, { files_folder: folder });
		assert.deepEqual(p.needs, []);
		assert.equal(p.checks[0].status, 'configured', 'the plan judges the folder the person named');
		assert.deepEqual(p.actions.map((a) => [a.id, a.env]), [['set-files_folder', { FILES_FOLDER: folder }]]);
		assert.equal(SETUP_UNIT.inspect(ctx(root, { FILES_FOLDER: path.join(folder, 'gone') })).checks[0].status, 'blocked');
		assert.equal(SETUP_UNIT.inspect(ctx(root, { FILES_FOLDER: folder })).checks[0].status, 'configured');
		const none = SETUP_UNIT.plan(c, {});
		assert.deepEqual(none.needs, ['files_folder']);
		assert.equal(none.actions[0].state, 'needs-input');
	});
});

describe('through the engine', { skip: !engineMeets('files') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('dt install writes FILES_FOLDER into .env, never prints it; a second run is done; status prints the fix line whole', () => {
		const root = virginWorkspace();
		fs.writeFileSync(path.join(root, '.env'), '');   // the fixture's own keys out of the way: this unit writes FILES_FOLDER
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('files'));
		const folder = tmp();
		const r = run(root, ['install', '@dreamteamer/files', '--from', from, '--input', `files_folder=${folder}`, '--no-input']);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /✔ set-files_folder — wrote \.env \(FILES_FOLDER\)/);
		assert.ok(!(r.stdout + r.stderr).includes(folder), 'the value is never printed');
		assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), `FILES_FOLDER=${folder}\n`);
		const again = run(root, ['setup', 'files', '--input', `files_folder=${folder}`, '--no-input']);
		assert.equal(again.status, 0);
		assert.doesNotMatch(again.stdout, /✔ set-files_folder/);
		fs.writeFileSync(path.join(root, '.env'), '');
		assert.match(run(root, ['status']).stdout, /files\s+configured\s+FILES_FOLDER missing\s+→ dt setup files --input files_folder=<folder>/);
	});
});
