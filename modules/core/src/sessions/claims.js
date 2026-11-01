// The claim: a record is IN SESSION while a `running` sessions record lists it in `records` and its
// heartbeat is fresher than its binding's `stale_after`. Nothing else holds it — the session IS the
// claim, so there is no lock record to leak. Advisory by design (decisions, cr-core-001 gap 2):
// `dt session start` refuses a second start, `dt next` and `dt sessions open` say so, and no write
// path is blocked.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_STALE_AFTER, strip } from './bindings.js';

const pad = (n) => String(n).padStart(2, '0');
/** A local timestamp with its offset, to the second — how every datetime in a record reads. */
export function stamp(d = new Date()) {
	const o = -d.getTimezoneOffset();
	const a = Math.abs(o);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${o >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** A stored datetime as it is shown: a parsed Date back to a local stamp, a string as written. */
export const shown = (v) => (v instanceof Date ? stamp(v) : String(v ?? ''));
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v ?? '')));

/** Every binding compiled into this workspace, as `id → fields` (empty when the kind is absent). */
export function readBindings(store) {
	const out = new Map();
	try { for (const { id, fields } of store.readAll('session-bindings')) out.set(id, fields); } catch { /* no bindings compiled */ }
	return out;
}

/** Minutes a session may be silent: its binding's `stale_after`, else the default. */
export const staleAfter = (session, bindings) => bindings.get(strip(session.binding, 'session-bindings'))?.stale_after ?? DEFAULT_STALE_AFTER;

/** Is a running session's heartbeat (else its start) older than its binding allows? */
export function isStale(session, bindings, now = Date.now()) {
	const last = ms(session.heartbeat ?? session.started);
	return !Number.isFinite(last) || now - last > staleAfter(session, bindings) * 60_000;
}

/** Every `running` session, each `{ id, fields, stale }`. Throws as the store does when the sessions
 *  folder cannot render (SESSIONS_FOLDER unset) — the caller decides whether that refuses or is silent. */
export function runningSessions(store, bindings, now = Date.now()) {
	const out = [];
	for (const { id, fields } of store.readAll('sessions')) {
		if (fields.status !== 'running') continue;
		out.push({ id, fields, stale: isStale(fields, bindings, now) });
	}
	return out;
}

/** `ref → [session…]` for the refs asked about: who is in session on each, fresh and stale alike. */
export function claimsOn(running, refs) {
	const want = new Set(refs);
	const out = new Map();
	for (const s of running) for (const r of [].concat(s.fields.records ?? [])) {
		if (!want.has(r)) continue;
		if (!out.has(r)) out.set(r, []);
		out.get(r).push(s);
	}
	return out;
}

/** Mark every stale running session `abandoned` — its claim lapses — with `ended` at its last sign of
 *  life. Returns the ids swept. Lazy by design: every `dt session` / `dt sessions` verb runs it, and
 *  `dt next` (which never writes) reads a stale session as free. */
export function sweep(store, bindings, now = Date.now()) {
	const swept = [];
	for (const s of runningSessions(store, bindings, now)) {
		if (!s.stale) continue;
		store.set('sessions', s.id, { status: 'abandoned', ended: shown(s.fields.heartbeat ?? s.fields.started) });
		swept.push(s.id);
	}
	return swept;
}

/** Who a session is, for a sentence: its worker, else its harness. */
export const whoOf = (s) => s.worker ?? (s.harness ? `a ${s.harness} session` : 'a session');

/** The line `dt next` and a refusal say about one holder. */
export const heldBy = (s) => `in session by ${whoOf(s.fields)} since ${shown(s.fields.started)} (sessions/${s.id})`;

/**
 * Run `fn` holding the claim lock: one file beside the sessions records, created exclusively. The check
 * ("is it held?") and the write ("now it is") happen under it, so two starts at the same instant cannot
 * both win. A lock older than `staleMs` is a crashed holder's and is broken.
 */
export function withClaimLock(dir, fn, { waitMs = 10_000, staleMs = 30_000 } = {}) {
	fs.mkdirSync(dir, { recursive: true });
	const lock = path.join(dir, '.session-claims.lock');
	const deadline = Date.now() + waitMs;
	const nap = new Int32Array(new SharedArrayBuffer(4));
	for (;;) {
		try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
			if (e.code !== 'EEXIST') throw e;
			try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.rmSync(lock, { force: true }); continue; } } catch { continue; }
			if (Date.now() > deadline) throw new Error(`another dt session is claiming (lock ${lock}) — try again; remove the file if no dt session is running`);
			Atomics.wait(nap, 0, 0, 50);
		}
	}
	try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}
