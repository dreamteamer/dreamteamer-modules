// Sessions (cr-modules-017 §2): a random sid in an HttpOnly SameSite=Strict cookie; the state keeps only its SHA-256.
// A session is STATIC — the same sid for its whole life, never rotated — and expires after 7 idle days; each use
// renews `seen`, written to disk at most once a minute (and on flush), so a busy page does not rewrite the file.
import crypto from 'node:crypto';

export const SESSION_MAX_AGE_S = 604_800;
const MAX_IDLE_MS = SESSION_MAX_AGE_S * 1000;
const hash = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

/**
 * @param {{ state: { sessions: Record<string, { created: number, seen: number, cap?: string }> }, save: () => void,
 *           now?: () => number, writeEveryMs?: number }} o — `state` is the workspace state object; `save` writes it
 */
export function createSessions({ state, save, now = Date.now, writeEveryMs = 60_000 }) {
	let lastWrite = -Infinity;
	let dirty = false;
	const write = () => { save(); lastWrite = now(); dirty = false; };
	const prune = (t) => { for (const [h, v] of Object.entries(state.sessions)) if (!(t - Number(v?.seen) < MAX_IDLE_MS)) delete state.sessions[h]; };
	return {
		mint(cap = null) {
			const t = now();
			prune(t);
			const sid = crypto.randomBytes(32).toString('base64url');
			state.sessions[hash(sid)] = cap ? { created: t, seen: t, cap } : { created: t, seen: t };
			write();
			return sid;
		},
		check(sid) {
			if (typeof sid !== 'string' || !sid) return null;
			const h = hash(sid);
			const entry = state.sessions[h];
			if (!entry) return null;
			const t = now();
			if (!(t - Number(entry.seen) < MAX_IDLE_MS)) { delete state.sessions[h]; write(); return null; }
			entry.seen = t;
			dirty = true;
			if (t - lastWrite >= writeEveryMs) write();
			return { cap: entry.cap ?? null };
		},
		/** `dt web revoke`: every session ends. */
		revokeAll() { for (const h of Object.keys(state.sessions)) delete state.sessions[h]; write(); },
		/** The stored port was taken and the server moved: no cookie of the old port is honoured. */
		invalidateAll() { for (const h of Object.keys(state.sessions)) delete state.sessions[h]; write(); },
		flush() { if (dirty) write(); },
	};
}
