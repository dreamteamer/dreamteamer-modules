// A skill folder's LOCAL files never compose. A developer who ran `uv sync` or a transcription in an
// origin's skill folder has a .venv (thousands of files), a .cache (raw ASR output of a real call) and
// __pycache__ beside the sources — all gitignored there, so a fresh clone has none and the drift test on
// CI would then fail on every one of them. The script is run here for real, from a copy beside a
// synthetic two-module tree, because it composes whatever sits under its own ../modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../../../scripts/compose-core.mjs';

const put = (root, rel, text = 'x\n') => {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	fs.writeFileSync(path.join(root, rel), text);
};

test('compose copies a skill\'s sources and none of its .venv, .cache, .models, __pycache__ or *.pyc', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-local-'));
	try {
		fs.mkdirSync(path.join(tmp, 'scripts'));
		fs.copyFileSync(path.join(ROOT, 'scripts', 'compose-core.mjs'), path.join(tmp, 'scripts', 'compose-core.mjs'));
		put(tmp, 'modules/alpha/package.json', JSON.stringify({
			name: '@dreamteamer/alpha', version: '0.1.0', files: ['README.md', 'skills'],
			dreamteamer: { title: 'Alpha', description: 'a synthetic origin', engine: '>=0.33.0' },
		}));
		const skill = 'modules/alpha/skills/transcribing';
		put(tmp, `${skill}/SKILL.md`, '---\nname: transcribing\ndescription: use when a test needs one\n---\n');
		put(tmp, `${skill}/transcribe.py`, 'print("hi")\n');
		put(tmp, `${skill}/.gitignore`, '.venv/\n.cache\n.models\n__pycache__/\n*.pyc\n');
		put(tmp, `${skill}/.venv/pyvenv.cfg`, 'home = /usr/bin\n');
		put(tmp, `${skill}/.venv/lib/python3.12/site-packages/numpy/__init__.py`);
		put(tmp, `${skill}/.cache/asr/2026-08-30--northwind-weekly.asr.json`, '{"asr":{"words":[]}}\n');
		put(tmp, `${skill}/.models/embedding.onnx`, 'weights');
		put(tmp, `${skill}/__pycache__/transcribe.cpython-312.pyc`, 'bytecode');
		put(tmp, `${skill}/stray.pyc`, 'bytecode');
		put(tmp, 'modules/core/compose.json', JSON.stringify({
			origins: ['alpha'], title: 'Core', description: 'synthetic', orientation: 'synthetic',
		}));

		const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'compose-core.mjs'), 'core'], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);

		const files = JSON.parse(fs.readFileSync(path.join(tmp, 'modules/core/compose.json'), 'utf8')).files;
		assert.deepEqual(Object.keys(files).sort(), [
			'skills/transcribing/.gitignore',
			'skills/transcribing/SKILL.md',
			'skills/transcribing/transcribe.py',
		]);
		const landed = path.join(tmp, 'modules/core/skills/transcribing');
		for (const local of ['.venv', '.cache', '.models', '__pycache__', 'stray.pyc']) {
			assert.ok(!fs.existsSync(path.join(landed, local)), `${local} was copied into the composed module`);
		}
		assert.match(r.stdout, /composed 3 files from alpha/);

		const check = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'compose-core.mjs'), '--check', 'core'], { encoding: 'utf8' });
		assert.equal(check.status, 0, `--check disagrees with what compose just wrote:\n${check.stderr}`);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
