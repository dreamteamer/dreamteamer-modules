// THE MIGRATION (cr-modules-010, line 7; rnd/tests cr-modules-010-t7) — one command, dry-run by default,
// run from the PACKED path: this workspace's sessions move out of SESSIONS_FOLDER into data/sessions/
// (another workspace's are left), their FILES_FOLDER transcripts move under SESSIONS_FOLDER, the
// removed fields go, the workspace's own session-bindings sources go and core 0.8.0's Stop entry is
// taken out of .claude/settings.json; a second run prints zeros. Before it, a session-bindings source
// compiles with one `retired` line and exit 0, and a leftover `dt session heartbeat --hook` exits 0
// writing nothing. After it, session-bindings is an unknown collection and check is green.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, engineMeets, pkgOf, editPkg, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';
import { dt, coreWorkspace, sessionFiles } from './helpers-sessions.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const HOOK = 'sh "$CLAUDE_PROJECT_DIR/node_modules/dreamteamer/bin/dt-hook.sh" session heartbeat --hook';
const OTHER_HOOK = 'node scripts/notify.mjs';

function write(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const record = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? `\n${v.map((x) => `  - ${x}`).join('\n')}` : JSON.stringify(v)}`).join('\n')}\n---\n`;

let claudeDir;
function fixture() {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-migrate-')));
	after(() => fs.rmSync(folder, { recursive: true, force: true }));
	claudeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-claude-')));
	after(() => fs.rmSync(claudeDir, { recursive: true, force: true }));
	const root = coreWorkspace((ws) => {
		fs.appendFileSync(path.join(ws, '.env'), `SESSIONS_FOLDER=${folder}\n`);
		editPkg(ws, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); }); // a 0.8.0 workspace declared it
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}\n'); // an npm-installed workspace has one; the script finds its root by it
		write(path.join(ws, 'modules', 'default', 'session-bindings', 'companies.session-binding.yaml'), 'collection: collections/companies\nconcurrency: one\n');
		write(path.join(ws, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: HOOK, timeout: 600 }, { type: 'command', command: OTHER_HOOK }] }, { matcher: '*', hooks: [{ type: 'command', command: 'npx dt session heartbeat --hook --quiet' }] }] } }, null, 2));
	});
	// ours: the transcript was recorded in this workspace; theirs: in another one
	write(path.join(root, 'files', 'sessions', '2026', '10', 'ours.jsonl'), `${JSON.stringify({ type: 'user', cwd: root })}\n`);
	write(path.join(folder, '2026', '10', '2026-10-28--ours.session.md'), record({ name: 'Northwind export', started: '2026-10-28T09:00:00Z', status: 'ended', binding: 'session-bindings/companies', heartbeat: '2026-10-28T09:10:00Z', transcript: '${env:FILES_FOLDER}/sessions/2026/10/ours.jsonl', records: ['companies/northwind'] }));
	write(path.join(root, 'files', 'sessions', '2026', '10', 'theirs.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/elsewhere/harbor-mutual' })}\n`);
	write(path.join(folder, '2026', '10', '2026-10-28--theirs.session.md'), record({ name: 'Harbor Mutual audit', started: '2026-10-28T10:00:00Z', status: 'running', transcript: '${env:FILES_FOLDER}/sessions/2026/10/theirs.jsonl' }));
	// written by 0.8.0's `dt session start`: no transcript field — the harness transcript of its session_id says whose it is
	write(path.join(claudeDir, 'projects', '-probe', 'b7e2c1d0-0000-4000-8000-0000000000a1.jsonl'), `${JSON.stringify({ type: 'user', cwd: root })}\n`);
	write(path.join(folder, '2026', '10', '2026-10-28--started.session.md'), record({ name: 'Northwind design', started: '2026-10-28T12:00:00Z', status: 'running', heartbeat: '2026-10-28T12:05:00Z', binding: 'session-bindings/companies', session_id: 'b7e2c1d0-0000-4000-8000-0000000000a1', records: ['companies/northwind'] }));
	write(path.join(folder, '2026', '10', '2026-10-28--unknown.session.md'), record({ name: 'No transcript', started: '2026-10-28T11:00:00Z', status: 'abandoned' }));
	assert.equal(dt(root, ['add', 'companies', '--name', 'Northwind']).code, 0);
	return { root, folder };
}
const migrate = (root, args = []) => {
	const r = spawnSync(process.execPath, [path.join(root, 'node_modules', '@dreamteamer', 'core', 'bin', 'sessions-migrate.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir } });
	return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

describe('sessions-migrate', { skip }, () => {
	test('retired kind and heartbeat no-op before; dry run writes nothing; --write moves ours, leaves theirs, then zeros', () => {
		const { root, folder } = fixture();
		const compiled = dt(root, ['compile']);
		assert.equal(compiled.code, 0, compiled.err);
		const retired = (compiled.out + compiled.err).split('\n').filter((l) => /session-bindings\/.*retired in core 0\.9\.0, ignored/.test(l));
		assert.equal(retired.length, 1, compiled.out + compiled.err);
		const hb = dt(root, ['session', 'heartbeat', '--hook'], { input: JSON.stringify({ session_id: 'x' }) });
		assert.equal(hb.code, 0, hb.err);
		const unknown = dt(root, ['list', 'session-bindings']);
		assert.notEqual(unknown.code, 0, 'session-bindings is still a collection');

		const dry = migrate(root);
		assert.equal(dry.code, 0, dry.out);
		assert.match(dry.out, /records 2 · transcripts 1 · sources 1 · hooks 1 · left 2/);
		assert.deepEqual(sessionFiles(root), [], 'the dry run moved something');

		const w = migrate(root, ['--write']);
		assert.equal(w.code, 0, w.out);
		assert.deepEqual(sessionFiles(root), ['2026/10/2026-10-28--ours.session.md', '2026/10/2026-10-28--started.session.md']);
		assert.doesNotMatch(fs.readFileSync(path.join(root, 'data', 'sessions', '2026', '10', '2026-10-28--started.session.md'), 'utf8'), /^(status|binding|heartbeat):/m);
		const ours = fs.readFileSync(path.join(root, 'data', 'sessions', '2026', '10', '2026-10-28--ours.session.md'), 'utf8');
		assert.doesNotMatch(ours, /^(status|binding|heartbeat):/m);
		assert.match(ours, /^transcript: .*\$\{env:SESSIONS_FOLDER\}\/2026\/10\/ours\.jsonl/m);
		assert.ok(fs.existsSync(path.join(folder, '2026', '10', 'ours.jsonl')), 'the transcript did not move under SESSIONS_FOLDER');
		assert.ok(fs.existsSync(path.join(folder, '2026', '10', '2026-10-28--theirs.session.md')), 'another workspace\'s session moved');
		assert.match(w.out, /left .*2026-10-28--theirs/);
		assert.match(w.out, /left .*2026-10-28--unknown/);
		assert.ok(!fs.existsSync(path.join(root, 'modules', 'default', 'session-bindings')), 'the workspace\'s own binding source is still there');
		const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
		const cmds = JSON.stringify(settings);
		assert.ok(!cmds.includes('dt-hook.sh\\" session heartbeat'), cmds);
		assert.match(w.out, /note: .*session heartbeat in a shape/, 'the other-shape entry was not named');
		assert.ok(cmds.includes(OTHER_HOOK), 'another Stop hook was removed');

		assert.match(migrate(root).out, /records 0 · transcripts 0 · sources 0 · hooks 0 · left 2/);
		const c2 = dt(root, ['compile']);
		assert.equal(c2.code, 0, c2.err);
		const checked = dt(root, ['check']);
		assert.equal(checked.code, 0, checked.err + checked.out);

		const taken = migrate(root, ['--write', '--take', '2026/10/2026-10-28--theirs']);
		assert.equal(taken.code, 0, taken.out);
		assert.ok(sessionFiles(root).includes('2026/10/2026-10-28--theirs.session.md'), taken.out);
	});
});
