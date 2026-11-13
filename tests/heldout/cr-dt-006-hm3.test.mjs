// held-out cr-dt-006-hm3 — a TRANSCRIPTION_HOME that is a symlink into the workspace is refused by set-home, and
// nothing of the unit lands inside the workspace — whether the link's target already exists or not (a dangling link
// is still a path into the tree: mkdir -p through it creates the target). rnd/tests/cr-dt-006-hm3.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless, fakeBins, git } from './cr-dt-006-lib.mjs';

after(cleanup);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('hm3', { skip: skipUnless('recordings') }, () => {
	let from;
	for (const existing of [true, false]) {
		test(`a symlink into the workspace (target ${existing ? 'existing' : 'not yet created'}): set-home refuses naming the path, nothing provisioned inside; an outside folder succeeds`, () => {
			from ??= packedInto(tmp('dtm-from-'), ...closure('recordings'));
			const root = virginWorkspace();
			if (existing) fs.mkdirSync(path.join(root, 'models'));
			const link = path.join(tmp('dtm-link-'), 'home-link');
			fs.symlinkSync(path.join(root, 'models'), link, 'dir');
			const files = tmp('dtm-files-');
			const bins = fakeBins(['uv', 'ffmpeg']);
			const env = cleanEnv(); env.PATH = `${bins}${path.delimiter}${env.PATH}`;
			const args = (home) => ['install', '@dreamteamer/recordings', '--from', from, '--input', `files_folder=${files}`, '--input', `transcription_home=${home}`, '--allow', 'machine', '--no-input'];
			const r = dt(root, args(link), env);
			assert.ok(r.code === 0 || r.code === 1, r.stderr + r.stdout.slice(-500));
			const out = r.stdout + r.stderr;
			assert.doesNotMatch(out, /✔ set-home/, `set-home did not write:\n${out.slice(-800)}`);
			assert.match(out, /set-home \(blocked\)/, 'the unit line reads blocked');
			assert.match(out, /inside the workspace|resolves inside/i, 'naming the reason');
			assert.match(out, new RegExp(esc(link)), 'and the path');
			const envText = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
			assert.ok(!new RegExp(`^TRANSCRIPTION_HOME=.*(${esc(link)}|${esc(root)})`, 'm').test(envText), `.env gains no TRANSCRIPTION_HOME pointing into the tree:\n${envText}`);
			assert.doesNotMatch(out, /✔ provision-venv/, 'provision-venv is not attempted on a refused home');
			assert.ok(!fs.existsSync(path.join(root, 'models', 'venv')) && (existing || !fs.existsSync(path.join(root, 'models'))), 'nothing under <workspace>/models');
			assert.ok(!git(root, ['status', '--porcelain']).split('\n').some((l) => /models/.test(l)), 'git status shows no new untracked path from the unit');
			const outside = path.join(tmp('dtm-home-'), 'home');
			const ok = dt(root, ['setup', 'recordings', '--input', `files_folder=${files}`, '--input', `transcription_home=${outside}`, '--allow', 'machine', '--no-input'], env);
			assert.equal(ok.code, 0, ok.stderr + ok.stdout.slice(-500));
			assert.match(ok.stdout, /✔ set-home — wrote \.env/);
			assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), new RegExp(`^TRANSCRIPTION_HOME="?${esc(outside)}"?$`, 'm'));
		});
	}
});
