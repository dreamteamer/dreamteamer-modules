// The calendar setup on synthetic fixtures: no account, no network, no credential contents. These tests
// pin local behaviour — what inspect says, and the WORK_CALENDARS value the plan's env action names (the
// merge is the unit's) — and, through the engine under test, that the engine's write is scoped and
// idempotent. The write's own refusals (git exposure, temp files, symlinks, a concurrent edit) are the
// engine's and are tested there (cr-dt-007, D61). Nothing here proves Google consent or calendar access.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inspect, plan, parseRow, SETUP_UNIT } from '../lib/meetings-setup.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets, closure } from '../../../tests/helpers/workspace.mjs';

/** Git with this machine's global and system configuration kept out, so fixtures behave the same anywhere. */
const ISOLATED = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
const git = (cwd, ...args) => { const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', env: ISOLATED }); assert.equal(r.status, 0, r.stderr); };
const gitInit = (root) => git(root, 'init', '-q');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); cleanup(); });
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); made.push(d); return d; };
const ROW = 'team@northwind.example | northwind | dana@northwind.example';
const ROW2 = 'board@harbor.example | harbor-mutual | sam@harbor.example';

/** A workspace with a .gitignore ignoring .env, and a separate synthetic home for the reader's defaults. */
function workspace({ env, gitignore = 'node_modules/\n.env\n' } = {}) {
	const base = tmp('meetings-setup-');
	const root = path.join(base, 'workspace'); fs.mkdirSync(root);
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'northwind-workspace' }));
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
	if (gitignore !== null) fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
	if (env !== undefined) fs.writeFileSync(path.join(root, '.env'), env);
	const home = path.join(base, 'home'); fs.mkdirSync(home);
	return { base, root, home, envFile: path.join(root, '.env') };
}
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));
const rowsAction = (p) => p.actions.find((a) => a.id === 'add-calendar-rows');
/** Credentials and an OAuth client at the reader's default locations under the synthetic home. */
function credentials(home, accounts) {
	const dir = path.join(home, '.config', 'google-workspace-mcp', 'credentials'); fs.mkdirSync(dir, { recursive: true });
	for (const a of accounts) fs.writeFileSync(path.join(dir, `${encodeURIComponent(a).replace(/%40/g, '@')}.json`), '{"synthetic":true}');
	const client = path.join(home, '.config', 'google-calendar-mcp'); fs.mkdirSync(client, { recursive: true });
	fs.writeFileSync(path.join(client, 'gcp-oauth.keys.json'), '{"installed":{}}');
}

function readOnly(fn) {
	const calls = [];
	const targets = [
		...['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'chmodSync', 'copyFileSync', 'symlinkSync', 'mkdtempSync', 'writeSync'].map((k) => [fs, k]),
		[net, 'connect'], [net, 'createConnection'], [http, 'request'], [https, 'request'],
		...['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((k) => [cp, k]),
		[globalThis, 'fetch'],
	];
	const saved = targets.map(([o, k]) => [o, k, o[k]]);
	const openSync = fs.openSync;
	for (const [o, k] of targets) o[k] = () => { calls.push(k); throw new Error(`forbidden: ${k}`); };
	fs.openSync = (p, flags, ...rest) => { if (flags && !/^r$|^rs?\+?$/.test(String(flags)) && flags !== 0) { calls.push('openSync:' + flags); throw new Error('forbidden open'); } return openSync(p, flags, ...rest); };
	syncBuiltinESMExports();
	try { return { result: fn(), calls }; } catch (error) { return { error, calls }; } finally { for (const [o, k, v] of saved) o[k] = v; fs.openSync = openSync; syncBuiltinESMExports(); }
}

describe('inspect', () => {
	test('nothing configured: rows missing, credentials blocked on them, access unverified', () => {
		const w = workspace();
		const c = byId(inspect({ root: w.root, env: {}, home: w.home }).checks);
		assert.equal(c['meetings.work-calendars'].status, 'missing');
		assert.equal(c['meetings.work-calendars'].state, 'warn');
		assert.equal(c['meetings.credential-files'].status, 'blocked');
		assert.equal(c['meetings.oauth-client'].status, 'missing');
		assert.equal(c['meetings.account-access'].status, 'unverified');
		for (const r of Object.values(c)) assert.notEqual(r.state, 'bad', 'calendar sync is optional');
	});
	test('a quoted multi-line .env value with credentials present is configured — and still unverified', () => {
		const w = workspace({ env: `OTHER=1\nWORK_CALENDARS="${ROW}\n# a comment row\n${ROW2}"\n` });
		credentials(w.home, ['dana@northwind.example', 'sam@harbor.example']);
		const c = byId(inspect({ root: w.root, env: {}, home: w.home }).checks);
		assert.equal(c['meetings.work-calendars'].status, 'configured');
		assert.deepEqual(c['meetings.work-calendars'].evidence, { source: '.env', rows: 2 });
		assert.equal(c['meetings.credential-files'].status, 'configured');
		assert.equal(c['meetings.oauth-client'].status, 'configured');
		assert.equal(c['meetings.account-access'].state, 'warn', 'file presence is never access');
	});
	test('a nonempty process value wins over .env, as the calendar reader reads it', () => {
		const w = workspace({ env: 'WORK_CALENDARS="broken"\n' });
		const c = byId(inspect({ root: w.root, env: { WORK_CALENDARS: ROW }, home: w.home }).checks);
		assert.equal(c['meetings.work-calendars'].evidence.source, 'environment');
		assert.equal(c['meetings.work-calendars'].status, 'configured');
	});
	test('a credential is looked for under the reader\'s encoded name, and one missing account is missing', () => {
		const w = workspace({ env: `WORK_CALENDARS="${ROW}\nteam@northwind.example | northwind | dana+notes@northwind.example"\n` });
		credentials(w.home, ['dana@northwind.example']);
		assert.equal(byId(inspect({ root: w.root, env: {}, home: w.home }).checks)['meetings.credential-files'].status, 'missing');
		credentials(w.home, ['dana+notes@northwind.example']);
		assert.ok(fs.existsSync(path.join(w.home, '.config/google-workspace-mcp/credentials/dana%2Bnotes@northwind.example.json')));
		assert.equal(byId(inspect({ root: w.root, env: {}, home: w.home }).checks)['meetings.credential-files'].status, 'configured');
	});
	test('a malformed row is reported by line number and carries no value', () => {
		const w = workspace({ env: `WORK_CALENDARS="${ROW}\nsecret-calendar | northwind | not-an-address"\n` });
		const row = byId(inspect({ root: w.root, env: {}, home: w.home }).checks)['meetings.work-calendars'];
		assert.equal(row.status, 'missing');
		assert.deepEqual(row.evidence.malformedLines, [2]);
		const text = JSON.stringify(inspect({ root: w.root, env: {}, home: w.home }));
		for (const leak of ['secret-calendar', 'not-an-address', 'dana@', 'team@', w.base]) assert.ok(!text.includes(leak), leak);
	});
	test('inspect and plan start nothing and write nothing — not even read-only Git', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		credentials(w.home, ['dana@northwind.example']);
		const before = fs.readFileSync(w.envFile, 'utf8');
		const a = readOnly(() => inspect({ root: w.root, env: {}, home: w.home }));
		const b = readOnly(() => plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		const c = readOnly(() => plan({ root: w.root, env: {}, home: w.home }));
		assert.deepEqual([...a.calls, ...b.calls, ...c.calls], []);
		assert.deepEqual([a.error, b.error, c.error], [undefined, undefined, undefined]);
		assert.equal(rowsAction(b.result).state, 'ready');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), before);
	});
});

describe('add-calendar-rows — the value the env action names', () => {
	const value = (p) => rowsAction(p).env?.WORK_CALENDARS;
	test('fills a blank key; a second plan with the rows already present is done', () => {
		const w = workspace({ env: '# ── dreamteamer modules ──\nFILES_FOLDER=\nWORK_CALENDARS=\nUNKNOWN_KEY=kept\n' });
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.state, 'ready');
		assert.deepEqual(step.effects, [{ kind: 'workspace-files', detail: '.env (WORK_CALENDARS only; every other line is kept byte for byte)' }]);
		assert.deepEqual(step.env, { WORK_CALENDARS: ROW });
		assert.equal(step.preview.adds, 1);
		assert.ok(!JSON.stringify({ ...step, env: undefined }).includes('dana@'), 'nothing but env carries a row');
		const v = workspace({ env: `WORK_CALENDARS="${ROW}"\n` });
		const again = rowsAction(plan({ root: v.root, env: {}, home: v.home, rows: [ROW] }));
		assert.equal(again.state, 'done');
		assert.deepEqual(again.env, { WORK_CALENDARS: ROW }, 'the engine sees the file already holds it');
	});
	test('appends to existing rows; a row already present is not added again', () => {
		const w = workspace({ env: `# private\nA=1\nWORK_CALENDARS="${ROW}\n# kept comment"\n\nZ='two words'  # trailing\n` });
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW, ROW2] }));
		assert.equal(step.preview.keeps, 1);
		assert.equal(step.preview.adds, 1);
		assert.equal(value(plan({ root: w.root, env: {}, home: w.home, rows: [ROW, ROW2] })), `${ROW}\n# kept comment\n${ROW2}`);
	});
	test('no .env yet: the value is the rows alone', () => {
		const w = workspace();
		assert.equal(value(plan({ root: w.root, env: {}, home: w.home, rows: [ROW, ROW2] })), `${ROW}\n${ROW2}`);
	});
	test('a mixed batch adds the valid rows and names the malformed ones by input number', () => {
		const w = workspace({ env: 'A=1\n' });
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW, 'not | a row', ROW2] }));
		assert.equal(step.state, 'ready');
		assert.deepEqual(step.preview.skipped, [2]);
		assert.equal(step.env.WORK_CALENDARS, `${ROW}\n${ROW2}`);
	});
	test('refuses, naming why: a company conflict, a doubled key, a malformed existing row, a shadowing process value', () => {
		const cases = [
			[`WORK_CALENDARS="${ROW}"\n`, {}, [ROW.replace('northwind |', 'harbor-mutual |')], /different default company/],
			[`WORK_CALENDARS="${ROW}"\nWORK_CALENDARS=""\n`, {}, [ROW2], /more than once/],
			['WORK_CALENDARS="a | b"\n', {}, [ROW2], /malformed line\(s\) 1/],
			['WORK_CALENDARS=\n', { WORK_CALENDARS: ROW }, [ROW2], /process environment/],
		];
		for (const [text, env, rows, reason] of cases) {
			const w = workspace({ env: text });
			const step = rowsAction(plan({ root: w.root, env, home: w.home, rows }));
			assert.equal(step.state, 'blocked', text);
			assert.match(step.reason, reason);
			assert.equal(step.env, undefined, 'a refused action names nothing to write');
		}
	});
	test('refuses injection-shaped rows before anything else', () => {
		for (const bad of ['cal"; touch x | northwind | dana@northwind.example', '$(id) | northwind | dana@northwind.example', 'team | `id` | dana@northwind.example', `team | northwind | dana@northwind.example\nB=1`, 'team | northwind', 'team | north wind | dana@northwind.example', 'team | northwind | dana@northwind.example | extra', 'team | Northwind | dana@northwind.example', "team | northwind | dana'@northwind.example"]) {
			assert.equal(parseRow(bad), null, bad);
			const w = workspace({ env: 'A=1\n' });
			const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [bad] }));
			assert.equal(step.state, 'blocked', bad);
			assert.ok(!step.reason.includes('dana@'), 'a refused value is not echoed');
		}
		assert.deepEqual(parseRow(` ${ROW} `), { calendar: 'team@northwind.example', company: 'northwind', account: 'dana@northwind.example', line: ROW });
		assert.equal(parseRow('en.usa#holiday@group.v.calendar.google.example | mixed | dana@northwind.example').company, 'mixed');
	});
});

describe('the live step', () => {
	test('verify-calendar-access is the owner\'s, names its effects, and waits for every local prerequisite', () => {
		const w = workspace({ env: `WORK_CALENDARS="${ROW}"\n` });
		const blocked = plan({ root: w.root, env: {}, home: w.home }).actions.find((a) => a.id === 'verify-calendar-access');
		assert.equal(blocked.state, 'blocked');
		assert.match(blocked.reason, /meetings\.credential-files/);
		credentials(w.home, ['dana@northwind.example']);
		const ready = plan({ root: w.root, env: {}, home: w.home }).actions.find((a) => a.id === 'verify-calendar-access');
		assert.equal(ready.state, 'ready');
		assert.equal(ready.kind, 'live'); assert.equal(ready.runBy, 'owner');
		assert.ok(ready.effects.some((e) => e.startsWith('network')) && ready.effects.some((e) => e.startsWith('account-access')));
		assert.deepEqual(ready.command, ['node', '.dreamteamer/skills/fetching-meetings/bin/gcal.mjs', 'access']);
	});
});


describe('through the engine', { skip: !engineMeets('meetings') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('the engine writes the rows, keeps every other byte, never prints them, and a second run writes nothing', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('meetings'));
		const head = `# private\nA=1\nWORK_CALENDARS="${ROW}\n# kept comment"\n`;
		const tail = `\nZ='two words'  # trailing\n`;
		fs.writeFileSync(path.join(root, '.env'), head + tail);
		const env = { HOME: tmp('meetings-home-') };
		const i = run(root, ['install', '@dreamteamer/meetings', '--from', from, '--input', `calendar=${ROW2}`, '--no-input'], env);
		assert.equal(i.status, 0, i.stderr + i.stdout);
		assert.match(i.stdout, /✔ add-calendar-rows — wrote \.env \(WORK_CALENDARS\)/);
		assert.ok(!(i.stdout + i.stderr).includes('board@harbor.example'), 'the rows are never printed');
		assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), `# private\nA=1\nWORK_CALENDARS="${ROW}\n# kept comment\n${ROW2}"\n${tail}`);
		const again = run(root, ['setup', 'meetings', '--input', `calendar=${ROW2}`, '--no-input'], env);
		assert.equal(again.status, 0);
		assert.doesNotMatch(again.stdout, /✔ add-calendar-rows/);
	});
	test('an existing value a shell would read differently ($HOME) is refused, changing nothing', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('meetings'));
		const before = 'WORK_CALENDARS=\'$HOME | x | y\'\n';
		fs.writeFileSync(path.join(root, '.env'), before);
		const r = run(root, ['install', '@dreamteamer/meetings', '--from', from, '--input', `calendar=${ROW2}`, '--no-input'], { HOME: tmp('meetings-home-') });
		assert.ok([0, 3].includes(r.status), r.stderr + r.stdout);
		assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), before);
	});
});

test('SETUP.md is shipped and names every action and status this provider has', () => {
	const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('SETUP.md') && pkg.files.includes('lib'));
	assert.equal(pkg.dreamteamer.extension, './lib/extension.mjs', 'the setup unit rides on the module\'s own extension entry');
	const text = fs.readFileSync(new URL('../SETUP.md', import.meta.url), 'utf8');
	for (const id of ['add-calendar-rows', 'verify-calendar-access']) assert.match(text, new RegExp(`\\b${id}\\b`));
	assert.doesNotMatch(text, /dt-setup|bin\/setup\.mjs/, 'the dt-setup-era script and board are gone (D70)');
	for (const word of ['configured', 'unverified', 'blocked', 'skipped', 'ready']) assert.match(text, new RegExp(word));
});
