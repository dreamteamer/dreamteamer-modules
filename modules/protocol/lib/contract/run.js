// The contract runner: every case against ONE host, in order, on one fixture (writes accumulate, so the
// order in cases.js is part of the contract). A host is a function `request(method, path, body)` that
// resolves `{ status, body }` — the extension's in-process handler, or an HTTP client of dt serve.
import { cases } from './cases.js';

/**
 * @param {{ request: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: any }>,
 *           fixture: { root: string, layer: string, git: Function, head: () => string }, only?: string[] }} opts
 * @returns {Promise<{ passed: string[], failed: Array<{ id: string, why: string }> }>}
 */
export async function runContract({ request, fixture, only }) {
	const passed = [];
	const failed = [];
	const ctx = { fixture, request, state: {} };
	for (const c of cases) {
		if (only && !only.includes(c.id)) continue;
		try {
			const snap = c.before ? await c.before(ctx) : undefined;
			const path = typeof c.path === 'function' ? c.path(ctx) : c.path;
			const body = typeof c.body === 'function' ? c.body(ctx) : c.body;
			const res = await request(c.method, path, body);
			await c.expect(res, ctx, snap);
			passed.push(c.id);
		} catch (e) {
			failed.push({ id: c.id, why: String(e?.message ?? e).split('\n')[0] });
		}
	}
	return { passed, failed };
}

export { cases };
