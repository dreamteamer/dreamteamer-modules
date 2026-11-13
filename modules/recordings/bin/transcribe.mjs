#!/usr/bin/env node
// The transcriber's node entry: reads the workspace .env (TRANSCRIPTION_HOME, HF_HUB_OFFLINE…), sets
// UV_PROJECT_ENVIRONMENT from it and only then spawns uv in the compiled skill folder — uv picks its
// environment before Python starts, so the variable cannot be set from inside the Python code. The
// skill's own SKILL.md used to ask every shell for an export line; this file is that line.
//
//   node <this> sync                      uv sync (the venv)
//   node <this> setup                     uv run python transcribe_meeting.py setup (the models)
//   node <this> verify                    transcribe lib/clip.wav on the CPU; prints the transcript
//   node <this> run <record.md> <audio> … uv run python transcribe_meeting.py run …
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

const root = findWorkspace(process.cwd());
const dotenv = (() => { try { return Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n').map((l) => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')])); } catch { return {}; } })();
const env = { ...dotenv, ...process.env };
const home = env.TRANSCRIPTION_HOME && env.TRANSCRIPTION_HOME.trim() ? path.resolve(env.TRANSCRIPTION_HOME.replace(/^~(?=$|\/)/, os.homedir())) : path.join(os.homedir(), '.cache', 'dreamteamer', 'transcription');
env.TRANSCRIPTION_HOME = home;
env.UV_PROJECT_ENVIRONMENT = path.join(home, 'venv');
const skill = path.join(root, '.dreamteamer', 'skills', 'transcribing-recordings');
if (!fs.existsSync(path.join(skill, 'transcribe_meeting.py'))) { console.error(`✖ the transcribing-recordings skill is not compiled at ${path.relative(root, skill)} — dt compile`); process.exit(1); }
const uv = (args) => spawnSync('uv', args, { cwd: skill, env, stdio: 'inherit' });
const [verb, ...rest] = process.argv.slice(2);
let r;
if (verb === 'sync') r = uv(['sync']);
else if (verb === 'setup') r = uv(['run', 'python', 'transcribe_meeting.py', 'setup']);
else if (verb === 'run') r = uv(['run', 'python', 'transcribe_meeting.py', 'run', ...rest]);
else if (verb === 'verify') {
	// a throwaway recording record in a temp folder, the shipped clip, the CPU engine; the transcript is
	// read back off the record and printed — the unit keeps it as the receipt
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-recordings-verify-'));
	const record = path.join(dir, 'clip.recording.md');
	fs.writeFileSync(record, '---\nname: synthetic clip\ndate: 2026-01-01\n---\n');
	const clip = fileURLToPath(new URL('../lib/clip.wav', import.meta.url));
	const p = spawnSync('uv', ['run', 'python', 'transcribe_meeting.py', 'run', record, clip, '--engine', 'cpu', '--language', 'en', '--speakers', '1'], { cwd: skill, env, encoding: 'utf8' });
	if (p.status !== 0) { process.stderr.write(p.stderr ?? ''); process.exit(p.status ?? 1); }
	const text = fs.readFileSync(record, 'utf8');
	const body = text.split(/\n---\n/).slice(1).join('\n---\n').trim() || text;
	process.stdout.write(body.replace(/\s+/g, ' ').trim() + '\n');
	fs.rmSync(dir, { recursive: true, force: true });
	r = { status: 0 };
} else { console.error('usage: transcribe.mjs sync | setup | verify | run <record.md> <audio> [--engine …] [--language …] [--speakers N]'); process.exit(2); }
process.exit(r.status ?? 1);
