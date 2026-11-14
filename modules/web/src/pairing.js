// Pairing codes (cr-modules-017 §1): what `dt web open` hands the pane — a single-use code, refused 60 seconds after
// it is minted, carrying the route the page lands on and an optional level cap for the session it becomes. Held in
// this process's memory only: a code minted before a restart is refused after it.
import crypto from 'node:crypto';

export const PAIR_TTL_MS = 60_000;

/** @returns {{ mint(o?: { route?: string, cap?: 'read'|'edit'|'admin'|null }): string, take(code: string): { route: string, cap: string|null } | null }} */
export function createPairing({ ttlMs = PAIR_TTL_MS, now = Date.now } = {}) {
	const codes = new Map();
	const prune = (t) => { for (const [c, v] of codes) if (t - v.at >= ttlMs) codes.delete(c); };
	return {
		mint({ route = '/', cap = null } = {}) {
			const t = now();
			prune(t);
			const code = crypto.randomBytes(24).toString('base64url');
			codes.set(code, { route, cap, at: t });
			return code;
		},
		take(code) {
			if (typeof code !== 'string' || !codes.has(code)) return null;
			const v = codes.get(code);
			codes.delete(code);
			if (now() - v.at >= ttlMs) return null;
			return { route: v.route, cap: v.cap };
		},
	};
}
