// Sessions (cr-modules-017 §2, as the security sign-off revised it): a random sid in an HttpOnly SameSite=Strict
// browser-session cookie (no Max-Age). The server holds the sessions in its MEMORY only — never in the state file — so
// a restart, an idle stop or a reboot signs the pane out, and the next `dt web open` pairs it again. A session is
// STATIC — the same sid for its whole life, never rotated — and ends after 7 idle days; each use renews `seen`.
import crypto from 'node:crypto';

export const SESSION_IDLE_MS = 7 * 86_400_000;
const hash = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

/** @param {{ now?: () => number }} [o] */
export function createSessions({ now = Date.now } = {}) {
	/** @type {Map<string, { created: number, seen: number, cap: string | null }>} keyed by the sid's SHA-256 */
	const live = new Map();
	const prune = (t) => { for (const [h, v] of live) if (!(t - v.seen < SESSION_IDLE_MS)) live.delete(h); };
	return {
		mint(cap = null) {
			const t = now();
			prune(t);
			const sid = crypto.randomBytes(32).toString('base64url');
			live.set(hash(sid), { created: t, seen: t, cap: cap ?? null });
			return sid;
		},
		check(sid) {
			if (typeof sid !== 'string' || !sid) return null;
			const h = hash(sid);
			const entry = live.get(h);
			if (!entry) return null;
			const t = now();
			if (!(t - entry.seen < SESSION_IDLE_MS)) { live.delete(h); return null; }
			entry.seen = t;
			return { cap: entry.cap };
		},
		/** `dt web revoke`: every session ends. → how many did. */
		revokeAll() { const n = live.size; live.clear(); return n; },
		count: () => live.size,
	};
}
