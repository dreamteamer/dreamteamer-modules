// The auth primitives of one listener (cr-modules-017 §2–§3), on an injected clock: single-use pairing codes that
// die at 60 s, static sessions held in the server's memory only with a 7-day idle expiry (a restart signs the pane
// out — the security sign-off), and client tokens matched by hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPairing, PAIR_TTL_MS } from '../src/pairing.js';
import { createSessions, SESSION_IDLE_MS } from '../src/sessions.js';
import { mintClientToken, matchClientToken } from '../src/tokens.js';

const DAY = 86_400_000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('a pairing code is taken once, carries its route and cap, and is refused at 60 s', () => {
	let t = 0;
	const p = createPairing({ now: () => t });
	assert.equal(PAIR_TTL_MS, 60_000);
	const a = p.mint();
	assert.match(a, /^[A-Za-z0-9_-]{32,}$/);
	assert.deepEqual(p.take(a), { route: '/', cap: null });
	assert.equal(p.take(a), null, 'single use');
	const b = p.mint({ route: '/content/tasks', cap: 'read' });
	t = 59_000;
	assert.deepEqual(p.take(b), { route: '/content/tasks', cap: 'read' });
	const c = p.mint();
	t += 60_000;
	assert.equal(p.take(c), null, 'refused at 60 s');
	assert.equal(p.take('nope'), null);
	assert.equal(p.take(undefined), null);
	assert.notEqual(p.mint(), p.mint());
});

test('a session is static, renewed on use, and refused after 7 idle days', () => {
	let t = 0;
	const s = createSessions({ now: () => t });
	assert.equal(SESSION_IDLE_MS, 7 * DAY);
	const sid = s.mint();
	assert.match(sid, /^[A-Za-z0-9_-]{32,}$/);
	assert.deepEqual(s.check(sid), { cap: null });
	t = 6 * DAY;
	assert.deepEqual(s.check(sid), { cap: null }, 'day 6');
	t = 12 * DAY;
	assert.deepEqual(s.check(sid), { cap: null }, 'day 12: renewed at day 6, still valid');
	t = 19 * DAY;
	assert.equal(s.check(sid), null, 'idle 7 days');
	assert.equal(s.count(), 0, 'an expired session is dropped');
	const capped = s.mint('read');
	assert.deepEqual(s.check(capped), { cap: 'read' });
	assert.equal(s.check('not-a-sid'), null);
	assert.equal(s.check(undefined), null);
});

test('sessions live in memory only: createSessions takes no state and no save, and a second store (a restart) knows no sid of the first', () => {
	const first = createSessions({ now: () => 5 });
	const sid = first.mint('edit');
	assert.deepEqual(first.check(sid), { cap: 'edit' });
	const second = createSessions({ now: () => 10 });
	assert.equal(second.check(sid), null, 'a restart signs the pane out');
	assert.equal(second.count(), 0);
	assert.equal('flush' in first, false, 'nothing to write');
	assert.equal('invalidateAll' in first, false, 'nothing survives a restart to invalidate');
});

test('revokeAll refuses every sid and answers how many ended', () => {
	const s = createSessions({ now: () => 0 });
	const a = s.mint(); const b = s.mint('read');
	assert.equal(s.count(), 2);
	assert.equal(s.revokeAll(), 2);
	assert.equal(s.check(a), null); assert.equal(s.check(b), null);
	assert.equal(s.count(), 0);
	assert.equal(s.revokeAll(), 0);
});

test('a client token matches only its own record, and the record holds the hash and no token', () => {
	const t = 1_700_000_000_000;
	const a = mintClientToken({ name: 'ci', now: () => t });
	const b = mintClientToken({ name: 'notebook', level: 'edit', now: () => t });
	assert.equal(a.record.level, 'read', 'read by default');
	assert.equal(b.record.level, 'edit');
	assert.deepEqual(Object.keys(a.record).sort(), ['created', 'level', 'name', 'sha256']);
	assert.equal(a.record.sha256, sha(a.token));
	assert.equal(JSON.stringify(a.record).includes(a.token), false);
	const records = [a.record, b.record];
	assert.equal(matchClientToken(records, a.token), a.record);
	assert.equal(matchClientToken(records, b.token).level, 'edit');
	assert.equal(matchClientToken(records, 'x'), null);
	assert.equal(matchClientToken(records, ''), null);
	assert.equal(matchClientToken(records, undefined), null);
	assert.equal(matchClientToken([], a.token), null);
	assert.throws(() => mintClientToken({ name: 'x', level: 'admin' }), /read or edit/);
	assert.throws(() => mintClientToken({ name: '' }), /name/);
});
