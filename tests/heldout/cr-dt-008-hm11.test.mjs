// HELD-OUT (cr-dt-008, rnd/tests dreamteamer-modules/heldout-dt008-m-check-alone-core-with-a-member-missing).
//
// `dt check modules/core --alone` with one member absent from modules/ refuses naming the member and the version
// the preset pins; with a member at another version than the pin it refuses naming both; it never reports core
// publishable while a member it installed is broken; and it passes again when the member is back.
// Runs on a COPY of this repo (git-initialised, node_modules linked the way npm workspaces link it, with
// @dreamteamer/* pointing at the copy's own modules/) — the worktree's modules/ is never touched.
// Written by the test stage from the record's steps and expected; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, pkgOf, run, ENGINE_VERSION } from '../helpers/workspace.mjs';
import { engineMeets } from 'dreamteamer/testing';

const ENGINE_V = ENGINE_VERSION.split('.').map(Number);
const skip = !(ENGINE_V[0] > 0 || ENGINE_V[1] >= 49) && `dt check --alone walks module presets from engine 0.49.0; testing ${ENGINE_VERSION}`;
void engineMeets;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const SKIP_COPY = /(^|\/)(node_modules|__pycache__|\.venv|\.pytest_cache|\.git|\.dreamteamer|\.perspective|\.claude)(\/|$)/;
const GIT = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, args) => execFileSync('git', args, { cwd, env: GIT, encoding: 'utf8' });

/** Step 1: the candidate repo copied to a temp dir, committed, node_modules linked. */
function copyRepo() {
	const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dtm-hm11-'));
	made.push(dir);
	fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !SKIP_COPY.test(path.relative(ROOT, src)) });
	const nm = path.join(dir, 'node_modules');
	fs.mkdirSync(path.join(nm, '@dreamteamer'), { recursive: true });
	for (const e of fs.readdirSync(path.join(ROOT, 'node_modules'))) if (e !== '@dreamteamer' && e !== '.bin' && e !== '.package-lock.json') fs.symlinkSync(path.join(ROOT, 'node_modules', e), path.join(nm, e));
	for (const m of fs.readdirSync(path.join(dir, 'modules'))) if (fs.existsSync(path.join(dir, 'modules', m, 'package.json'))) fs.symlinkSync(path.join('..', '..', 'modules', m), path.join(nm, '@dreamteamer', m));
	git(dir, ['init', '-q']);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'copy']);
	return dir;
}
const alone = (dir, m) => {
	const r = run(dir, ['check', `modules/${m}`, '--alone']);
	return { code: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
};
const STACK = /\n\s+at [^\n]+:\d+:\d+\)?/;
const PIN = () => pkgOf('core').dreamteamer.preset['@dreamteamer/metrics'];
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const editJson = (f, fn) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j, null, '\t') + '\n'); };

describe('dt check modules/core --alone with a member missing', { skip, concurrency: 1 }, () => {
	test('steps 1–5', { timeout: 1_200_000 }, () => {
		const dir = copyRepo();
		// step 2
		const s2 = alone(dir, 'core');
		assert.equal(s2.code, 0, `step 2: exit ${s2.code}\n${s2.out}`);
		assert.match(s2.stdout, /✔ modules\/core is publishable/);
		const members = Object.keys(pkgOf('core').dreamteamer.preset);
		assert.equal(members.length, 17);
		// steps 3–5 are judged softly and asserted together at the end, so one refusal's wording does not hide the next step
		const failures = [];
		const soft = new Proxy({}, { get: (_, k) => (...a) => { try { assert[k](...a); } catch (e) { failures.push(e.message); } } });
		// step 3 — metrics removed
		const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-hm11-metrics-')), 'metrics');
		made.push(path.dirname(saved));
		fs.cpSync(path.join(dir, 'modules', 'metrics'), saved, { recursive: true });
		fs.rmSync(path.join(dir, 'modules', 'metrics'), { recursive: true, force: true });
		const s3 = alone(dir, 'core');
		soft.notEqual(s3.code, 0, `step 3 passed:\n${s3.out}`);
		soft.match(s3.out, /@dreamteamer\/metrics/, `step 3 does not name the member:\n${s3.out}`);
		soft.match(s3.out, new RegExp(rx(PIN())), `step 3 does not name the pinned version ${PIN()}:\n${s3.out}`);
		soft.doesNotMatch(s3.out, STACK, `step 3 printed a stack trace:\n${s3.out}`);
		soft.doesNotMatch(s3.out, /is publishable/);
		const st3 = git(dir, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean);
		soft.deepEqual(st3.filter((l) => !/^ D modules\/metrics\//.test(l)), [], `step 3 left something behind:\n${st3.join('\n')}`);
		// step 4 — metrics back, one patch above the pin
		fs.cpSync(saved, path.join(dir, 'modules', 'metrics'), { recursive: true });
		const [a, b, c] = PIN().split('.').map(Number);
		const above = `${a}.${b}.${c + 1}`;
		editJson(path.join(dir, 'modules', 'metrics', 'package.json'), (j) => { j.version = above; });
		const s4 = alone(dir, 'core');
		soft.notEqual(s4.code, 0, `step 4 passed — a preset published against a member version that does not exist:\n${s4.out}`);
		soft.match(s4.out, /metrics/, `step 4 does not name metrics:\n${s4.out}`);
		soft.match(s4.out, new RegExp(rx(PIN())), `step 4 does not name the pin ${PIN()}:\n${s4.out}`);
		soft.match(s4.out, new RegExp(rx(above)), `step 4 does not name what modules/ holds (${above}):\n${s4.out}`);
		soft.doesNotMatch(s4.out, /is publishable/);
		// step 5 — the version restored; metrics' files list omits collections
		editJson(path.join(dir, 'modules', 'metrics', 'package.json'), (j) => { j.version = PIN(); j.files = j.files.filter((f) => f !== 'collections'); });
		const s5m = alone(dir, 'metrics');
		soft.notEqual(s5m.code, 0, `step 5: metrics --alone passed with collections left out of files:\n${s5m.out}`);
		soft.match(s5m.out, /collection|files/, `step 5: metrics --alone names neither the missing collection nor the files list:\n${s5m.out}`);
		const s5c = alone(dir, 'core');
		// consistency: core is never publishable while metrics, a member it installs, fails its own --alone check
		if (s5m.code !== 0) soft.ok(!(s5c.code === 0 || /is publishable/.test(s5c.out)), `step 5: core reported publishable while metrics, a member it installed, fails dt check:\n${s5c.out}`);
		// every step ran; each failed expectation is listed here
		assert.deepEqual(failures, [], failures.join('\n----\n'));
	});
	test('step 6: sessions and rnd --alone in an untouched copy', { timeout: 900_000 }, () => {
		const dir = copyRepo();
		for (const m of ['sessions', 'rnd']) {
			const r = alone(dir, m);
			assert.equal(r.code, 0, `${m} --alone: exit ${r.code}\n${r.out}`);
			assert.match(r.stdout, new RegExp(`✔ modules/${m} is publishable`));
		}
	});
});
