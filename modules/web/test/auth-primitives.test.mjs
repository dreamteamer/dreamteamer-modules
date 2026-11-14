// The auth primitives of one listener (cr-modules-017 §2–§3), on an injected clock: single-use pairing codes that
// die at 60 s, static sessions stored by SHA-256 with a 7-day idle expiry, and client tokens matched by hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPairing, PAIR_TTL_MS } from '../src/pairing.js';
import { createSessions, SESSION_MAX_AGE_S } from '../src/sessions.js';
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
	const state = { sessions: {} };
	let saves = 0;
	const s = createSessions({ state, save: () => { saves++; }, now: () => t });
	assert.equal(SESSION_MAX_AGE_S, 604_800);
	const sid = s.mint();
	assert.match(sid, /^[A-Za-z0-9_-]{32,}$/);
	assert.deepEqual(s.check(sid), { cap: null });
	t = 6 * DAY;
	assert.deepEqual(s.check(sid), { cap: null }, 'day 6');
	t = 12 * DAY;
	assert.deepEqual(s.check(sid), { cap: null }, 'day 12: renewed at day 6, still valid');
	t = 19 * DAY;
	assert.equal(s.check(sid), null, 'idle 7 days');
	assert.equal(Object.keys(state.sessions).length, 0, 'an expired session is dropped');
	const capped = s.mint('read');
	assert.deepEqual(s.check(capped), { cap: 'read' });
	assert.equal(s.check('not-a-sid'), null);
	assert.equal(s.check(undefined), null);
});

test('the persisted object holds only 64-hex keys; seen is written at most once a minute; flush writes the rest', () => {
	let t = 1_000_000;
	const state = { sessions: {} };
	let saves = 0;
	const s = createSessions({ state, save: () => { saves++; }, now: () => t });
	const sid = s.mint('edit');
	assert.equal(saves, 1, 'a mint is written at once');
	assert.deepEqual(Object.keys(state.sessions), [sha(sid)]);
	for (const k of Object.keys(state.sessions)) assert.match(k, /^[0-9a-f]{64}$/);
	assert.equal(JSON.stringify(state).includes(sid), false);
	for (let i = 0; i < 59; i++) { t += 1000; s.check(sid); }
	assert.equal(saves, 1, 'no write inside the minute');
	t += 1000; s.check(sid);
	assert.equal(saves, 2, 'one write at the minute');
	t += 5000; s.check(sid);
	assert.equal(saves, 2);
	s.flush();
	assert.equal(saves, 3, 'flush writes a pending seen');
	assert.equal(state.sessions[sha(sid)].seen, t);
	s.flush();
	assert.equal(saves, 3, 'nothing pending, nothing written');
});

test('revokeAll and invalidateAll refuse every sid', () => {
	let t = 0;
	const state = { sessions: {} };
	const s = createSessions({ state, save: () => {}, now: () => t });
	const a = s.mint(); const b = s.mint('read');
	s.revokeAll();
	assert.equal(s.check(a), null); assert.equal(s.check(b), null);
	const c = s.mint();
	s.invalidateAll();
	assert.equal(s.check(c), null);
	assert.deepEqual(state.sessions, {});
});

test('a session minted by another process is checked from the shared state', () => {
	const state = { sessions: {} };
	const first = createSessions({ state, save: () => {}, now: () => 5 });
	const sid = first.mint();
	const second = createSessions({ state, save: () => {}, now: () => 10 });
	assert.deepEqual(second.check(sid), { cap: null });
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
