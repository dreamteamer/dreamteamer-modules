// The meetings SETUP UNIT — the engine's view of this module. Pure half against a temp git repo
// (the module asks git whether .env is ignored); engine half through `dt install` on the engine
// under test, into a virgin workspace, offline.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SETUP_UNIT, calendarsDigest } from '../lib/meetings-setup.mjs';
import { parseWorkCalendars } from '../skills/fetching-meetings/bin/gcal.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets, closure } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const ROW = 'team@example.invalid | mixed | me@example.invalid';
function repo() {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-meet-')));
	execFileSync('git', ['init', '-q'], { cwd: root });
	fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'probe', private: true }));
	return root;
}
const ctxFor = (root, env = {}) => ({ root, env: { PATH: process.env.PATH, HOME: root, ...env }, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'meetings') });

describe('the unit, pure', () => {
	test('one rows input on WORK_CALENDARS, optional; version 1', () => {
		assert.equal(SETUP_UNIT.id, 'meetings');
		assert.deepEqual(SETUP_UNIT.inputs.map((i) => [i.id, i.kind, i.env, i.required, i.rows.columns.length]), [['calendar', 'rows', 'WORK_CALENDARS', false, 3]]);
	});
	test('plan: no rows → needs calendar and the write waits for input; rows → a workspace-files action with the .env fingerprint; apply merges, keeps other lines, is idempotent', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), 'OTHER=keep\n');
		const ctx = ctxFor(root);
		const empty = SETUP_UNIT.plan(ctx, {});
		assert.deepEqual(empty.needs, ['calendar']);
		assert.equal(empty.actions.find((a) => a.id === 'add-calendar-rows').state, 'needs-input');
		const p = SETUP_UNIT.plan(ctx, { calendar: [ROW] });
		const add = p.actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(add.state, 'ready');
		assert.deepEqual(add.effects.map((e) => e.kind), ['workspace-files']);
		assert.ok(add.expect && add.expect === add.preview.expect, 'bound to the .env fingerprint');
		assert.equal(add.content, undefined, 'the merged text is not carried on the action');
		const verify = p.actions.find((a) => a.id === 'verify-calendar-access');
		assert.equal(verify.kind, 'verify'); assert.equal(verify.runBy, 'owner');
		assert.ok(verify.effects.some((e) => e.kind === 'account'));
		const r = SETUP_UNIT.apply(ctx, add, { calendar: [ROW] });
		assert.equal(r.ok, true, r.message);
		assert.deepEqual(r.changed, ['.env']);
		const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
		assert.match(text, /^OTHER=keep$/m);
		assert.match(text, /WORK_CALENDARS=/);
		assert.ok(text.includes(ROW));
		// again: the plan says done, apply does nothing
		const again = SETUP_UNIT.plan(ctx, { calendar: [ROW] }).actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(again.state, 'done');
		assert.deepEqual(SETUP_UNIT.apply(ctx, again, { calendar: [ROW] }).changed, []);
		// a stale fingerprint is refused, nothing written
		fs.appendFileSync(path.join(root, '.env'), 'LATER=1\n');
		// a NEW row (so the step is not already done) under a stale fingerprint: refused, nothing written
		const fresh = SETUP_UNIT.plan(ctx, { calendar: ['x@example.invalid | mixed | me@example.invalid'] }).actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(fresh.state, 'ready');
		const stale = SETUP_UNIT.apply(ctx, { ...fresh, expect: 'nope', preview: { ...fresh.preview, expect: 'nope' } }, {});
		assert.equal(stale.ok, false);
		assert.match(stale.message, /changed after the preview/);
	});
	test('inspect: configured rows, access unverified until a receipt exists', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS=${ROW}\n`);
		const ctx = ctxFor(root);
		const checks = SETUP_UNIT.inspect(ctx).checks;
		assert.equal(checks.find((c) => c.id === 'meetings.work-calendars').status, 'configured');
		assert.equal(checks.find((c) => c.id === 'meetings.account-access').status, 'unverified');
		fs.mkdirSync(ctx.receiptDir, { recursive: true });
		fs.writeFileSync(path.join(ctx.receiptDir, 'calendar-access.verified.json'), JSON.stringify({ rows: 1, digest: calendarsDigest(parseWorkCalendars(ROW).rows), at: '2026-11-13' }));
		const after = SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'meetings.account-access');
		assert.equal(after.status, 'ready'); assert.equal(after.evidence.at, '2026-11-13');
	});
	test('a mixed batch: the valid rows are merged and the malformed ones are named by input number — never the whole batch refused (hm2)', () => {
		const root = repo();
		const ctx = ctxFor(root);
		const good = 'ok@example.invalid | mixed | me@example.invalid';
		const p = SETUP_UNIT.plan(ctx, { calendar: [good, 'this is not a row'] });
		const add = p.actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(add.state, 'ready', add.reason);
		assert.deepEqual(add.preview.skipped, [2]);
		const r = SETUP_UNIT.apply(ctx, add, { calendar: [good, 'this is not a row'] });
		assert.equal(r.ok, true, r.message);
		assert.match(r.message, /1 row\(s\) added.*row input 2 skipped/);
		assert.ok(fs.readFileSync(path.join(root, '.env'), 'utf8').includes(good));
		// every row malformed is still a refusal
		const none = SETUP_UNIT.plan(ctx, { calendar: ['nope', 'also nope'] }).actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(none.state, 'blocked'); assert.match(none.reason, /Row input 1, 2/);
	});
	test('verify-calendar-access writes the receipt only when EVERY row answers full; absent or free-busy rows fail it with counts (never a false ready)', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS=${ROW}\n`);
		const ctx = ctxFor(root);
		const fake = (rows) => ['node', '-e', `process.stdout.write(JSON.stringify(${JSON.stringify({ rows, unlisted: [] })}))`];
		const action = { id: 'verify-calendar-access', command: fake([{ calendar: 'team@example.invalid', account: 'me@example.invalid', verdict: 'absent' }]) };
		const bad = SETUP_UNIT.apply(ctx, action, {});
		assert.equal(bad.ok, false); assert.match(bad.message, /1 of 1 calendar\(s\) not readable \(absent: 1\)/);
		assert.ok(!fs.existsSync(path.join(ctx.receiptDir, 'calendar-access.verified.json')), 'no receipt');
		const ok = SETUP_UNIT.apply(ctx, { ...action, command: fake([{ calendar: 'team@example.invalid', account: 'me@example.invalid', verdict: 'full' }]) }, {});
		assert.equal(ok.ok, true, ok.message);
		assert.ok(fs.existsSync(path.join(ctx.receiptDir, 'calendar-access.verified.json')));
		assert.equal(SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'meetings.account-access').status, 'ready');
	});
	test('a receipt that cannot be written is a structured failure, never a ReferenceError (redact is imported)', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS=${ROW}\n`);
		const ctx = ctxFor(root);
		fs.mkdirSync(path.dirname(ctx.receiptDir), { recursive: true }); fs.writeFileSync(ctx.receiptDir, 'a file where the folder should be');
		const r = SETUP_UNIT.apply(ctx, { id: 'verify-calendar-access', command: ['node', '-e', `process.stdout.write(JSON.stringify({ rows: [{ verdict: 'full' }], unlisted: [] }))`] }, {});
		assert.equal(r.ok, false); assert.match(r.message, /ENOTDIR|not a directory|EEXIST/i); assert.doesNotMatch(r.message, /ReferenceError|redact is not defined/);
	});
	test('the engine lays .env under the process env: a WORK_CALENDARS equal to .env\'s does not block a second row; a different process value still does', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS=${ROW}\n`);
		const row2 = 'two@example.invalid | mixed | me@example.invalid';
		const merged = ctxFor(root, { WORK_CALENDARS: ROW });   // what the engine hands a unit after the first install
		const add = SETUP_UNIT.plan(merged, { calendar: [row2] }).actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(add.state, 'ready', add.reason);
		const r = SETUP_UNIT.apply(merged, add, { calendar: [row2] });
		assert.equal(r.ok, true, r.message);
		assert.ok(fs.readFileSync(path.join(root, '.env'), 'utf8').includes(row2), 'the second row landed in .env');
		assert.equal(SETUP_UNIT.inspect(ctxFor(root, { WORK_CALENDARS: `${ROW}\n${row2}` })).checks.find((c) => c.id === 'meetings.work-calendars').evidence.rows, 2);
		const shadow = ctxFor(root, { WORK_CALENDARS: 'other@example.invalid | mixed | me@example.invalid' });
		const blocked = SETUP_UNIT.plan(shadow, { calendar: ['three@example.invalid | mixed | me@example.invalid'] }).actions.find((a) => a.id === 'add-calendar-rows');
		assert.equal(blocked.state, 'blocked'); assert.match(blocked.reason, /process environment/);
	});
	test('a receipt counts only for the calendars it proved: a row added since makes access unverified again, naming the date', () => {
		const root = repo();
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS=${ROW}\n`);
		const ctx = ctxFor(root);
		fs.mkdirSync(ctx.receiptDir, { recursive: true });
		fs.writeFileSync(path.join(ctx.receiptDir, 'calendar-access.verified.json'), JSON.stringify({ rows: 1, digest: calendarsDigest(parseWorkCalendars(ROW).rows), at: '2026-11-01' }));
		assert.equal(SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'meetings.account-access').status, 'ready');
		fs.writeFileSync(path.join(root, '.env'), `WORK_CALENDARS="${ROW}\ntwo@example.invalid | mixed | me@example.invalid"\n`);
		const after = SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'meetings.account-access');
		assert.equal(after.status, 'unverified'); assert.match(after.detail, /changed since.*2026-11-01/);
		assert.ok(!JSON.stringify(after).includes('example.invalid'), 'no address in the row');
	});
});

describe('through the engine', { skip: !engineMeets('meetings') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('dt install merges the row into .env, commits nothing of .env, is idempotent; status reads configured with access unverified', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('meetings'));
		const r = run(root, ['install', '@dreamteamer/meetings', '--from', from, '--input', `calendar=${ROW}`, '--no-input']);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /✔ add-calendar-rows — wrote \.env/);
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), new RegExp(`WORK_CALENDARS=.*${ROW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
		const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
		assert.ok(!files.includes('.env'), '.env is never committed');
		assert.ok(files.includes('package.json'));
		const before = fs.readFileSync(path.join(root, '.env'), 'utf8');
		const again = run(root, ['setup', 'meetings', '--input', `calendar=${ROW}`, '--no-input']);
		assert.equal(again.status, 0, again.stderr);
		assert.doesNotMatch(again.stdout, /wrote \.env/);
		assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), before);
		const s = run(root, ['status']);
		assert.match(s.stdout, /meetings\s+configured/);
		assert.match(s.stdout, /account access unverified/);
		// a second calendar, later, through the same verb: added, not blocked by the row the engine merged from .env
		const row2 = 'two@example.invalid | mixed | me@example.invalid';
		const second = run(root, ['setup', 'meetings', '--input', `calendar=${row2}`, '--no-input']);
		assert.equal(second.status, 0, second.stderr + second.stdout);
		assert.match(second.stdout, /✔ add-calendar-rows — wrote \.env \(1 row\(s\) added/);
		const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
		assert.ok(env.includes(ROW) && env.includes(row2), 'both rows in .env');
	});
});
