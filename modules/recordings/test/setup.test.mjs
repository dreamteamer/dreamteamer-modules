// The recordings SETUP UNIT — pure, with a fake home and PATH; and through the engine under test with
// stand-in uv and ffmpeg (no download, no venv, no network) in a virgin workspace, offline.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SETUP_UNIT } from '../lib/recordings-setup.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets, closure } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const tmp = (p = 'dtm-rec-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
/** A PATH holding only the named stand-ins (and nothing else), each a shell script that creates what the checks look for. */
function fakeBins(names) {
	const dir = tmp('dtm-bin-');
	for (const n of names) {
		fs.writeFileSync(path.join(dir, n), n === 'uv'
			? '#!/bin/sh\ncase "$1" in sync) mkdir -p "$UV_PROJECT_ENVIRONMENT/bin" && : > "$UV_PROJECT_ENVIRONMENT/bin/python" && chmod +x "$UV_PROJECT_ENVIRONMENT/bin/python";; run) case "$*" in *setup*) mkdir -p "$TRANSCRIPTION_HOME/models/whisper-ct2" "$TRANSCRIPTION_HOME/models/diarization" && : > "$TRANSCRIPTION_HOME/models/whisper-ct2/model.bin" && : > "$TRANSCRIPTION_HOME/models/diarization/segmentation.onnx" && : > "$TRANSCRIPTION_HOME/models/diarization/embedding.onnx";; *" run "*) rec="$5"; printf "%s\\n%s\\n" "$(cat "$rec")" "testing one two three, this is a dreamteamer check" > "$rec";; esac;; esac; exit 0\n'
			: '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	}
	return dir;
}
function repo() {
	const root = tmp();
	execFileSync('git', ['init', '-q'], { cwd: root });
	fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
	return root;
}
const ctxFor = (root, env) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'recordings') });

describe('the unit, pure', () => {
	test('inputs: transcription_home defaulted, files_folder required, inbox_folders optional; version 1', () => {
		assert.deepEqual(SETUP_UNIT.inputs.map((i) => [i.id, i.kind, i.env, i.required]), [['transcription_home', 'path', 'TRANSCRIPTION_HOME', false], ['files_folder', 'path', 'FILES_FOLDER', true], ['inbox_folders', 'string', 'INBOX_FOLDERS', false]]);
		assert.equal(SETUP_UNIT.version, 1);
	});
	test('no ffmpeg → blocked naming it; tools present but nothing else → every check missing, the run unverified', () => {
		const root = repo(), home = tmp('dtm-home-');
		const without = SETUP_UNIT.inspect(ctxFor(root, { PATH: fakeBins(['uv']), TRANSCRIPTION_HOME: home })).checks;
		assert.equal(without.find((c) => c.id === 'recordings.tools').status, 'blocked');
		assert.match(without.find((c) => c.id === 'recordings.tools').detail, /ffmpeg not on PATH/);
		const checks = SETUP_UNIT.inspect(ctxFor(root, { PATH: fakeBins(['uv', 'ffmpeg']), TRANSCRIPTION_HOME: home })).checks;
		assert.deepEqual(checks.map((c) => [c.id, c.status]), [['recordings.tools', 'configured'], ['recordings.home', 'missing'], ['recordings.venv', 'missing'], ['recordings.models', 'missing'], ['recordings.cpu-run', 'unverified']]);
	});
	test('plan gates the machine steps on the tools, the download on the venv, the verify on both; set-home writes the keys and is idempotent', () => {
		const root = repo(), home = tmp('dtm-home-'), files = tmp('dtm-files-');
		const ctx = ctxFor(root, { PATH: fakeBins(['uv', 'ffmpeg']), TRANSCRIPTION_HOME: home });
		const p = SETUP_UNIT.plan(ctx, { transcription_home: home, files_folder: files });
		const by = Object.fromEntries(p.actions.map((a) => [a.id, a]));
		assert.equal(by['set-home'].state, 'ready');
		assert.deepEqual(by['set-home'].effects.map((e) => e.kind), ['workspace-files']);
		assert.equal(by['provision-venv'].state, 'ready'); assert.deepEqual(by['provision-venv'].effects.map((e) => e.kind), ['machine']);
		assert.equal(by['download-models'].state, 'blocked'); assert.deepEqual(by['download-models'].effects.map((e) => e.kind), ['download']);
		assert.equal(by['verify-cpu'].state, 'blocked'); assert.equal(by['verify-cpu'].kind, 'verify');
		assert.deepEqual(p.needs, []);
		assert.deepEqual(SETUP_UNIT.plan(ctx, {}).needs, ['files_folder']);
		const r = SETUP_UNIT.apply(ctx, by['set-home'], { transcription_home: home, files_folder: files });
		assert.equal(r.ok, true, r.message);
		const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
		const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		assert.match(text, new RegExp(`^TRANSCRIPTION_HOME="?${esc(home)}"?$`, 'm'));
		assert.match(text, new RegExp(`^FILES_FOLDER="?${esc(files)}"?$`, 'm'));
		const again = SETUP_UNIT.plan({ ...ctx, env: { ...ctx.env, FILES_FOLDER: files } }, { transcription_home: home, files_folder: files }).actions.find((a) => a.id === 'set-home');
		assert.equal(again.state, 'done');
	});
	test('the receipt makes the CPU run ready, unless it predates the models', () => {
		const root = repo(), home = tmp('dtm-home-');
		const ctx = ctxFor(root, { PATH: fakeBins(['uv', 'ffmpeg']), TRANSCRIPTION_HOME: home, FILES_FOLDER: root, INBOX_FOLDERS: root });
		for (const rel of ['venv/bin/python', 'models/whisper-ct2/model.bin', 'models/diarization/segmentation.onnx', 'models/diarization/embedding.onnx']) { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), ''); }
		fs.mkdirSync(ctx.receiptDir, { recursive: true });
		fs.writeFileSync(path.join(ctx.receiptDir, 'cpu-run.verified.json'), JSON.stringify({ at: '2026-11-13', atMs: Date.now() + 1000 }));
		const ready = SETUP_UNIT.inspect(ctx).checks;
		assert.ok(ready.every((c) => ['ready', 'configured'].includes(c.status)), JSON.stringify(ready.map((c) => [c.id, c.status])));
		assert.equal(ready.find((c) => c.id === 'recordings.cpu-run').evidence.at, '2026-11-13');
		fs.writeFileSync(path.join(ctx.receiptDir, 'cpu-run.verified.json'), JSON.stringify({ at: '2020-01-01', atMs: 0 }));
		assert.equal(SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'recordings.cpu-run').status, 'unverified');
	});
	test('a model folder without its weights (an interrupted download) reads missing, and the download is offered again', () => {
		const root = repo(), home = tmp('dtm-home-');
		const ctx = ctxFor(root, { PATH: fakeBins(['uv', 'ffmpeg']), TRANSCRIPTION_HOME: home, FILES_FOLDER: root });
		for (const rel of ['venv/bin/python', 'models/whisper-ct2/models--x/snapshots/1/model.bin', 'models/diarization/segmentation.onnx', 'models/diarization/embedding.onnx']) { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), ''); }
		assert.equal(SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'recordings.models').status, 'configured', 'the weights nested as the hub cache nests them');
		fs.rmSync(path.join(home, 'models/whisper-ct2/models--x/snapshots/1/model.bin'));
		const row = SETUP_UNIT.inspect(ctx).checks.find((c) => c.id === 'recordings.models');
		assert.equal(row.status, 'missing'); assert.match(row.detail, /whisper-ct2/);
		assert.equal(SETUP_UNIT.plan(ctx, { files_folder: root }).actions.find((a) => a.id === 'download-models').state, 'ready');
	});
	test('the transcriber entry outside a workspace says so in one line, exit 2 — no stack trace', () => {
		const nowhere = tmp('dtm-nowhere-');
		const r = spawnSync(process.execPath, [new URL('../bin/transcribe.mjs', import.meta.url).pathname, 'sync'], { cwd: nowhere, encoding: 'utf8' });
		assert.equal(r.status, 2);
		assert.match(r.stderr, /not inside a dreamteamer workspace/);
		assert.doesNotMatch(r.stderr, /TypeError|at Object/);
	});
});

describe('through the engine', { skip: !engineMeets('recordings') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('install with --allow download --allow machine provisions through the stand-ins; --verify writes the receipt; status reads ready · verified; blocked without ffmpeg', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), ...closure('recordings'));
		const home = tmp('dtm-home-'), files = tmp('dtm-files-');
		const bins = fakeBins(['uv', 'ffmpeg']);
		// HOME is a temp dir: the default transcription home must never be the machine's own
		const env = { PATH: `${bins}:${process.env.PATH}`, HOME: tmp('dtm-HOME-') };
		const r = run(root, ['install', '@dreamteamer/recordings', '--from', from, '--input', `transcription_home=${home}`, '--input', `files_folder=${files}`, '--allow', 'download', '--allow', 'machine', '--no-input'], env);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /✔ set-home — wrote \.env/);
		assert.match(r.stdout, /✔ provision-venv/); assert.match(r.stdout, /✔ download-models/);
		assert.ok(fs.existsSync(path.join(home, 'venv', 'bin', 'python')) && fs.existsSync(path.join(home, 'models', 'whisper-ct2', 'model.bin')), 'the stand-ins made what the checks look for');
		assert.match(run(root, ['status'], env).stdout, /recordings\s+configured\s+CPU run unverified/);
		const v = run(root, ['setup', 'recordings', '--verify', '--allow', 'machine', '--no-input'], env);
		assert.equal(v.status, 0, v.stderr + v.stdout);
		assert.match(v.stdout, /✔ recordings: ready · verified \d{4}-\d{2}-\d{2}/);
		assert.match(run(root, ['status'], env).stdout, /recordings\s+ready · verified/);
		assert.match(run(root, ['status'], { ...env, PATH: fakeBins(['uv']) }).stdout, /recordings\s+blocked\s+ffmpeg and uv — ffmpeg not on PATH/);
	});
});
