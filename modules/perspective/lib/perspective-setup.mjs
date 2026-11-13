// The perspective SETUP UNIT (setup contribution, version 1): the Asana personal access token the
// perspective reads tickets with (ASANA_PAT) — in .env, never in a record or a reply. The .env write is an
// ENV ACTION the engine performs (confined, fingerprinted, refused when git would commit .env, never
// printed — cr-dt-007, D61): the unit names the key and its value and declares no apply.
const KEY = 'ASANA_PAT';
const valueOf = (ctx, inputs = {}) => inputs.asana_pat ?? ctx.env?.[KEY];

export function inspect(ctx) {
	const v = ctx.env?.[KEY];
	return { checks: [v && String(v).trim()
		? { id: 'perspective.asana', status: 'configured', title: 'ASANA_PAT', detail: 'set (value never shown); whether Asana accepts it is unverified' }
		: { id: 'perspective.asana', status: 'missing', title: 'ASANA_PAT', detail: 'not set — Asana tickets stay out of the perspective', fix: 'dt setup perspective --input asana_pat=<token>' }] };
}

export function plan(ctx, inputs = {}) {
	const v = valueOf(ctx, inputs);
	const over = { ...ctx, env: { ...ctx.env, ...(v ? { [KEY]: v } : {}) } };
	const action = { id: 'set-asana_pat', title: 'write ASANA_PAT into .env', env: { [KEY]: v ? String(v) : undefined }, state: v ? 'ready' : 'needs-input' };
	return { checks: inspect(over).checks, actions: [action], needs: v ? [] : ['asana_pat'] };
}

export const SETUP_UNIT = Object.freeze({
	id: 'perspective', version: 1,
	inputs: [{ id: 'asana_pat', kind: 'string', env: KEY, required: false, title: 'Asana token', prompt: 'An Asana personal access token (optional; tickets are left out without it)' }],
	inspect, plan,
});
