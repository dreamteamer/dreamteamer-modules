// `dt session bind | end | send` — a session is a plain `sessions` record (core 0.9.0): `bind` adds the
// records it works on, `end` stamps when it ended, `send` asks it a question. There is no claim and no
// lock: a record another session lists is named in one line and bound anyway. `heartbeat` is kept
// through 0.9.x as a silent exit-0 no-op, so core 0.8.0's Stop hook left in .claude/settings.json never
// blocks a stop (bin/sessions-migrate.mjs removes it).
import os from 'node:os';
import path from 'node:path';
import { findWorkspace } from '../../lib/workspace-root.mjs';
import { sendTo } from './send.js';

export const SESSION_USAGE = [
	'  session bind <collection>/<id>… [--session <id>] [--json]',
	'                                              (add records to the current session — $CLAUDE_CODE_SESSION_ID —',
	'                                               or the one --session names; writes the session record when absent)',
	'  session end [<session>] [--outcome <text>] [--json]   (stamp ended; --outcome writes the body)',
	'  session send <session> <text>… [--json]     (ask the session a question through a fork with no tools;',
	'                                               its own history is untouched)',
].join('\n');

const SWITCHES = new Set(['json', 'hook', 'force']);
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

export const strip = (ref, kind) => String(ref ?? '').replace(new RegExp(`^${kind}/`), '');
const pad = (n) => String(n).padStart(2, '0');
/** A local timestamp with its offset, to the second — how every datetime in a record reads. */
export function stamp(d = new Date()) {
	const o = -d.getTimezoneOffset();
	const a = Math.abs(o);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${o >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const shown = (v) => (v instanceof Date ? stamp(v) : String(v ?? ''));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The workspace a session record is written to: the one the session runs in — the nearest workspace
 *  above `from` that is not a folder directly inside git_modules/ (session-save resolves it the same way),
 *  else `from` itself. One harness session is therefore one record. */
export const writeRootOf = (from) => findWorkspace(from) ?? path.resolve(from);

/** The workspace handle to write sessions in, opened only when it is not the one already open. */
async function writeWorkspace(ws, dt) {
	const root = writeRootOf(ws.root);
	return path.resolve(root) === path.resolve(ws.root) ? ws : dt.openWorkspace(root);
}

const sessionOf = (flags, pos, env) => {
	const sid = strip(flags.session ?? pos ?? env.CLAUDE_CODE_SESSION_ID ?? '', 'sessions');
	return sid || null;
};

function readSession(store, sid) {
	try { return store.read('sessions', sid).fields; } catch { throw new Error(`sessions/${sid}: no such session — nothing was written`); }
}

export async function bind(ws, dt, refs, flags = {}, env = process.env) {
	const sid = sessionOf(flags, null, env);
	if (!sid) throw new Error('dt session bind needs a session: run it inside a harness session ($CLAUDE_CODE_SESSION_ID) or name one with --session <id>; nothing was written');
	if (!refs.length) throw new Error('dt session bind needs at least one record: dt session bind <collection>/<id>…');
	const w = await writeWorkspace(ws, dt);
	const store = new dt.Store(w);
	const resolved = [];
	const titles = new Map();
	for (const raw of refs) {
		let ref;
		try {
			const { collection, id } = dt.splitRef(store.descriptors, raw);
			if (!id) throw new Error('no id');
			ref = `${collection}/${id}`;
			const { fields } = store.read(collection, id);
			titles.set(ref, fields.name ?? fields.title ?? ref);
		} catch { throw new Error(`${raw}: no such record — nothing was written`); }
		if (!resolved.includes(ref)) resolved.push(ref);
	}
	let existing = null;
	try { existing = store.read('sessions', sid).fields; } catch { /* written below */ }
	const had = [].concat(existing?.records ?? []);
	const added = resolved.filter((r) => !had.includes(r));
	const warnings = [];
	for (const { id, fields } of store.readAll('sessions')) {
		if (id === sid) continue;
		const theirs = [].concat(fields.records ?? []);
		for (const r of added) if (theirs.includes(r)) warnings.push(`${r} is also bound to sessions/${id} (${fields.worker ?? (fields.harness ? `a ${fields.harness} session` : 'a session')}, started ${shown(fields.started)})`);
	}
	if (!existing) {
		const own = UUID.test(sid);
		store.add('sessions', {
			name: `${titles.get(resolved[0])}`.slice(0, 200), started: stamp(), records: resolved, host: os.hostname(),
			...(own && { session_id: sid, harness: flags.harness ?? 'claude-code' }),
		}, { id: sid });
	} else if (added.length) {
		store.set('sessions', sid, { records: [...had, ...added] });
	}
	return { session: `sessions/${sid}`, root: w.root, added, skipped: resolved.filter((r) => had.includes(r)), created: !existing, warnings };
}

export async function end(ws, dt, pos, flags = {}, env = process.env) {
	const sid = sessionOf({}, pos[0], env);
	if (!sid) throw new Error('dt session end needs a session: dt session end <session id>, or run it inside the harness session');
	const store = new dt.Store(await writeWorkspace(ws, dt));
	const fields = readSession(store, sid);
	if (fields.ended && !flags.outcome) return { session: `sessions/${sid}`, ended: shown(fields.ended), already: true };
	const ended = fields.ended ? shown(fields.ended) : stamp();
	store.set('sessions', sid, { ...(!fields.ended && { ended }), ...(flags.outcome && { outcome: flags.outcome }) });
	return { session: `sessions/${sid}`, ended, already: false };
}

export async function send(ws, dt, pos, flags = {}, { env = process.env, spawn } = {}) {
	const sid = strip(pos[0] ?? '', 'sessions');
	const text = pos.slice(1).join(' ');
	if (!sid || !text) throw new Error('dt session send needs a session and a message: dt session send <session> <text>');
	const store = new dt.Store(await writeWorkspace(ws, dt));
	return sendTo(readSession(store, sid), text, { env, ...(spawn && { spawn }) });
}

// ---- the verb ---------------------------------------------------------------------------------------

export async function sessionCommand(ws, argv, dt, { env = process.env } = {}) {
	const [sub, ...rest] = argv;
	// retired in 0.9.0: a heartbeat — hook or not — is a no-op at exit 0 through 0.9.x, so the 0.8.0 Stop
	// hook a workspace merged never blocks its harness's stop; bin/sessions-migrate.mjs removes the entry
	if (sub === 'heartbeat') return 0;
	const { pos, flags } = parse(rest);
	const out = (o, text) => { if (flags.json) dt.emit(JSON.stringify(o, null, 2)); else console.log(text); };
	switch (sub) {
		case 'bind': {
			const r = await bind(ws, dt, pos, flags, env);
			for (const w of r.warnings) console.error(`⚠ ${w}`);
			out(r, `✔ ${r.session}${r.created ? ' (new)' : ''} — ${r.added.length ? `bound ${r.added.join(', ')}` : 'nothing new'}${r.skipped.length ? ` · already bound: ${r.skipped.join(', ')}` : ''}${r.root !== ws.root ? ` · in ${r.root}` : ''}`);
			return 0;
		}
		case 'end': {
			const r = await end(ws, dt, pos, flags, env);
			out(r, r.already ? `· ${r.session} already ended ${r.ended} — nothing changed` : `✔ ${r.session} ended ${r.ended}`);
			return 0;
		}
		case 'send': {
			const r = await send(ws, dt, pos, flags, { env });
			if (flags.json) dt.emit(r.raw.trim());
			else console.log(r.reply.result ?? r.raw);
			return 0;
		}
		default:
			console.error(`dt session ${sub ?? ''}: unknown — the subcommands are bind · end · send\n${SESSION_USAGE}`);
			return 2;
	}
}

/** What `dt next <ref>` says about the sessions that bound a record — read at call time from every root
 *  the workspace reads, one note per session, its ref in the text (the engine keeps id, text and by). A
 *  record no session lists gets nothing. Synchronous and read-only; a failure to read is no note. */
export function nextNotes(ws, dt, { collection, ids }) {
	let sessions;
	try { sessions = [...new dt.Store(ws).readAll('sessions')]; } catch { return []; }
	const out = [];
	for (const id of ids) {
		const ref = `${collection}/${id}`;
		for (const s of sessions) {
			if (![].concat(s.fields.records ?? []).includes(ref)) continue;
			out.push({ id, text: `worked on in sessions/${s.id} — ${s.fields.name ?? ''} · ${shown(s.fields.started)}${s.fields.ended ? '' : ' (not ended)'}` });
		}
	}
	return out;
}
