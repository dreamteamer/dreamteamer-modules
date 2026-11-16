#!/usr/bin/env node
// The transcriber's node entry: reads the workspace .env (TRANSCRIPTION_HOME, VOICE_PRINTS_HOME,
// HF_HUB_OFFLINE…), sets UV_PROJECT_ENVIRONMENT from it and only then spawns uv in the compiled skill
// folder — uv picks its environment before Python starts, so the variable cannot be set from inside the
// Python code. The skill's own SKILL.md used to ask every shell for an export line; this file is that line.
//
// The verbs that read or name voices also get the recording's CONTEXT (lib/voice-context.mjs): what the
// engine knows that the Python does not read for itself — the meeting, its distinct attendees, the
// workspace's people, the documents written from the transcript, the folders the voice-print store may not
// live in. It is written to a temp file, passed as `--context <file>`, and removed when the child exits —
// also when the entry is interrupted (SIGINT, SIGTERM, SIGHUP: passed to the child, then exit 128+n). A
// record argument (a reference, a bare id or a path) reaches the child as the path of the record's file.
//
//   node <this> sync                                uv sync (the venv)
//   node <this> setup [--speaker-models …]          uv run python transcribe_meeting.py setup … (the models)
//   node <this> verify                              transcribe lib/clip.wav on the CPU; prints the transcript
//   node <this> run <record> <audio> [--engine …]   transcribe, with the record's context
//   node <this> identify <record>… [--question | --shown | --answer | --confirm | --correct | --revert] …
//   node <this> identify --revert --person <ref>    across this workspace's recordings naming the person
//   node <this> prints list | rebuild | forget <person> | never <person> | forget-recording <record> | link <person> | reseed <person>
//   node <this> label <record> [--only <label>]     the developer's listening session (calibration)
//   node <this> evaluate-speakers [plan] [--write …] the developer's evaluation, over every diarised recording
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

const USAGE = 'usage: transcribe.mjs sync | setup [--speaker-models …] | verify'
	+ ' | run <record.md> <audio> [--engine …] [--language …] [--speakers N]'
	+ ' | identify <record>… [--question | --shown | --answer <record> <label>=<answer>… | --confirm <record> [label…] | --correct <record> <label> <person> | --revert <record> | --revert --person <ref>]'
	+ ' | prints list | rebuild | forget <person> | never <person> | forget-recording <record> | link <person> | reseed <person>'
	+ ' | label <record> [--only <label>]'
	+ ' | evaluate-speakers [plan] [--write] [--install-local] [--only …] [--room <record>]';

const root = findWorkspace(process.cwd());
if (!root) { console.error('✖ not inside a dreamteamer workspace (no package.json with its package-lock.json above here) — run from the workspace root'); process.exit(2); }
const dotenv = (() => { try { return Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n').map((l) => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')])); } catch { return {}; } })();
const env = { ...dotenv, ...process.env };
const tilde = (p) => path.resolve(p.trim().replace(/^~(?=$|\/)/, os.homedir()));
const home = env.TRANSCRIPTION_HOME && env.TRANSCRIPTION_HOME.trim() ? tilde(env.TRANSCRIPTION_HOME) : path.join(os.homedir(), '.cache', 'dreamteamer', 'transcription');
env.TRANSCRIPTION_HOME = home;
env.UV_PROJECT_ENVIRONMENT = path.join(home, 'venv');
// The voice-print store: the platform default unless set; a workspace whose .env sets its own has its own store.
if (env.VOICE_PRINTS_HOME && env.VOICE_PRINTS_HOME.trim()) env.VOICE_PRINTS_HOME = tilde(env.VOICE_PRINTS_HOME);
else delete env.VOICE_PRINTS_HOME;

const [verb, ...rest] = process.argv.slice(2);
const VERBS = new Set(['sync', 'setup', 'verify', 'run', 'identify', 'prints', 'label', 'evaluate-speakers']);
if (!VERBS.has(verb)) { console.error(USAGE); process.exit(2); }

const skill = path.join(root, '.dreamteamer', 'skills', 'transcribing-recordings');
if (!fs.existsSync(path.join(skill, 'transcribe_meeting.py'))) { console.error(`✖ the transcribing-recordings skill is not compiled at ${path.relative(root, skill)} — dt compile`); process.exit(1); }
const uv = (args) => spawnSync('uv', args, { cwd: skill, env, stdio: 'inherit' });
const py = (args) => uv(['run', 'python', 'transcribe_meeting.py', ...args]);

/** The flags of each verb that take a value, so a value is never read as a record. */
const VALUE_FLAGS = {
	run: ['--engine', '--language', '--speakers', '--date'],
	identify: ['--person'],
	label: ['--only'],
	'evaluate-speakers': ['--only', '--room'],
	prints: [],
};
/** The positional arguments, as their indexes in `args`. */
function positionals(args, valueFlags) {
	const out = [];
	for (let i = 0; i < args.length; i++) {
		if (valueFlags.includes(args[i])) { i++; continue; }
		if (!args[i].startsWith('--')) out.push(i);
	}
	return out;
}

/** What the child is handed for this verb: the context to write, and the arguments with each record
 *  argument replaced by the path of the record's file. */
async function plan(verbName, args) {
	const vc = await import('../lib/voice-context.mjs');
	const pos = positionals(args, VALUE_FLAGS[verbName] ?? []);
	const out = [...args];
	const recordsAt = async (idx) => {
		const ctx = idx.length === 1 ? await vc.recordingContext(root, args[idx[0]]) : await vc.recordsContext(root, idx.map((i) => args[i]));
		const paths = idx.length === 1 ? [ctx.record_path] : ctx.records.map((c) => c.record_path);
		idx.forEach((i, k) => { out[i] = paths[k]; });
		return ctx;
	};
	let context;
	if (verbName === 'run' || verbName === 'label') context = pos.length ? await recordsAt([pos[0]]) : await vc.baseContext(root);
	else if (verbName === 'evaluate-speakers') context = await vc.diarisedContext(root);
	else if (verbName === 'identify') {
		const p = args.indexOf('--person');
		if (p >= 0 && args[p + 1]) context = await vc.personContext(root, args[p + 1]);
		else {
			// these name ONE record, then labels and answers; --question, --shown and a bare identify name records
			const single = ['--answer', '--confirm', '--correct', '--revert'].some((f) => args.includes(f));
			const idx = single ? pos.slice(0, 1) : pos;
			context = idx.length ? await recordsAt(idx) : await vc.baseContext(root);
		}
	} else if (verbName === 'prints') {
		const [sub, target] = pos.map((i) => args[i]);
		if ((sub === 'forget' || sub === 'never') && target) context = await vc.personContext(root, target);
		else if (sub === 'forget-recording' && target) context = await recordsAt([pos[1]]);
		// rebuild computes the signatures the active model lacks from the workspace's diarised recordings
		else if (sub === 'rebuild') context = await vc.diarisedContext(root);
		else {
			context = await vc.baseContext(root);
			if (target && (sub === 'link' || sub === 'reseed')) context.person = { ref: target, name: context.known[target] ?? null };
		}
	}
	return { context, args: out };
}

/** `transcribe_meeting.py <verb> …` with its context in a temp file, removed once the child has exited. */
async function withContext(verbName, args) {
	if (args.includes('--context')) return py([verbName, ...args]);   // a context the caller wrote
	let planned;
	try { planned = await plan(verbName, args); }
	catch (e) {
		// `run` over a file that is no record of this workspace still transcribes, and its summary says
		// signatures were not kept. Every other verb needs its context.
		if (verbName !== 'run') { console.error(`✖ ${e.message}`); return { status: 1 }; }
		console.error(`⚠ no voice context for ${args[0]} (${e.message}) — transcribing without it`);
		return py([verbName, ...args]);
	}
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-voice-context-'));
	const file = path.join(dir, 'context.json');
	const remove = () => fs.rmSync(dir, { recursive: true, force: true });
	process.on('exit', remove);   // whatever ends this process, the context goes with it
	try {
		fs.writeFileSync(file, JSON.stringify(planned.context ?? {}, null, 2), { mode: 0o600 });
		return await interruptible(['run', 'python', 'transcribe_meeting.py', verbName, ...planned.args, '--context', file]);
	} finally {
		remove();
	}
}

/** uv as a child the entry outlives: SIGINT, SIGTERM or SIGHUP to the entry is passed to the child (a
 *  terminal's Ctrl-C reaches it anyway), the entry waits for it to exit and then exits 128 + the signal's
 *  number — so the `finally` above runs and no context file is left in the temp folder. A second signal
 *  stops waiting. */
function interruptible(args) {
	const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
	return new Promise((resolve) => {
		const child = spawn('uv', args, { cwd: skill, env, stdio: 'inherit' });
		let caught = null;
		const on = (sig) => {
			if (caught) { process.exit(128 + SIGNALS[caught]); }   // the 'exit' listener removes the context
			caught = sig;
			try { child.kill(sig); } catch { /* already gone */ }
		};
		const handlers = Object.keys(SIGNALS).map((sig) => { const h = () => on(sig); process.on(sig, h); return [sig, h]; });
		const done = (status) => { for (const [sig, h] of handlers) process.off(sig, h); resolve({ status }); };
		child.on('error', (e) => { console.error(`✖ uv: ${e.message}`); done(1); });
		child.on('exit', (code, signal) => {
			if (caught) done(128 + SIGNALS[caught]);
			else done(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1));
		});
	});
}

let r;
if (verb === 'sync') r = uv(['sync']);
else if (verb === 'setup') r = py(['setup', ...rest]);
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
} else r = await withContext(verb, rest);
process.exit(r.status ?? 1);
