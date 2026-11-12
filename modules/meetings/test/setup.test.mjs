// The calendar setup provider on synthetic fixtures: no account, no network, no credential contents.
// These tests pin local behaviour only — what inspect says, what a plan would write, and that a write
// is scoped, idempotent, fingerprint-checked and refuses anything it cannot do safely. They prove
// nothing about Google consent or calendar access.
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
import { inspect, plan, apply, parseRow, SETUP_PROVIDER } from '../lib/meetings-setup.mjs';
import { confine, fingerprint, writeScoped, setEnvValue, envAssignments, redact } from '../lib/setup-kit.mjs';

/** Git with this machine's global and system configuration kept out, so fixtures behave the same anywhere. */
const ISOLATED = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
const git = (cwd, ...args) => { const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', env: ISOLATED }); assert.equal(r.status, 0, r.stderr); };
const gitInit = (root) => git(root, 'init', '-q');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); made.push(d); return d; };
const CLI = fileURLToPath(new URL('../bin/setup.mjs', import.meta.url));
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
	test('inspect starts nothing; plan writes nothing and asks Git only read-only questions', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		credentials(w.home, ['dana@northwind.example']);
		const before = fs.readFileSync(w.envFile, 'utf8');
		const asked = [];
		const git = (root, args) => { asked.push(args); return { status: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' }; };
		const a = readOnly(() => inspect({ root: w.root, env: {}, home: w.home }));
		const b = readOnly(() => plan({ root: w.root, env: {}, home: w.home, rows: [ROW], git }));
		const c = readOnly(() => plan({ root: w.root, env: {}, home: w.home }));
		assert.deepEqual([...a.calls, ...b.calls, ...c.calls], []);
		assert.deepEqual([a.error, b.error, c.error], [undefined, undefined, undefined]);
		assert.deepEqual(asked, [['rev-parse', '--show-toplevel']]);
		assert.equal(rowsAction(b.result).state, 'ready');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), before);
		assert.ok(!('content' in rowsAction(b.result)), 'the plan carries a preview, not the file');
	});
});

describe('add-calendar-rows', () => {
	test('fills the blank key dt-setup writes, then a second run is a no-op that writes nothing', () => {
		const w = workspace({ env: '# ── dreamteamer modules ──\nFILES_FOLDER=\nWORK_CALENDARS=\nUNKNOWN_KEY=kept\n' });
		const p = plan({ root: w.root, env: {}, home: w.home, rows: [ROW] });
		const step = rowsAction(p);
		assert.equal(step.state, 'ready');
		assert.deepEqual(step.effects, ['workspace-file: .env (WORK_CALENDARS only; every other line is kept byte for byte)']);
		assert.equal(step.preview.change, 'update WORK_CALENDARS');
		assert.deepEqual(step.preview.adds, [ROW]);
		const r = apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: p.workspace.root, expect: step.preview.expect, rows: [ROW] });
		assert.equal(r.changed, true);
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), `# ── dreamteamer modules ──\nFILES_FOLDER=\nWORK_CALENDARS="${ROW}"\nUNKNOWN_KEY=kept\n`);
		assert.equal(byId(r.checks)['meetings.work-calendars'].status, 'configured', 'the result re-inspects');
		const stat = fs.statSync(w.envFile);
		assert.equal(rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] })).state, 'done');
		const again = apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: fingerprint(w.envFile), rows: [ROW] });
		assert.equal(again.changed, false);
		assert.equal(fs.statSync(w.envFile).mtimeMs, stat.mtimeMs, 'an idempotent run does not touch the file');
	});
	test('appends to existing rows, keeping comments, unknown keys and their order byte for byte', () => {
		const before = `# private\nA=1\nWORK_CALENDARS="${ROW}\n# kept comment"\n\nZ='two words'  # trailing\n`;
		const w = workspace({ env: before });
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW, ROW2] }));
		assert.equal(step.preview.keeps, 1);
		assert.deepEqual(step.preview.adds, [ROW2], 'a row already present is not added again');
		apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: step.preview.expect, rows: [ROW, ROW2] });
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), `# private\nA=1\nWORK_CALENDARS="${ROW}\n# kept comment\n${ROW2}"\n\nZ='two words'  # trailing\n`);
	});
	test('creates an owner-only .env when there is none, and appends the key to a file without it', () => {
		const w = workspace();
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.preview.expect, 'absent');
		assert.equal(step.preview.change, 'create .env with WORK_CALENDARS');
		apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: 'absent', rows: [ROW] });
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), `WORK_CALENDARS="${ROW}"\n`);
		if (process.platform !== 'win32') assert.equal(fs.statSync(w.envFile).mode & 0o777, 0o600);
		const v = workspace({ env: 'A=1' });
		const s = rowsAction(plan({ root: v.root, env: {}, home: v.home, rows: [ROW] }));
		apply({ root: v.root, env: {}, home: v.home, action: 'add-calendar-rows', workspace: v.root, expect: s.preview.expect, rows: [ROW] });
		assert.equal(fs.readFileSync(v.envFile, 'utf8'), `A=1\nWORK_CALENDARS="${ROW}"\n`);
	});
	test('an existing file keeps its permission bits', { skip: process.platform === 'win32' }, () => {
		const w = workspace({ env: 'A=1\n' });
		fs.chmodSync(w.envFile, 0o640);
		const s = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: s.preview.expect, rows: [ROW] });
		assert.equal(fs.statSync(w.envFile).mode & 0o777, 0o640);
	});
	test('refuses, changing nothing: a company conflict, a doubled key, a malformed existing row, a shadowing process value', () => {
		const cases = [
			[`WORK_CALENDARS="${ROW}"\n`, {}, [ROW.replace('northwind |', 'harbor-mutual |')], /different default company/],
			[`WORK_CALENDARS="${ROW}"\nWORK_CALENDARS=""\n`, {}, [ROW2], /more than once/],
			['WORK_CALENDARS="a | b"\n', {}, [ROW2], /malformed line\(s\) 1/],
			['WORK_CALENDARS=\n', { WORK_CALENDARS: ROW }, [ROW2], /process environment/],
			['WORK_CALENDARS=\'$HOME | x | y\'\n', {}, [ROW2], /characters this action does not rewrite/],
		];
		for (const [text, env, rows, reason] of cases) {
			const w = workspace({ env: text });
			const step = rowsAction(plan({ root: w.root, env, home: w.home, rows }));
			assert.equal(step.state, 'blocked', text);
			assert.match(step.reason, reason);
			assert.throws(() => apply({ root: w.root, env, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: fingerprint(w.envFile), rows }), (e) => e.code === 'blocked');
			assert.equal(fs.readFileSync(w.envFile, 'utf8'), text);
		}
	});
	test('in a Git repository: a tracked .env is refused even when .gitignore names it', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		gitInit(w.root);
		git(w.root, 'add', '-f', '.env');
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.state, 'blocked');
		assert.match(step.reason, /tracked by Git/);
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: fingerprint(w.envFile), rows: [ROW] }), (e) => e.code === 'blocked');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'WORK_CALENDARS=\n');
	});
	test('in a Git repository: Git decides ignore, so a wildcard negation that re-includes .env is refused', () => {
		for (const gitignore of ['.env\n!.en*\n', '.env\n!.env\n', '*.env\n!/.env\n']) {
			const w = workspace({ env: 'A=1\n', gitignore });
			gitInit(w.root);
			const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
			assert.equal(step.state, 'blocked', gitignore);
			assert.match(step.reason, /Git does not ignore \.env/);
		}
		const ok = workspace({ env: 'A=1\n', gitignore: 'node_modules/\n.env*\n' });
		gitInit(ok.root);
		const step = rowsAction(plan({ root: ok.root, env: {}, home: ok.home, rows: [ROW] }));
		assert.equal(step.state, 'ready', step.reason);
		assert.equal(step.preview.vcs, 'git');
		const sub = path.join(ok.root, 'nested'); fs.mkdirSync(sub);
		fs.writeFileSync(path.join(ok.root, '.gitignore'), '.env*\n');
		fs.writeFileSync(path.join(sub, '.keep'), '');
		assert.equal(rowsAction(plan({ root: ok.root, env: {}, home: ok.home, rows: [ROW] })).state, 'ready', 'ignored, untracked');
	});
	test('outside Git the policy is static and conservative: an exact .env line and no negation at all', () => {
		const cases = [[null, false], ['node_modules/\n', false], ['.env\n!.en*\n', false], ['.env\n!docs/keep\n', false], ['.env*\n', false], ['.env\n', true], ['/.env\n', true]];
		for (const [gitignore, safe] of cases) {
			const w = workspace({ env: 'A=1\n', gitignore });
			const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
			assert.equal(step.state, safe ? 'ready' : 'blocked', String(gitignore));
			if (safe) assert.equal(step.preview.vcs, 'none');
			else assert.match(step.reason, /not a Git repository.*no negation/);
		}
	});
	test('when Git cannot run, a workspace with a .git is refused and one without falls back to the static policy', () => {
		const noGit = () => ({ status: null, stderr: '' });
		const w = workspace({ env: 'A=1\n' });
		assert.equal(rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW], git: noGit })).state, 'ready');
		fs.mkdirSync(path.join(w.root, '.git'));
		assert.match(rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW], git: noGit })).reason, /Git cannot be run/);
		const odd = () => ({ status: 2, stderr: 'fatal: something else' });
		assert.equal(rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW], git: odd })).state, 'blocked');
	});
	test('apply asks Git again: .env tracked after the preview is refused, before and right before the rename', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		gitInit(w.root);
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.state, 'ready');
		git(w.root, 'add', '-f', '.env');
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: step.preview.expect, rows: [ROW] }), (e) => e.code === 'blocked');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'WORK_CALENDARS=\n');
		// the second question, after the new content is on disk: tracked by then
		const v = workspace({ env: 'WORK_CALENDARS=\n' });
		let lsFiles = 0;
		const flips = (root, args) => args[0] === 'rev-parse' ? { status: 0, stderr: '' } : args[0] === 'ls-files' ? { status: ++lsFiles === 1 ? 1 : 0, stderr: '' } : { status: 0, stderr: '' };
		const s = rowsAction(plan({ root: v.root, env: {}, home: v.home, rows: [ROW], git: (r, a) => (a[0] === 'ls-files' ? { status: 1, stderr: '' } : { status: 0, stderr: '' }) }));
		assert.throws(() => apply({ root: v.root, env: {}, home: v.home, action: 'add-calendar-rows', workspace: v.root, expect: s.preview.expect, rows: [ROW], git: flips }), (e) => e.code === 'blocked' && /tracked/.test(e.message));
		assert.equal(lsFiles, 2, 'asked once for the plan and once right before the rename');
		assert.equal(fs.readFileSync(v.envFile, 'utf8'), 'WORK_CALENDARS=\n');
		assert.deepEqual(fs.readdirSync(v.root).filter((f) => f.endsWith('.tmp')), []);
	});
	test('a temporary file left by an interrupted write blocks the action until a person removes it', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		const leftover = path.join(w.root, '.env.setup-4242.abcdef.tmp');
		fs.writeFileSync(leftover, `WORK_CALENDARS="${ROW}"\n`);
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.state, 'blocked');
		assert.match(step.reason, /interrupted write.*delete them/);
		assert.ok(!step.reason.includes('dana@'));
		fs.rmSync(leftover);
		assert.equal(rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] })).state, 'ready');
	});
	test('refuses a symlinked .env, and never writes through it', () => {
		const w = workspace();
		const elsewhere = path.join(w.base, 'elsewhere.env'); fs.writeFileSync(elsewhere, 'A=1\n');
		fs.symlinkSync(elsewhere, w.envFile);
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		assert.equal(step.state, 'blocked');
		assert.match(step.reason, /symlink/i);
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: 'absent', rows: [ROW] }));
		assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'A=1\n');
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
	test('a concurrent edit after the preview makes apply stop and keeps the other writer\'s bytes', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		const step = rowsAction(plan({ root: w.root, env: {}, home: w.home, rows: [ROW] }));
		fs.writeFileSync(w.envFile, 'WORK_CALENDARS=\nEDITED_MEANWHILE=1\n');
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect: step.preview.expect, rows: [ROW] }), (e) => e.code === 'stale');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'WORK_CALENDARS=\nEDITED_MEANWHILE=1\n');
		assert.deepEqual(fs.readdirSync(w.root).filter((f) => f.endsWith('.tmp')), []);
	});
	test('refuses another workspace, a missing fingerprint and the owner\'s live step', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		const other = workspace();
		const expect = fingerprint(w.envFile);
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: other.root, expect, rows: [ROW] }), (e) => e.code === 'workspace');
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, rows: [ROW] }), (e) => e.code === 'stale');
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'verify-calendar-access', workspace: w.root }), (e) => e.code === 'action' && /owner/.test(e.message));
		assert.throws(() => apply({ root: w.root, env: {}, home: w.home, action: 'add-calendar-rows', workspace: w.root, expect }), (e) => e.code === 'usage');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'WORK_CALENDARS=\n');
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

describe('the shared helpers', () => {
	test('confine refuses an escape, an absolute path and a symlinked folder', () => {
		const w = workspace();
		for (const rel of ['../x', '/etc/hosts', '', '.']) assert.throws(() => confine(w.root, rel), (e) => e.code === 'path', rel);
		fs.symlinkSync(w.base, path.join(w.root, 'linked'));
		assert.throws(() => confine(w.root, 'linked/.env'), (e) => e.code === 'symlink');
		assert.equal(confine(w.root, 'sub/new.txt'), path.join(w.root, 'sub', 'new.txt'));
	});
	test('writeScoped stops when the file changes between its last check and the rename', () => {
		const w = workspace({ env: 'A=1\n' });
		const expected = fingerprint(w.envFile);
		const fsync = fs.fsyncSync;
		fs.fsyncSync = (fd) => { fsync(fd); fs.writeFileSync(w.envFile, 'A=2\n'); };
		try { assert.throws(() => writeScoped({ root: w.root, rel: '.env', content: 'A=3\n', expected }), (e) => e.code === 'stale'); }
		finally { fs.fsyncSync = fsync; }
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'A=2\n');
		assert.deepEqual(fs.readdirSync(w.root).filter((f) => f.endsWith('.tmp')), [], 'the temporary file is removed');
	});
	test('a separate process editing the file before the last check stops the write; its bytes survive', () => {
		const w = workspace({ env: 'A=1\n' });
		const expected = fingerprint(w.envFile);
		const editor = () => { const r = cp.spawnSync(process.execPath, ['-e', `require('fs').appendFileSync(${JSON.stringify(w.envFile)}, 'EDITOR=1\\n')`]); assert.equal(r.status, 0); };
		assert.throws(() => writeScoped({ root: w.root, rel: '.env', content: 'A=3\n', expected, recheck: editor }), (e) => e.code === 'stale');
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'A=1\nEDITOR=1\n');
		assert.deepEqual(fs.readdirSync(w.root).filter((f) => f.endsWith('.tmp')), []);
	});
	test('the temporary file is removed when the write, the fsync, a recheck or the rename fails', () => {
		for (const [name, fail] of [['writeFileSync', (o) => (fd, ...r) => { if (typeof fd === 'number') throw new Error('disk full'); return o(fd, ...r); }], ['fsyncSync', () => () => { throw new Error('I/O error'); }], ['renameSync', () => () => { throw new Error('cross-device'); }]]) {
			const w = workspace({ env: 'A=1\n' });
			const original = fs[name];
			fs[name] = fail(original);
			try { assert.throws(() => writeScoped({ root: w.root, rel: '.env', content: 'A=2\n', expected: fingerprint(w.envFile) })); }
			finally { fs[name] = original; }
			assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'A=1\n', name);
			assert.deepEqual(fs.readdirSync(w.root).filter((f) => f.endsWith('.tmp')), [], name);
		}
		const w = workspace({ env: 'A=1\n' });
		const cancelled = () => { throw new Error('cancelled'); };
		assert.throws(() => writeScoped({ root: w.root, rel: '.env', content: 'A=2\n', expected: fingerprint(w.envFile), recheck: cancelled }), /cancelled/);
		assert.equal(fs.readFileSync(w.envFile, 'utf8'), 'A=1\n');
		assert.deepEqual(fs.readdirSync(w.root).filter((f) => f.endsWith('.tmp')), []);
	});
	test('setEnvValue changes one assignment and nothing else', () => {
		assert.equal(setEnvValue('A=1\nK=old # c\nB=2', 'K', 'new'), 'A=1\nK="new"\nB=2');
		assert.equal(setEnvValue('', 'K', 'v'), 'K="v"\n');
		assert.throws(() => setEnvValue('K=1\nK=2\n', 'K', 'v'), (e) => e.code === 'conflict');
		for (const bad of ['a"b', 'a\\b', '$X', '`x`', 'a\rb']) assert.throws(() => setEnvValue('', 'K', bad), (e) => e.code === 'input');
		assert.deepEqual(envAssignments('K="a\nb"\n', 'K').map((a) => a.value), ['a\nb']);
	});
	test('redact removes addresses, absolute paths and token-like strings', () => {
		const out = redact('failed for dana@northwind.example at /home/dana/.config/x.json with ya29.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
		assert.equal(out, 'failed for <email> at <path> with <redacted>');
	});
});

describe('the CLI', () => {
	const run = (cwd, args, env = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(cwd, '..', 'home'), ...env } });
	test('runs through a symlink, plans, applies and becomes a no-op', () => {
		const w = workspace({ env: 'WORK_CALENDARS=\n' });
		const link = path.join(w.base, 'setup-link.mjs'); fs.symlinkSync(CLI, link);
		const inspected = cp.spawnSync(process.execPath, [link, 'inspect', '--json'], { cwd: w.root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: w.home } });
		assert.equal(inspected.status, 0, inspected.stderr);
		assert.equal(JSON.parse(inspected.stdout).module, SETUP_PROVIDER.module);
		const p = JSON.parse(run(w.root, ['plan', '--row', ROW, '--json']).stdout);
		const step = rowsAction(p);
		assert.equal(p.workspace.root, w.root);
		assert.equal(fs.realpathSync(path.resolve(w.root, step.command[1])), fs.realpathSync(CLI), 'the planned command names this script from the workspace');
		const applied = run(w.root, [...step.command.slice(2), '--json']);
		assert.equal(applied.status, 0, applied.stdout + applied.stderr);
		assert.equal(JSON.parse(applied.stdout).changed, true);
		const human = run(w.root, ['plan', '--row', ROW]);
		assert.match(human.stdout, /action add-calendar-rows: done/);
	});
	test('usage is exit 2, a refusal exit 1, outside a workspace exit 1, and the text carries no path', () => {
		const w = workspace({ env: 'A=1\n' });
		assert.equal(run(w.root, ['frobnicate']).status, 2);
		assert.equal(run(w.root, ['plan', '--row']).status, 2);
		assert.equal(run(w.root, ['inspect', 'extra']).status, 2);
		const refused = run(w.root, ['apply', 'add-calendar-rows', '--workspace', w.base, '--expect', 'absent', '--row', ROW, '--json']);
		assert.equal(refused.status, 1);
		assert.equal(JSON.parse(refused.stdout).error, 'workspace');
		const outside = run(w.home, ['inspect']);
		assert.equal(outside.status, 1);
		assert.match(outside.stderr, /Not inside a dreamteamer workspace/);
	});
});

test('SETUP.md is shipped and names every action and status this provider has', () => {
	const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('SETUP.md') && pkg.files.includes('lib'));
	assert.equal(pkg.dreamteamer.extension, undefined, 'core composes meetings beside files, the one extension its composition allows');
	const text = fs.readFileSync(new URL('../SETUP.md', import.meta.url), 'utf8');
	for (const id of SETUP_PROVIDER.actions) assert.match(text, new RegExp(`\\b${id}\\b`));
	for (const word of ['configured', 'unverified', 'blocked', 'skipped', 'ready']) assert.match(text, new RegExp(word));
});
