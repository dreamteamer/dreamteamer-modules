// HELD-OUT (cr-dt-008, rnd/tests dreamteamer-modules/heldout-dt008-m-sessions-package-without-core).
//
// In a workspace with @dreamteamer/sessions and no core: dt session bind · end work, the Stop-hook reader
// bin/session-save.mjs writes a session from its own package path (from the root, a subdirectory and through a
// symlink), the record lands where core 0.11's bin put it for the same payload, dt-sessions-migrate runs from the
// sessions package, and nothing the package ships names @dreamteamer/core.
// Written by the test stage from the record's steps and expected; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createWorkspace, run as engineRun } from 'dreamteamer/testing';
import { ROOT, BIN, closure, moduleIds, packedInto, virginWorkspace, cleanup, engineMeets, pkgOf, ENGINE_VERSION } from '../helpers/workspace.mjs';

after(cleanup);
const skip = !engineMeets('sessions') && `needs engine ${pkgOf('sessions').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const SID = '3e880550-0000-4000-8000-0000000000c7';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ENV = (() => {
	const e = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid', HOME: tmp('dtm-HOME-') };
	delete e.CLAUDE_CODE_SESSION_ID; delete e.SESSIONS_FOLDER; delete e.CLAUDE_CONFIG_DIR;
	return e;
})();
const dt = (root, args, env = {}) => {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: { ...ENV, ...env }, timeout: 120_000 });
	return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const node = (cwd, file, args, input) => {
	const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8', env: ENV, input, timeout: 120_000 });
	return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const sessionFiles = (root) => {
	const dir = path.join(root, 'data', 'sessions');
	if (!fs.existsSync(dir)) return [];
	const out = [];
	const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p)); } };
	walk(dir);
	return out.sort();
};
/** A synthetic transcript (the sessions fixture, re-keyed to SID) and the Stop payload a harness sends. */
function payload(cwd) {
	const transcript = path.join(tmp('dtm-hm7-tx-'), `${SID}.jsonl`);
	const fixture = fs.readFileSync(path.join(ROOT, 'modules', 'sessions', 'test', 'fixtures', 'session.jsonl'), 'utf8');
	fs.writeFileSync(transcript, fixture.replaceAll('0f3a6c2e-1b4d-4e8a-9c7f-2d5e8a1b3c4d', SID));
	return JSON.stringify({ session_id: SID, transcript_path: transcript, cwd, hook_event_name: 'Stop' });
}
const HOOK_ARGS = ['--write', '--hook', '--quiet']; // the README's Stop-hook command line

/** What core 0.11's own bin writes for the same payload: core 0.11 (this repo's main clone) on engine 0.48. */
function core011Record() {
	const main = path.resolve(ROOT, '..', 'dreamteamer-modules', 'modules', 'core');
	const pkg = JSON.parse(fs.readFileSync(path.join(main, 'package.json'), 'utf8'));
	if (pkg.version !== '0.11.0' || !fs.existsSync(path.join(main, 'bin', 'session-save.mjs'))) return { skipped: `no core 0.11 at ${main}` };
	const engine = path.join(ROOT, 'node_modules', 'dreamteamer');
	const { root } = createWorkspace({ engine });
	const dest = tmp('dtm-hm7-core011-');
	const tgz = path.join(dest, JSON.parse(execFileSync('npm', ['pack', main, '--pack-destination', dest, '--json', '--silent'], { encoding: 'utf8', timeout: 120_000 }))[0].filename);
	const at = path.join(root, 'node_modules', '@dreamteamer', 'core');
	fs.mkdirSync(at, { recursive: true });
	execFileSync('tar', ['-xzf', tgz, '-C', at, '--strip-components', '1'], { timeout: 60_000 });
	const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	pj.dependencies['@dreamteamer/core'] = '0.11.0';
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pj, null, '\t') + '\n');
	// a real 0.11 workspace was installed by npm and has a lockfile, which 0.11's findWorkspace requires
	fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: pj.name, lockfileVersion: 3, requires: true, packages: {} }, null, '\t') + '\n');
	const c = engineRun({ root, engine }, ['compile'], { timeoutMs: 120_000 });
	assert.equal(c.status, 0, c.stderr);
	const r = node(root, path.join(at, 'bin', 'session-save.mjs'), HOOK_ARGS, payload(root));
	assert.equal(r.code, 0, `core 0.11's bin: ${r.out}`);
	return { files: sessionFiles(root), text: fs.readFileSync(path.join(root, 'data', 'sessions', sessionFiles(root)[0]), 'utf8') };
}

describe('sessions without core', { skip }, () => {
	test('steps 1–7', { timeout: 900_000 }, () => {
		// step 1
		const set = [...closure('sessions')];
		const folder = packedInto(tmp('dtm-hm7-'), ...set);
		const root = virginWorkspace();
		fs.mkdirSync(path.join(root, 'sessions-archive'));
		fs.appendFileSync(path.join(root, '.env'), `SESSIONS_FOLDER=${root}/sessions-archive\n`);
		const inst = dt(root, ['install', '@dreamteamer/sessions', '--from', folder, '--no-input']);
		assert.equal(inst.code, 0, `step 1: ${inst.out}`);
		const installed = fs.readdirSync(path.join(root, 'node_modules', '@dreamteamer')).sort();
		assert.deepEqual(installed, [...set].sort(), 'step 1: more than sessions\' closure installed');
		assert.ok(!fs.existsSync(path.join(root, 'node_modules', '@dreamteamer', 'core')), 'core is installed');
		// step 2
		const comp = dt(root, ['compile']);
		assert.equal(comp.code, 0, `compile: ${comp.out}`);
		assert.doesNotMatch(comp.out, /^\s*✖/m);
		const chk = dt(root, ['check']);
		assert.equal(chk.code, 0, `check: ${chk.out}`);
		assert.match(chk.out, /0 violations/);
		assert.doesNotMatch(chk.out, /dangling|resolves to nothing|unknown collection/i);
		const lc = dt(root, ['list', 'collections']);
		assert.equal(lc.code, 0, lc.out);
		assert.match(lc.out, /^sessions\b/m);
		assert.match(lc.out, /^agents\b/m);
		// step 3
		const u = dt(root, ['add', 'users', '--name', 'Dana Oren']);
		assert.equal(u.code, 0, u.out);
		const bound = dt(root, ['session', 'bind', 'users/dana-oren'], { CLAUDE_CODE_SESSION_ID: SID });
		assert.equal(bound.code, 0, `bind: ${bound.out}`);
		assert.deepEqual(sessionFiles(root), [`${SID}.session.md`], 'bind did not write where 0.11 wrote it');
		const next = dt(root, ['next', 'users/dana-oren']);
		assert.equal(next.code, 0, next.out);
		assert.match(next.out, new RegExp(`sessions/${SID}`), `dt next shows no session note:\n${next.out}`);
		const ended = dt(root, ['session', 'end', SID]);
		assert.equal(ended.code, 0, `end: ${ended.out}`);
		assert.match(fs.readFileSync(path.join(root, 'data', 'sessions', `${SID}.session.md`), 'utf8'), /^ended: /m);
		// step 4 — the hook reader from its own package path: root, a subdirectory, a symlink
		const bin = path.join(root, 'node_modules', '@dreamteamer', 'sessions', 'bin', 'session-save.mjs');
		const r1 = node(root, 'node_modules/@dreamteamer/sessions/bin/session-save.mjs', HOOK_ARGS, payload(root));
		assert.equal(r1.code, 0, `hook from the root: ${r1.out}`);
		const sub = path.join(root, 'data', 'sessions');
		const r2 = node(sub, bin, HOOK_ARGS, payload(root));
		assert.equal(r2.code, 0, `hook from a subdirectory: ${r2.out}`);
		const link = path.join(tmp('dtm-hm7-link-'), 'session-save.mjs');
		fs.symlinkSync(bin, link);
		const r3 = node(root, link, HOOK_ARGS, payload(root));
		assert.equal(r3.code, 0, `hook through a symlink: ${r3.out}`);
		assert.deepEqual(sessionFiles(root), [`${SID}.session.md`], 'one sessions record for the session id');
		const text = fs.readFileSync(path.join(root, 'data', 'sessions', `${SID}.session.md`), 'utf8');
		assert.match(text, /^turns: 3$/m, `the hook wrote no metrics:\n${text}`);
		const ref = core011Record();
		if (ref.skipped) assert.fail(ref.skipped);
		assert.deepEqual(ref.files, sessionFiles(root), 'core 0.11 wrote the record elsewhere');
		assert.equal(ref.text.match(/^session_id: (.*)$/m)?.[1], text.match(/^session_id: (.*)$/m)?.[1]);
		// step 5
		const mig = spawnSync('npx', ['--no-install', 'dt-sessions-migrate', '--help'], { cwd: root, encoding: 'utf8', env: ENV, timeout: 60_000 });
		assert.equal(mig.status, 0, `${mig.stdout}\n${mig.stderr}`);
		assert.equal(fs.realpathSync(path.join(root, 'node_modules', '.bin', 'dt-sessions-migrate')), fs.realpathSync(path.join(root, 'node_modules', '@dreamteamer', 'sessions', 'bin', 'sessions-migrate.mjs')));
		// step 6
		const g = spawnSync('grep', ['-rn', '@dreamteamer/core', path.join(root, 'node_modules', '@dreamteamer', 'sessions')], { encoding: 'utf8', timeout: 60_000 });
		const step6 = g.stdout; // asserted last, so step 7 still runs and reports
		// step 7
		const more = packedInto(folder, ...new Set([...closure('projects'), ...closure('tasks')]));
		const i2 = dt(root, ['install', '@dreamteamer/projects', '@dreamteamer/tasks', '--from', more, '--no-input']);
		assert.equal(i2.code, 0, `step 7 install: ${i2.out}`);
		assert.equal(dt(root, ['add', 'projects', '--name', 'Northwind portal']).code, 0);
		const t = dt(root, ['add', 'tasks', '--name', 'Send the Northwind quote']);
		assert.equal(t.code, 0, t.out);
		const taskId = fs.readdirSync(path.join(root, 'data', 'tasks'), { recursive: true }).find((f) => f.endsWith('.task.md')).replace(/\.task\.md$/, '');
		const s = dt(root, ['set', `sessions/${SID}`, 'project=projects/northwind-portal', `tasks=tasks/${taskId}`]);
		assert.equal(s.code, 0, `the session's project/task fields do not resolve: ${s.out}`);
		const chk2 = dt(root, ['check']);
		assert.equal(chk2.code, 0, `step 7 check: ${chk2.out}`);
		assert.match(chk2.out, /0 violations/);
		assert.equal(step6, '', `step 6: the sessions package names @dreamteamer/core:\n${step6}`);
	});
});
