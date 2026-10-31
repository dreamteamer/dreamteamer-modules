// `dt session start | end | heartbeat` and `dt sessions open` — a session STARTS on a record and claims
// it, and every other agent can read the claim before starting. The record is a `sessions` record
// (core's collection, kept in ${env:SESSIONS_FOLDER}), so the claim is visible to every worktree and
// every agent on this machine the moment it is written, with no commit.
import os from 'node:os';
import { strip } from './bindings.js';
import { stamp, shown, readBindings, runningSessions, claimsOn, sweep, heldBy, whoOf, withClaimLock } from './claims.js';

export const SESSION_USAGE = [
	'  session start <collection>/<id> [--agent <id>] [--harness <h>] [--binding <id>] [--session-id <id>] [--join] [--json]',
	'                                              (claim a record: writes a running sessions record from the',
	'                                               session-binding available on it; refused, naming the holder,',
	'                                               while another session holds it — unless --join)',
	'  session end <session> [--outcome <text>] [--json]   (close it: status ended, the outcome as its body)',
	'  session heartbeat [<session>] [--hook]      (say it is alive; --hook reads a Claude Code hook payload',
	'                                               on stdin and refreshes the sessions of its session_id)',
].join('\n');
export const SESSIONS_USAGE = '  sessions open [--collection <c>] [--json]   (the records a session-binding makes available and nobody holds)';

const SWITCHES = new Set(['join', 'json', 'hook']);
/** argv → { pos, flags }; a switch never swallows the next word, and a repeated flag is refused. */
export function parse(argv) {
	const pos = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) { pos.push(a); continue; }
		const eq = a.indexOf('=');
		const k = eq > -1 ? a.slice(2, eq) : a.slice(2);
		if (k in flags) throw new Error(`--${k} was given twice and takes one value`);
		if (SWITCHES.has(k)) { flags[k] = true; continue; }
		const v = eq > -1 ? a.slice(eq + 1) : argv[++i];
		if (v === undefined || v.startsWith('--')) throw new Error(`--${k} takes a value`);
		flags[k] = v;
	}
	return { pos, flags };
}

const asRef = (v, kind) => (String(v).includes('/') ? String(v) : `${kind}/${v}`);

/** The state of one binding on one record: done · available · not-available. */
function stateOf(dt, b, record, resolve) {
	if (b.done_when && dt.matchesFilter(record, b.done_when, resolve)) return 'done';
	return !b.available_when || dt.matchesFilter(record, b.available_when, resolve) ? 'available' : 'not-available';
}

/** A fresh id under the descriptor's own shape (`YYYY/MM/YYYY-MM-DD--<slug>`), suffixed when taken. */
function freshId(dt, store, started, name) {
	const day = started.slice(0, 10);
	const base = `${day.slice(0, 4)}/${day.slice(5, 7)}/${day}--${dt.slug(name)}`;
	const taken = store.ids('sessions');
	let id = base;
	for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
	return id;
}

export function start(ws, dt, pos, flags, env = process.env) {
	const target = pos[0];
	if (!target) throw new Error('dt session start needs a record: dt session start <collection>/<id>');
	const store = new dt.Store(ws);
	const { collection, id } = dt.splitRef(store.descriptors, target);
	const ref = `${collection}/${id}`;
	let record;
	try { record = { ...store.read(collection, id).fields, id }; } catch { throw new Error(`${ref}: no such record — nothing was written`); }
	const bindings = readBindings(store);
	const mine = [...bindings].filter(([, b]) => strip(b.collection, 'collections') === collection);
	if (!mine.length) throw new Error(`no session-binding names ${collection} — a module binds it in session-bindings/<id>.session-binding.yaml (the managing-sessions skill shows one); nothing was written`);
	const resolve = dt.recordResolver(store);
	let chosen;
	if (flags.binding) {
		chosen = mine.find(([bid]) => bid === strip(flags.binding, 'session-bindings'));
		if (!chosen) throw new Error(`--binding ${flags.binding} is not a session-binding of ${collection} (its bindings: ${mine.map(([bid]) => bid).join(', ')})`);
	} else {
		const open = mine.filter(([, b]) => stateOf(dt, b, record, resolve) === 'available');
		if (open.length > 1) throw new Error(`several session-bindings are available on ${ref}: ${open.map(([bid]) => bid).join(', ')} — name one with --binding`);
		chosen = open[0] ?? mine[0];
	}
	const [bid, b] = chosen;
	const state = stateOf(dt, b, record, resolve);
	if (state !== 'available') {
		const gate = state === 'done' ? `its done_when holds (${JSON.stringify(b.done_when)})` : `its available_when does not (${JSON.stringify(b.available_when)})`;
		throw new Error(`${ref} is not open for a session under session-bindings/${bid}: ${gate} — nothing was written`);
	}
	const dir = store.dir(store.descriptor('sessions')); // refuses here, naming SESSIONS_FOLDER, when it cannot render
	return withClaimLock(dir, () => {
		sweep(store, bindings);
		const holders = (claimsOn(runningSessions(store, bindings).filter((s) => !s.stale), [ref]).get(ref) ?? []);
		if (holders.length && (b.concurrency ?? 'one') === 'one' && !flags.join) {
			return { refused: true, ref, holders };
		}
		const started = stamp();
		const worker = flags.agent ? asRef(flags.agent, 'agents') : b.agent;
		const sessionId = flags['session-id'] ?? env.CLAUDE_CODE_SESSION_ID;
		const harness = flags.harness ?? b.harness ?? (env.CLAUDE_CODE_SESSION_ID ? 'claude-code' : undefined);
		const name = `${ref} — ${worker ? strip(strip(worker, 'agents'), 'users') : harness ?? 'session'}`;
		const fields = {
			name, started, heartbeat: started, status: 'running', records: [ref], binding: `session-bindings/${bid}`, host: os.hostname(),
			...(worker && { worker }), ...(harness && { harness }), ...(sessionId && { session_id: sessionId }),
		};
		const sid = freshId(dt, store, started, name);
		store.add('sessions', fields, { id: sid });
		return { refused: false, session: `sessions/${sid}`, ref, binding: `session-bindings/${bid}`, worker: worker ?? null, harness: harness ?? null, started, joined: holders.map((h) => `sessions/${h.id}`), command: b.command ?? null };
	});
}

export function end(ws, dt, pos, flags) {
	const sid = strip(pos[0] ?? '', 'sessions');
	if (!sid) throw new Error('dt session end needs a session: dt session end <session id> [--outcome <text>]');
	const store = new dt.Store(ws);
	const { fields } = store.read('sessions', sid);
	if (fields.status !== 'running') throw new Error(`sessions/${sid} is ${fields.status ?? 'not a live session'}${fields.status === 'abandoned' ? ` — no heartbeat after ${shown(fields.ended ?? fields.heartbeat)}, so its claim lapsed` : ''}; nothing to end`);
	const t = stamp();
	store.set('sessions', sid, { status: 'ended', ended: t, heartbeat: t, ...(flags.outcome && { outcome: flags.outcome }) });
	const records = [].concat(fields.records ?? []);
	// "free" only where no other fresh session still holds it — a joiner keeps the record in session
	const bindings = readBindings(store);
	const held = claimsOn(runningSessions(store, bindings).filter((s) => !s.stale), records);
	return { session: `sessions/${sid}`, status: 'ended', ended: t, records, still_held: Object.fromEntries([...held].map(([r, ss]) => [r, ss.map((x) => `sessions/${x.id}`)])), held };
}

/** Refresh the sessions a heartbeat names: one id, or every running session of a harness session id. */
export function heartbeat(ws, dt, { id = null, sessionId = null } = {}) {
	const store = new dt.Store(ws);
	const t = stamp();
	if (id) {
		const sid = strip(id, 'sessions');
		const { fields } = store.read('sessions', sid);
		if (fields.status !== 'running') throw new Error(`sessions/${sid} is ${fields.status ?? 'not a live session'} — its claim lapsed and another session may hold the record; start again with dt session start`);
		store.set('sessions', sid, { heartbeat: t });
		return [sid];
	}
	const refreshed = [];
	for (const { id: sid, fields } of store.readAll('sessions')) {
		if (fields.status !== 'running' || !sessionId || fields.session_id !== sessionId) continue;
		store.set('sessions', sid, { heartbeat: t });
		refreshed.push(sid);
	}
	return refreshed;
}

/** Every record a binding makes available and no fresh session holds. */
export function open(ws, dt, flags = {}) {
	const store = new dt.Store(ws);
	const bindings = readBindings(store);
	const only = flags.collection ? strip(flags.collection, 'collections') : null;
	if (only && !store.descriptors.has(only)) throw new Error(`unknown collection "${flags.collection}"`);
	sweep(store, bindings);
	const running = runningSessions(store, bindings).filter((s) => !s.stale);
	const resolve = dt.recordResolver(store);
	const rows = [];
	const seen = new Set();
	for (const [bid, b] of [...bindings].sort(([a], [c]) => a.localeCompare(c))) {
		const coll = strip(b.collection, 'collections');
		if (only && coll !== only) continue;
		const recs = [...store.readAll(coll)].map(({ id, fields }) => ({ ...fields, id }));
		const held = claimsOn(running, recs.map((r) => `${coll}/${r.id}`));
		for (const r of recs) {
			const ref = `${coll}/${r.id}`;
			if (seen.has(ref) || held.has(ref) || stateOf(dt, b, r, resolve) !== 'available') continue;
			seen.add(ref);
			rows.push({ ref, binding: `session-bindings/${bid}`, agent: b.agent ?? null, harness: b.harness ?? null, command: b.command ?? null });
		}
	}
	return { open: rows, bindings: bindings.size, running: running.length };
}

// ---- the two verbs ------------------------------------------------------------------------------

export function sessionCommand(ws, argv, dt, { stdin = () => dt.readStdin(), env = process.env } = {}) {
	const [sub, ...rest] = argv;
	// a hook must never fail its harness: anything wrong is a no-op at exit 0, the harness logs stderr
	if (sub === 'heartbeat' && rest.includes('--hook')) {
		try {
			const payload = JSON.parse(stdin() || '{}');
			if (payload.session_id) heartbeat(ws, dt, { sessionId: String(payload.session_id) });
		} catch (e) { console.error(`dt session heartbeat --hook: ${String(e.message).split('\n')[0]} (ignored)`); }
		return 0;
	}
	const { pos, flags } = parse(rest);
	const out = (o, text) => { if (flags.json) dt.emit(JSON.stringify(o, null, 2)); else console.log(text); };
	switch (sub) {
		case 'start': {
			const r = start(ws, dt, pos, flags, env);
			if (r.refused) {
				const lines = r.holders.map((h) => `${r.ref} is ${heldBy(h)}`);
				if (flags.json) dt.emit(JSON.stringify({ refused: true, ref: r.ref, held_by: r.holders.map((h) => ({ session: `sessions/${h.id}`, worker: h.fields.worker ?? null, started: shown(h.fields.started) })) }, null, 2));
				console.error(`✖ ${lines.join('\n✖ ')}\n  nothing was written. To work beside it: dt session start ${r.ref} --join`);
				return 1;
			}
			const cmd = r.command ? `/${strip(r.command, 'commands').replace(/\//g, ':')} ${r.ref}` : null;
			out(r, [
				`✔ ${r.session} — ${r.ref} in session by ${r.worker ?? (r.harness ? `a ${r.harness} session` : 'a session')} since ${r.started} (${r.binding})`,
				...(r.joined.length ? [`  joined ${r.joined.join(', ')}`] : []),
				...(cmd ? [`  start with: ${cmd}`] : []),
				`  keep it alive: the Stop hook (dt install --print-adapters) or dt session heartbeat ${r.session.slice('sessions/'.length)}; end it: dt session end ${r.session.slice('sessions/'.length)}`,
			].join('\n'));
			return 0;
		}
		case 'end': {
			const { held, ...r } = end(ws, dt, pos, flags);
			const free = r.records.filter((ref) => !held.has(ref));
			out(r, [
				`✔ ${r.session} ended ${r.ended}${free.length ? ` — ${free.join(', ')} free` : ''}`,
				...[...held].flatMap(([ref, ss]) => ss.map((x) => `  ${ref} is still ${heldBy(x)}`)),
			].join('\n'));
			return 0;
		}
		case 'heartbeat': {
			const sessionId = flags['session-id'] ?? env.CLAUDE_CODE_SESSION_ID;
			if (!pos[0] && !sessionId) throw new Error('dt session heartbeat needs a session id, or $CLAUDE_CODE_SESSION_ID / --session-id for the harness session');
			const ids = heartbeat(ws, dt, { id: pos[0] ?? null, sessionId });
			if (!ids.length) { console.error(`no running session for harness session ${sessionId}`); return 1; }
			out({ refreshed: ids.map((i) => `sessions/${i}`) }, `✔ heartbeat ${ids.map((i) => `sessions/${i}`).join(', ')}`);
			return 0;
		}
		default:
			console.error(`dt session ${sub ?? ''}: unknown — the subcommands are start · end · heartbeat\n${SESSION_USAGE}`);
			return 2;
	}
}

export function sessionsCommand(ws, argv, dt) {
	const [sub, ...rest] = argv;
	if (sub !== 'open') { console.error(`dt sessions ${sub ?? ''}: unknown — the subcommand is open\n${SESSIONS_USAGE}\n  running sessions: dt list sessions --filter status=running`); return 2; }
	const { flags } = parse(rest);
	const r = open(ws, dt, flags);
	if (flags.json) { dt.emit(JSON.stringify(r.open, null, 2)); return 0; }
	if (!r.open.length) { console.log(`(no record is open for a session — ${r.bindings} session-binding(s), ${r.running} running session(s))`); return 0; }
	for (const o of r.open) console.log(`${o.ref}  ${o.binding}${o.agent ? `  ${o.agent}` : ''}  → dt session start ${o.ref}`);
	return 0;
}

/** What `dt next <ref>` says about a record a session holds — synchronous, read-only, and silent when
 *  sessions cannot be read here (SESSIONS_FOLDER unset): a missing note is better than a failed next. */
export function nextNotes(ws, dt, { collection, ids }) {
	const store = new dt.Store(ws);
	const bindings = readBindings(store);
	if (![...bindings.values()].some((b) => strip(b.collection, 'collections') === collection)) return [];
	let running;
	try { running = runningSessions(store, bindings); } catch { return []; }
	const held = claimsOn(running, ids.map((id) => `${collection}/${id}`));
	const out = [];
	for (const id of ids) for (const s of held.get(`${collection}/${id}`) ?? []) {
		out.push({ id, text: s.stale
			? `was in session by ${whoOf(s.fields)} — no heartbeat since ${shown(s.fields.heartbeat ?? s.fields.started)}, so the claim has lapsed (sessions/${s.id})`
			: heldBy(s) });
	}
	return out;
}
