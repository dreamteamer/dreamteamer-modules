// The recordings SETUP UNIT — what `dt install`, `dt setup` and `dt status` drive (setup contribution,
// version 1). It owns the machine side of offline transcription: where the models and the venv live
// (TRANSCRIPTION_HOME, outside the workspace and outside node_modules, so neither compile nor npm
// wipes them), the two folders the recordings pipeline reads (FILES_FOLDER, INBOX_FOLDERS), the two
// tools it needs on PATH (ffmpeg, uv), and the one live proof that counts: a CPU transcription of a
// shipped synthetic clip (`lib/clip.wav`, generated speech, nobody's voice) that leaves a dated receipt.
//
// Every command runs through `bin/transcribe.mjs`, the node entry that reads the workspace `.env`, sets
// UV_PROJECT_ENVIRONMENT from TRANSCRIPTION_HOME and only then spawns uv — uv picks its environment
// before Python starts, so the variable cannot come from inside the Python code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SetupRefusal, redact, fingerprint, writeScoped, envAssignments, setEnvValue, safeEnvValue, gitExposure, runGit, leftoverTemps, tempPrefix } from './setup-kit.mjs';

export const UNIT_ID = 'recordings';
const DEFAULT_HOME = path.join(os.homedir(), '.cache', 'dreamteamer', 'transcription');
const KEYS = ['TRANSCRIPTION_HOME', 'FILES_FOLDER', 'INBOX_FOLDERS'];
const RECEIPT = 'cpu-run.verified.json';
/** The three model paths the CPU pass needs; the ggml weights (Apple Silicon + whisper-cli only) are evidence, never required. */
const MODELS = (home) => ({ 'whisper-ct2': path.join(home, 'models', 'whisper-ct2'), 'segmentation.onnx': path.join(home, 'models', 'diarization', 'segmentation.onnx'), 'embedding.onnx': path.join(home, 'models', 'diarization', 'embedding.onnx') });

const onPath = (env, bin) => (env.PATH ?? '').split(path.delimiter).some((d) => { if (!d) return false; try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return fs.statSync(path.join(d, bin)).isFile(); } catch { return false; } });
const expand = (p) => (p && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p);
const homeOf = (ctx, inputs = {}) => expand(inputs.transcription_home ?? ctx.env.TRANSCRIPTION_HOME ?? DEFAULT_HOME);
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
/** Whether a file of that name sits anywhere under the folder (the hub cache nests the weights a few levels down) — a half-downloaded model folder holds none. */
const holds = (dir, name, depth = 6) => { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isFile() && e.name === name) return true; if (e.isDirectory() && depth > 0 && holds(path.join(dir, e.name), name, depth - 1)) return true; } } catch { /* absent */ } return false; };
const newest = (paths) => Math.max(0, ...paths.filter(exists).map((p) => fs.statSync(p).mtimeMs));
const receiptOf = (ctx) => { try { return JSON.parse(fs.readFileSync(path.join(ctx.receiptDir, RECEIPT), 'utf8')); } catch { return null; } };
/** This module's node entry, resolved from where this unit was loaded (the package, or a composed copy), relative to the workspace. */
function entry(root) {
	const own = ['../bin/recordings-transcribe.mjs', '../bin/transcribe.mjs'].map((rel) => fileURLToPath(new URL(rel, import.meta.url))).find((f) => fs.existsSync(f));
	return own ? path.relative(root, own).split(path.sep).join('/') : null;
}
const clip = () => fileURLToPath(new URL('./clip.wav', import.meta.url));

export function inspect(ctx) {
	const env = ctx.env ?? {};
	const home = homeOf(ctx);
	const checks = [];
	const missingTools = ['ffmpeg', 'uv'].filter((b) => !onPath(env, b));
	checks.push(missingTools.length
		? { id: 'recordings.tools', status: 'blocked', title: 'ffmpeg and uv', detail: `${missingTools.join(' and ')} not on PATH`, fix: `install ${missingTools.join(' and ')} (macOS: brew install ${missingTools.join(' ')})` }
		: { id: 'recordings.tools', status: 'configured', title: 'ffmpeg and uv', detail: 'both on PATH' });
	// the two folders transcription cannot do without gate the check; INBOX_FOLDERS is optional and only noted
	const unset = ['TRANSCRIPTION_HOME', 'FILES_FOLDER'].filter((k) => !env[k] || String(env[k]).trim() === '');
	const inbox = env.INBOX_FOLDERS && String(env.INBOX_FOLDERS).trim() ? 'INBOX_FOLDERS set' : 'INBOX_FOLDERS unset (optional: nothing is ingested from an inbox)';
	checks.push(unset.length
		? { id: 'recordings.home', status: 'missing', title: 'folders', detail: `${unset.join(', ')} not set`, fix: 'dt setup recordings' }
		: { id: 'recordings.home', status: 'configured', title: 'folders', detail: `TRANSCRIPTION_HOME and FILES_FOLDER set · ${inbox}`, evidence: { home: path.basename(home) } });
	checks.push(exists(path.join(home, 'venv', 'bin', 'python'))
		? { id: 'recordings.venv', status: 'configured', title: 'python venv', detail: 'present under TRANSCRIPTION_HOME' }
		: { id: 'recordings.venv', status: 'missing', title: 'python venv', detail: 'not provisioned', fix: 'dt setup recordings --allow machine' });
	const models = MODELS(home);
	const absent = Object.keys(models).filter((k) => (k === 'whisper-ct2' ? !holds(models[k], 'model.bin') : !exists(models[k])));
	checks.push(absent.length
		? { id: 'recordings.models', status: 'missing', title: 'models', detail: `${absent.join(', ')} not downloaded`, fix: 'dt setup recordings --allow download' }
		: { id: 'recordings.models', status: 'configured', title: 'models', detail: 'the CPU pass\'s weights are on disk', evidence: { ggml: exists(path.join(home, 'models', 'whisper-ggml')) } });
	const receipt = receiptOf(ctx);
	const fresh = receipt && new Date(receipt.atMs ?? 0).getTime() >= newest(Object.values(models));
	checks.push(fresh
		? { id: 'recordings.cpu-run', status: 'ready', title: 'CPU run', detail: 'the synthetic clip transcribed on this computer', evidence: { at: receipt.at } }
		: { id: 'recordings.cpu-run', status: 'unverified', title: 'CPU run', detail: receipt ? 'the receipt predates the models' : 'never ran', fix: 'dt setup recordings --verify --allow machine' });
	return { checks };
}

function homeAction(ctx, inputs) {
	const action = { id: 'set-home', title: 'write TRANSCRIPTION_HOME, FILES_FOLDER and INBOX_FOLDERS into .env', effects: [{ kind: 'workspace-files', detail: '.env: the three keys only, every other line kept' }], runBy: 'engine' };
	const want = { TRANSCRIPTION_HOME: inputs.transcription_home ?? ctx.env.TRANSCRIPTION_HOME ?? DEFAULT_HOME, FILES_FOLDER: inputs.files_folder ?? ctx.env.FILES_FOLDER, INBOX_FOLDERS: inputs.inbox_folders ?? ctx.env.INBOX_FOLDERS };
	const needs = Object.entries(want).filter(([, v]) => !v).map(([k]) => k);
	if (needs.includes('FILES_FOLDER')) return { ...action, state: 'needs-input', reason: 'files_folder is required' };
	const envPath = path.join(ctx.root, '.env');
	let expect;
	try { expect = fingerprint(envPath); } catch (e) { return { ...action, state: 'blocked', reason: e instanceof SetupRefusal ? e.message : 'the .env file cannot be read' }; }
	if (leftoverTemps(envPath).length) return { ...action, state: 'blocked', reason: `temporary files from an interrupted write sit beside .env (${tempPrefix(envPath)}*.tmp) — review and delete them first` };
	const exposure = gitExposure(ctx.root, '.env', { git: runGit });
	if (!exposure.safe) return { ...action, state: 'blocked', reason: exposure.reason };
	let text = expect === 'absent' ? '' : fs.readFileSync(envPath, 'utf8');
	const changes = [];
	for (const [k, v] of Object.entries(want)) {
		if (!v) continue;
		if (!safeEnvValue(String(v))) return { ...action, state: 'blocked', reason: `${k}: a value with characters this action does not write — set it by hand` };
		const found = envAssignments(text, k);
		if (found.length > 1) return { ...action, state: 'blocked', reason: `${k} is assigned more than once in .env — resolve that by hand first` };
		if (found[0]?.value === String(v)) continue;
		changes.push(k);
		text = setEnvValue(text, k, String(v));
	}
	if (!changes.length) return { ...action, state: 'done', reason: 'the three keys already hold these values' };
	return { ...action, state: 'ready', expect, preview: { file: '.env', expect, sets: changes, keeps: 'every other line' }, content: text };
}

/** The inputs laid over the environment — the plan judges the home the person named, not the one .env holds yet. */
const withInputs = (ctx, inputs = {}) => ({ ...ctx, env: { ...ctx.env, ...(inputs.transcription_home ? { TRANSCRIPTION_HOME: inputs.transcription_home } : {}), ...(inputs.files_folder ? { FILES_FOLDER: inputs.files_folder } : {}), ...(inputs.inbox_folders ? { INBOX_FOLDERS: inputs.inbox_folders } : {}) } });

export function plan(ctx, inputs = {}) {
	const { checks } = inspect(withInputs(ctx, inputs));
	const status = Object.fromEntries(checks.map((c) => [c.id, c.status]));
	const home = homeOf(ctx, inputs);
	const { content, ...setHome } = homeAction(ctx, inputs);
	const bin = entry(ctx.root);
	const tools = status['recordings.tools'] === 'configured';
	const gate = (ok, reason) => (ok ? {} : { state: 'blocked', reason });
	const actions = [
		setHome,
		{ id: 'provision-venv', title: 'provision the pinned Python venv (uv sync)', effects: [{ kind: 'machine', detail: `${home}/venv — a Python environment from the skill's uv.lock` }], runBy: 'engine', command: bin ? ['node', bin, 'sync'] : null, state: status['recordings.venv'] === 'configured' ? 'done' : 'ready', ...gate(tools, 'ffmpeg and uv must be on PATH first') },
		{ id: 'download-models', title: 'download the transcription models (~1.6 GB)', effects: [{ kind: 'download', detail: `${home}/models — the CPU pass's weights from the sources the skill names` }], runBy: 'engine', command: bin ? ['node', bin, 'setup'] : null, state: status['recordings.models'] === 'configured' ? 'done' : 'ready', ...gate(tools && status['recordings.venv'] === 'configured', 'the venv first') },
		{ id: 'verify-cpu', title: 'transcribe the synthetic clip on the CPU and keep the receipt', kind: 'verify', effects: [{ kind: 'machine', detail: 'one CPU transcription of lib/clip.wav; writes the receipt under .dreamteamer/setup/recordings/' }], runBy: 'engine', command: bin ? ['node', bin, 'verify'] : null, state: status['recordings.cpu-run'] === 'ready' ? 'done' : 'ready', ...gate(tools && status['recordings.venv'] === 'configured' && status['recordings.models'] === 'configured', 'the venv and the models first') },
	];
	const needs = inputs.files_folder || ctx.env.FILES_FOLDER ? [] : ['files_folder'];
	return { checks, actions, needs };
}

export function apply(ctx, action, inputs = {}) {
	try {
		if (action.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${action.reason ?? 'already done'}` };
		if (action.state && action.state !== 'ready') return { ok: false, changed: [], message: action.reason ?? action.state };
		if (action.id === 'set-home') {
			const now = homeAction(ctx, inputs);
			if (now.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${now.reason}` };
			if (now.state !== 'ready') return { ok: false, changed: [], message: now.reason };
			if (now.expect !== action.expect) return { ok: false, changed: [], message: '.env changed after the preview — nothing was written; plan again' };
			writeScoped({ root: ctx.root, rel: '.env', content: now.content, expected: now.expect, recheck: () => { const g = gitExposure(ctx.root, '.env', { git: runGit }); if (!g.safe) throw new SetupRefusal('blocked', g.reason); } });
			return { ok: true, changed: ['.env'], message: `wrote .env (${now.preview.sets.join(', ')})` };
		}
		if (!action.command) return { ok: false, changed: [], message: 'this module\'s node entry is not installed' };
		const env = { ...withInputs(ctx, inputs).env, TRANSCRIPTION_HOME: homeOf(ctx, inputs) };
		const r = spawnSync(process.execPath, action.command.slice(1), { cwd: ctx.root, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 3_600_000 });
		if (r.status !== 0) return { ok: false, changed: [], message: redact(`${action.command.slice(0, 3).join(' ')} exited ${r.status ?? r.error?.message}: ${(r.stderr ?? '').trim().split('\n').at(-1) ?? ''}`) };
		if (action.id === 'verify-cpu') {
			const transcript = (r.stdout ?? '').trim();
			// the recognizer may split the made-up word ("dream teamer"); either spelling is the clip heard
			if (!/dream\s*-?\s*teamer/i.test(transcript)) return { ok: false, changed: [], message: `the clip transcribed to ${JSON.stringify(transcript.slice(0, 80))} — "dreamteamer" was not heard; the models or the run are not right` };
			fs.mkdirSync(ctx.receiptDir, { recursive: true });
			const file = path.join(ctx.receiptDir, RECEIPT);
			fs.writeFileSync(file, JSON.stringify({ what: 'the synthetic clip transcribed on the CPU', clip: 'lib/clip.wav', transcript, engine: 'cpu', at: new Date().toISOString().slice(0, 10), atMs: Date.now() }, null, 2) + '\n');
			return { ok: true, changed: [file], message: 'transcribed on the CPU — receipt written' };
		}
		return { ok: true, changed: [], message: `${action.id}: done` };
	} catch (error) {
		return { ok: false, changed: [], message: error instanceof SetupRefusal ? error.message : redact(error.message) };
	}
}

export const SETUP_UNIT = Object.freeze({
	id: UNIT_ID, version: 1,
	inputs: [
		{ id: 'transcription_home', kind: 'path', env: 'TRANSCRIPTION_HOME', required: false, default: DEFAULT_HOME, title: 'transcription home', prompt: 'Where should the transcription models and venv live (outside the workspace)?' },
		{ id: 'files_folder', kind: 'path', env: 'FILES_FOLDER', required: true, title: 'files folder', prompt: 'The folder recordings and documents are archived under (FILES_FOLDER)' },
		{ id: 'inbox_folders', kind: 'string', env: 'INBOX_FOLDERS', required: false, title: 'inbox folders', prompt: 'Inbox roots new recordings land in (INBOX_FOLDERS), comma-separated' },
	],
	inspect, plan, apply,
});
