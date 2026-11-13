// core through the engine under test: the composed package carries its origins' setup units (addressed
// by the origin's id, exactly as alone), declares provides, and a module it already provides is refused.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const ROW = 'team@example.invalid | mixed | me@example.invalid';

describe('core, composed', { skip: !engineMeets('core') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('install lists core › meetings; tasks is refused as provided; setup meetings --skip marks only that unit; the unit works as it does alone', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), 'core', 'tasks');
		const r = run(root, ['install', '@dreamteamer/core', '--from', from, '--no-input']);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /— meetings: configured/, 'the meetings unit ran its plan on install');
		const s = run(root, ['status']);
		// one unit in core today reads as `meetings`; with a second (recordings) the line groups as `core › meetings`
		assert.match(s.stdout, /(core › )?meetings\s+configured/);
		const refused = run(root, ['install', '@dreamteamer/tasks', '--from', from]);
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /@dreamteamer\/core already provides @dreamteamer\/tasks/);
		const skip = run(root, ['setup', 'meetings', '--skip']);
		assert.equal(skip.status, 0, skip.stderr);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dreamteamer.setup, { skipped: ['meetings'] });
		assert.match(run(root, ['status']).stdout, /(core › )?meetings\s+skipped/);
		const back = run(root, ['setup', 'meetings', '--input', `calendar=${ROW}`, '--no-input']);
		assert.equal(back.status, 0, back.stderr + back.stdout);
		assert.match(back.stdout, /no longer skipped/);
		assert.match(back.stdout, /✔ add-calendar-rows — wrote \.env/);
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /WORK_CALENDARS=/);
	});
});
