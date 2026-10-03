// gcal.mjs: the WORK_CALENDARS reader (`rows`) and the access join (`access`). The parser and the
// join are pure and pinned here on synthetic calendar ids; `rows` is also run end to end from the
// compiled skill folder of a real workspace, reading a quoted multi-line value out of its `.env`
// through the engine's own .env parser. `access`, `calendars` and `events` call Google, so only their
// pure halves are tested here.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseWorkCalendars, classifyAccess } from '../../skills/fetching-meetings/bin/gcal.mjs';
import { virginWorkspace, installPacked, closure, compileAndCheck, cleanup } from '../../../../tests/helpers/workspace.mjs';

after(cleanup);

const FIXTURE = [
	'# calendar-id | default-company | account-email',
	'team@northwind.example | northwind | dana.o@northwind.example',
	'',
	'  c_8f2a@group.calendar.example | mixed | dana.o@bright.example  ',
	'claims@harbor-mutual.example | companies/harbor-mutual | sam.d@harbor-mutual.example',
].join('\n');

describe('parseWorkCalendars', () => {
	test('one row per non-blank, non-comment line; the company passes through as written; mixed has none', () => {
		const { rows, errors } = parseWorkCalendars(FIXTURE);
		assert.deepEqual(errors, []);
		assert.deepEqual(rows, [
			{ calendar: 'team@northwind.example', company: 'northwind', mixed: false, account: 'dana.o@northwind.example' },
			{ calendar: 'c_8f2a@group.calendar.example', company: null, mixed: true, account: 'dana.o@bright.example' },
			{ calendar: 'claims@harbor-mutual.example', company: 'companies/harbor-mutual', mixed: false, account: 'sam.d@harbor-mutual.example' },
		]);
	});

	test('a malformed row is an error naming its line, and is not returned', () => {
		const { rows, errors } = parseWorkCalendars([
			'team@northwind.example | northwind',
			'team@northwind.example | northwind | not-an-email',
			'team@northwind.example |  | dana.o@northwind.example',
			'team@northwind.example | northwind | dana.o@northwind.example',
			'team@northwind.example | northwind | dana.o@northwind.example',
		].join('\n'));
		assert.equal(rows.length, 1);
		assert.equal(errors.length, 4);
		assert.match(errors[0], /line 1: 2 column/);
		assert.match(errors[1], /line 2: account "not-an-email" is not an email/);
		assert.match(errors[2], /line 3: no default company/);
		assert.match(errors[3], /line 5: .* already read by/);
	});

	test('an empty value has no rows and no errors', () => {
		assert.deepEqual(parseWorkCalendars(''), { rows: [], errors: [] });
		assert.deepEqual(parseWorkCalendars(undefined), { rows: [], errors: [] });
	});
});

describe('classifyAccess', () => {
	const { rows } = parseWorkCalendars(FIXTURE);
	const calendars = {
		'dana.o@northwind.example': [
			{ id: 'team@northwind.example', summary: 'Team', accessRole: 'writer' },
			{ id: 'dana.o@northwind.example', summary: 'Dana Oren', accessRole: 'owner' },
			{ id: 'holidays@calendar.example', summary: 'Holidays', accessRole: 'reader' },
		],
		'dana.o@bright.example': [{ id: 'c_8f2a@group.calendar.example', summary: 'Clients', accessRole: 'freeBusyReader' }],
		'sam.d@harbor-mutual.example': [],
	};
	const result = classifyAccess(rows, calendars);

	test('full at owner/writer/reader, free-busy at freeBusyReader, absent when the account does not list it', () => {
		assert.deepEqual(result.rows.map((r) => [r.calendar, r.accessRole, r.verdict]), [
			['team@northwind.example', 'writer', 'full'],
			['c_8f2a@group.calendar.example', 'freeBusyReader', 'free-busy'],
			['claims@harbor-mutual.example', null, 'absent'],
		]);
	});

	test('unlisted is every calendar an account can write that no row names — never a read-only feed', () => {
		assert.deepEqual(result.unlisted, [
			{ account: 'dana.o@northwind.example', id: 'dana.o@northwind.example', summary: 'Dana Oren', accessRole: 'owner' },
		]);
	});
});

describe('gcal.mjs rows, from the compiled skill folder', () => {
	const root = virginWorkspace();
	installPacked(root, [...closure('meetings')]);
	compileAndCheck(root);
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
	const script = path.join(root, '.dreamteamer', 'skills', 'fetching-meetings', 'bin', 'gcal.mjs');
	const env = { ...process.env };
	delete env.WORK_CALENDARS;
	const rowsOf = (extraEnv = {}) => spawnSync(process.execPath, [script, 'rows'], { cwd: root, encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 60_000 });

	test('reads a quoted multi-line WORK_CALENDARS out of .env and prints the rows as JSON', () => {
		fs.appendFileSync(path.join(root, '.env'), `WORK_CALENDARS="${FIXTURE}"\n`);
		const r = rowsOf();
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(JSON.parse(r.stdout), parseWorkCalendars(FIXTURE).rows);
	});

	test('the process environment wins over .env', () => {
		const r = rowsOf({ WORK_CALENDARS: 'team@northwind.example | northwind | dana.o@northwind.example' });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(JSON.parse(r.stdout).length, 1);
	});

	test('a malformed row exits 1 naming the line, and prints no JSON', () => {
		const r = rowsOf({ WORK_CALENDARS: 'team@northwind.example | northwind' });
		assert.equal(r.status, 1);
		assert.equal(r.stdout, '');
		assert.match(r.stderr, /WORK_CALENDARS line 1: 2 column/);
	});
});
