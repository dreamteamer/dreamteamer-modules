// held-out cr-dt-006-hm2 — WORK_CALENDARS rows with a trailing '|' and an empty column. rnd/tests/cr-dt-006-hm2.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless } from './cr-dt-006-lib.mjs';

after(cleanup);
const envText = (root) => (fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '');
const calendars = (root) => (envText(root).match(/^WORK_CALENDARS=(.*)$/m)?.[1] ?? '');
const GOOD = 'c@example.com|acme|c@example.com';

describe('hm2', { skip: skipUnless('meetings') }, () => {
	let from;
	test('a trailing pipe is refused naming the row and the rule; .env never holds a 4-column row; status is honest', () => {
		from = packedInto(tmp('dtm-from-'), ...closure('meetings'));
		const root = virginWorkspace(), env = cleanEnv();
		const r = dt(root, ['install', '@dreamteamer/meetings', '--from', from, '--input', 'calendar=a@example.com|acme|a@example.com|', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		assert.doesNotMatch(r.stdout, /✔ add-calendar-rows/, 'the write did not happen');
		assert.match(r.stdout, /Row input 1/, `the refusal names the row:\n${r.stdout}`);
		assert.match(r.stdout, /calendar-id \| company-id-or-mixed \| account-email/, 'and the rule');
		assert.ok(!calendars(root).includes('a@example.com|acme|a@example.com|'), `.env holds no 4-column row: ${envText(root)}`);
		assert.ok(!/\|\s*$/m.test(calendars(root)), 'no row ends in a pipe');
		const s = dt(root, ['status'], env);
		assert.doesNotMatch(s.stdout, /meetings\s+ready/, 'never ready over a refused row');
		assert.match(s.stdout, /meetings\s+configured\s+WORK_CALENDARS missing/, `status names what is missing rather than reading configured over a malformed row:\n${s.stdout}`);
	});
	test('an empty column is refused as malformed naming the column; nothing written', () => {
		const root = virginWorkspace(), env = cleanEnv();
		assert.equal(dt(root, ['install', '@dreamteamer/meetings', '--from', from, '--no-input'], env).code, 0);
		const before = envText(root);
		const r = dt(root, ['setup', 'meetings', '--input', 'calendar=b@example.com||b@example.com', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr);
		assert.doesNotMatch(r.stdout, /✔ add-calendar-rows/);
		assert.match(r.stdout, /Row input 1/, r.stdout);
		assert.equal(envText(root), before, 'nothing written');
		assert.match(r.stdout, /column 2|company/i, 'naming column 2 (the company)');
	});
	test('a well-formed row in the same call as a malformed one is still merged, and the other reported', () => {
		const root = virginWorkspace(), env = cleanEnv();
		assert.equal(dt(root, ['install', '@dreamteamer/meetings', '--from', from, '--no-input'], env).code, 0);
		const r = dt(root, ['setup', 'meetings', '--input', `calendar=${GOOD}`, '--input', 'calendar=a@example.com|acme|a@example.com|', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /Row input 2/, 'the malformed row is reported');
		assert.match(calendars(root), /c@example\.com \| acme \| c@example\.com/, `the good row was merged: ${envText(root)}`);
	});
});
