// The perspective SETUP UNIT (setup contribution, version 1): the Asana personal access token the perspective reads tickets with (ASANA_PAT) — in .env, never in a record or a reply.
// The one write is to the workspace .env — scoped, fingerprinted, refused when git would commit it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SetupRefusal, redact, fingerprint, writeScoped, envAssignments, setEnvValue, safeEnvValue, gitExposure, runGit, leftoverTemps, tempPrefix } from './setup-kit.mjs';

const KEY = 'ASANA_PAT';
const expand = (p) => (p && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p);
const valueOf = (ctx, inputs = {}) => inputs.asana_pat ?? ctx.env?.[KEY];

export function inspect(ctx) {
	const v = ctx.env?.[KEY];
	return { checks: [v && String(v).trim()
		? { id: 'perspective.asana', status: 'configured', title: 'ASANA_PAT', detail: 'set (value never shown); whether Asana accepts it is unverified' }
		: { id: 'perspective.asana', status: 'missing', title: 'ASANA_PAT', detail: 'not set — Asana tickets stay out of the perspective', fix: 'dt setup perspective --input asana_pat=<token>' }] };
}

function setAction(ctx, inputs) {
	const action = { id: 'set-asana_pat', title: 'write ASANA_PAT into .env', effects: [{ kind: 'workspace-files', detail: '.env: ASANA_PAT only, every other line kept' }], runBy: 'engine' };
	const v = valueOf(ctx, inputs);
	if (!v) return { ...action, state: 'needs-input', reason: 'asana_pat is required' };
	const envPath = path.join(ctx.root, '.env');
	let expect;
	try { expect = fingerprint(envPath); } catch (e) { return { ...action, state: 'blocked', reason: e instanceof SetupRefusal ? e.message : 'the .env file cannot be read' }; }
	if (leftoverTemps(envPath).length) return { ...action, state: 'blocked', reason: `temporary files from an interrupted write sit beside .env (${tempPrefix(envPath)}*.tmp) — review and delete them first` };
	const exposure = gitExposure(ctx.root, '.env', { git: runGit });
	if (!exposure.safe) return { ...action, state: 'blocked', reason: exposure.reason };
	const text = expect === 'absent' ? '' : fs.readFileSync(envPath, 'utf8');
	if (!safeEnvValue(String(v))) return { ...action, state: 'blocked', reason: `${KEY}: a value with characters this action does not write — set it by hand` };
	const found = envAssignments(text, KEY);
	if (found.length > 1) return { ...action, state: 'blocked', reason: `${KEY} is assigned more than once in .env — resolve that by hand first` };
	if (found[0]?.value === String(v)) return { ...action, state: 'done', reason: `${KEY} already holds this value` };
	return { ...action, state: 'ready', expect, preview: { file: '.env', expect, sets: [KEY], keeps: 'every other line' }, content: setEnvValue(text, KEY, String(v)) };
}

export function plan(ctx, inputs = {}) {
	const { content, ...action } = setAction(ctx, inputs);
	const over = { ...ctx, env: { ...ctx.env, ...(valueOf(ctx, inputs) ? { [KEY]: valueOf(ctx, inputs) } : {}) } };
	return { checks: inspect(over).checks, actions: [action], needs: valueOf(ctx, inputs) ? [] : ['asana_pat'] };
}

export function apply(ctx, action, inputs = {}) {
	try {
		if (action.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${action.reason ?? 'already set'}` };
		if (action.id !== 'set-asana_pat') return { ok: false, changed: [], message: `unknown action ${action.id}` };
		const now = setAction(ctx, inputs);
		if (now.state === 'done') return { ok: true, changed: [], message: `nothing to do — ${now.reason}` };
		if (now.state !== 'ready') return { ok: false, changed: [], message: now.reason };
		if (now.expect !== action.expect) return { ok: false, changed: [], message: '.env changed after the preview — nothing was written; plan again' };
		writeScoped({ root: ctx.root, rel: '.env', content: now.content, expected: now.expect, recheck: () => { const g = gitExposure(ctx.root, '.env', { git: runGit }); if (!g.safe) throw new SetupRefusal('blocked', g.reason); } });
		return { ok: true, changed: ['.env'], message: `wrote .env (${KEY})` };
	} catch (error) {
		return { ok: false, changed: [], message: error instanceof SetupRefusal ? error.message : redact(error.message) };
	}
}

export const SETUP_UNIT = Object.freeze({
	id: 'perspective', version: 1,
	inputs: [{ id: 'asana_pat', kind: 'string', env: KEY, required: false, title: 'Asana token', prompt: 'An Asana personal access token (optional; tickets are left out without it)' }],
	inspect, plan, apply,
});
