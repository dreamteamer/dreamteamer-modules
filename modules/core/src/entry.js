// @dreamteamer/core — the extension entry CORE authors (compose.json `extension`). It activates the
// `files` origin's entry (./extension.js, a composed copy: `dt files`) and adds core's own live
// sessions (./sessions/: the session-bindings kind, `dt session`, `dt sessions`, the claim in `dt next`)
// as ONE contribution — the engine loads one entry per package, so the merge happens here.
import activateFiles from './extension.js';
import { activateSessions } from './sessions/index.js';

export const apiVersion = 1;

export default async function activate(api) {
	return mergeContributions([['files', (await activateFiles(api)) ?? {}], ['sessions', activateSessions(api)]]);
}

/** Two contributions as one: maps and lists are joined (a verb, kind or hook both claim refuses, as the
 *  engine refuses two extensions claiming one), functions are called in turn and their results joined,
 *  orientation paragraphs are joined. Pure; exported for the test. */
export function mergeContributions(parts) {
	const out = {};
	const owner = new Map();
	const claim = (what, key, by) => {
		const prev = owner.get(`${what}:${key}`);
		if (prev) throw new Error(`@dreamteamer/core: ${by} and ${prev} both contribute the ${what} "${key}"`);
		owner.set(`${what}:${key}`, by);
	};
	for (const [by, c] of parts) {
		for (const [verb, cmd] of Object.entries(c.commands ?? {})) { claim('command', verb, by); (out.commands ??= {})[verb] = cmd; }
		for (const [event, verb] of Object.entries(c.hooks ?? {})) { claim('hook', event, by); (out.hooks ??= {})[event] = verb; }
		for (const k of c.sourceKinds ?? []) { claim('kind', typeof k === 'string' ? k : k.kind, by); (out.sourceKinds ??= []).push(k); }
		for (const [id, render] of Object.entries(c.harnesses ?? {})) { claim('harness', id, by); (out.harnesses ??= {})[id] = render; }
	}
	const fns = (key) => parts.map(([, c]) => c[key]).filter((f) => typeof f === 'function');
	const lists = async (key, ctx) => (await Promise.all(fns(key).map((f) => f(ctx)))).flatMap((r) => r ?? []);
	if (fns('check').length) out.check = (ctx) => lists('check', ctx);
	if (fns('doctor').length) out.doctor = (ctx) => lists('doctor', ctx);
	// `next` is synchronous by contract — `dt next` is a sync verb
	if (fns('next').length) out.next = (ctx) => fns('next').flatMap((f) => f(ctx) ?? []);
	if (fns('analyze').length) out.analyze = (draft) => {
		const r = { errors: [], warnings: [], notes: [] };
		for (const f of fns('analyze')) { const x = f(draft) ?? {}; for (const k of Object.keys(r)) r[k].push(...(x[k] ?? [])); }
		return r;
	};
	const orient = parts.map(([, c]) => c.orientation).filter((o) => o != null);
	if (orient.length) out.orientation = (ctx) => orient.map((o) => (typeof o === 'function' ? o(ctx) : o)).filter((p) => typeof p === 'string' && p.trim()).join('\n');
	return out;
}
