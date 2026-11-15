// Client tokens (cr-modules-017 §3): a bearer a script holds for /api/ at its own level — read by default, edit when
// asked, never admin. The state keeps the SHA-256 and the name; the token itself is printed once and never stored.
import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(s).digest();

export function mintClientToken({ name, level = 'read', now = Date.now } = {}) {
	if (typeof name !== 'string' || !name.trim()) throw new Error('a client token needs a name');
	if (level !== 'read' && level !== 'edit') throw new Error(`a client token is read or edit, not ${level}`);
	const token = `dtw_${crypto.randomBytes(32).toString('base64url')}`;
	return { token, record: { name: name.trim(), level, sha256: hash(token).toString('hex'), created: new Date(now()).toISOString() } };
}

/** The record whose hash the bearer has, compared in constant time; null for anything else. */
export function matchClientToken(records, bearer) {
	if (typeof bearer !== 'string' || !bearer) return null;
	const h = hash(bearer);
	let found = null;
	for (const r of records ?? []) {
		const want = /^[0-9a-f]{64}$/.test(String(r?.sha256)) ? Buffer.from(r.sha256, 'hex') : null;
		if (want && crypto.timingSafeEqual(want, h) && !found) found = r;
	}
	return found;
}
