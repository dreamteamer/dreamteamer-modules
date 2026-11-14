// `dt web` and `dt-web <root>` (cr-modules-017 §8): one argv grammar for both entries; `main` resolves to the exit
// code. Every verb that needs the server starts it detached when it is not running (`ensureRunning`) — `open`, `show`,
// `select`, `selection`, `token`, `start`; `status`, `stop`, `list`, `hook` and `revoke` never start one. Every verb
// knows the server by its proof (runtime.js `probeServer`), never by a live pid: a runtime file whose process is gone,
// refuses the connection or gives a wrong proof is stale — status says not running, open starts a fresh server, stop
// removes the file and signals nobody. A live process that gives no proof in time is NOT ANSWERING: every verb says so,
// exits 1 and changes nothing — no file removed, no second server — and only `stop --force` signals it, when its
// recorded start time is that process's own.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, claimStart, clearStale, movedLine, notAnsweringLine, probeServer, processStart, readState, removeState, runtimeDir, stateFile, workspaceKey, writeState } from './runtime.js';
import { readRegistry, readWorkspaceState, register, stateDir, writeWorkspaceState } from './state.js';
import { hookInstalled, installHook } from './hook.js';
import { workspaceName } from './pane-store.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'dt-web.mjs');
// the browser page @dreamteamer/ui builds, served as it is
const appDirOf = () => path.join(path.dirname(createRequire(import.meta.url).resolve('@dreamteamer/ui/package.json')), 'dist', 'app');
export const USAGE = 'usage: dt web [open [<ref>|<collection>|<ui-view>] [--read|--edit|--admin] [--browser]] · show <target> · select <ref>… | --clear · selection [--json] · hook --install · token [--read|--edit] [--name <n>] · list · revoke [--token <n>] · status · stop [--revoke] [--force] · start [--foreground] [--port <n>] [--idle <minutes>] [--owner-pid <pid>]';
const VERBS = new Set(['open', 'show', 'select', 'selection', 'hook', 'token', 'list', 'revoke', 'status', 'stop', 'start']);
/** Each verb's flags: `level` (one of --read/--edit/--admin), `true` (a switch) or `value` (takes one). */
const FLAGS = {
	open: { '--read': 'level', '--edit': 'level', '--admin': 'level', '--browser': true },
	show: {},
	select: { '--clear': true },
	selection: { '--json': true },
	hook: { '--install': true },
	token: { '--read': 'level', '--edit': 'level', '--name': 'value' },
	list: {},
	revoke: { '--token': 'value' },
	status: {},
	stop: { '--revoke': true, '--force': true },
	start: { '--foreground': true, '--port': 'value', '--idle': 'value', '--owner-pid': 'value' },
};
const SWITCH = { '--browser': 'browser', '--clear': 'clear', '--json': 'json', '--install': 'install', '--revoke': 'revoke', '--force': 'force', '--foreground': 'foreground' };
const START_WAIT_MS = 10_000;
const LEVEL_WORD = (l) => l[0].toUpperCase() + l.slice(1);
const bad = (why) => { const e = new Error(`${why} — ${USAGE}`); e.usage = true; return e; };
const wholeNumber = (flag, v, max = Infinity) => {
	if (v === undefined || !/^\d+$/.test(v) || Number(v) > max) throw bad(`${flag} needs a whole number${max < Infinity ? ` up to ${max}` : ''}`);
	return Number(v);
};

/** → { cmd, target?, refs?, clear?, level?, name?, token?, revoke?, browser?, foreground?, port?, idle?, ownerPid?, json?, install? } */
export function parseArgs(argv, env = process.env) {
	const args = [...argv];
	const cmd = args.length && !args[0].startsWith('-') ? args.shift() : 'open';
	if (!VERBS.has(cmd)) throw bad(`dt web has no verb "${cmd}"`);
	const out = { cmd };
	const positional = [];
	const flags = FLAGS[cmd];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (!a.startsWith('-')) { positional.push(a); continue; }
		const eq = a.indexOf('=');
		const name = eq < 0 ? a : a.slice(0, eq);
		const inline = eq < 0 ? undefined : a.slice(eq + 1);
		const kind = Object.hasOwn(flags, name) ? flags[name] : undefined;
		if (!kind) throw bad(`dt web ${cmd} does not take "${a}"`);
		if (kind === 'level') {
			if (out.level && out.level !== name.slice(2)) throw bad('one level flag at a time');
			out.level = name.slice(2);
		} else if (kind === true) {
			out[SWITCH[name]] = true;
		} else {
			const v = inline ?? args[++i];
			if (v === undefined || v === '') throw bad(`${name} needs a value`);
			if (name === '--name') out.name = v;
			if (name === '--token') out.token = v;
			if (name === '--port') out.port = wholeNumber('--port', v, 65535);
			if (name === '--idle') out.idle = wholeNumber('--idle', v);
			if (name === '--owner-pid') out.ownerPid = wholeNumber('--owner-pid', v);
		}
	}
	if (cmd === 'open' && positional.length > 1) throw bad('dt web open takes one target');
	if (cmd === 'show' && positional.length !== 1) throw bad('dt web show takes one target');
	if (cmd === 'select' && (out.clear ? positional.length > 0 : positional.length === 0)) throw bad('dt web select takes refs or --clear');
	if (cmd === 'hook' && !out.install) throw bad('dt web hook takes --install');
	if (!['open', 'show', 'select'].includes(cmd) && positional.length) throw bad(`dt web ${cmd} takes no "${positional[0]}"`);
	if ((cmd === 'open' || cmd === 'show') && positional[0] !== undefined) out.target = positional[0];
	if (cmd === 'select' && !out.clear) out.refs = positional;
	if (cmd === 'start' && out.port === undefined && env.DT_WEB_PORT) out.port = wholeNumber('DT_WEB_PORT', env.DT_WEB_PORT, 65535);
	return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A request to the running server under its control token: → { status, body } (status 0 when it did not answer). */
async function ask(rt, method, p, body, timeoutMs = 10_000) {
	try {
		const r = await fetch(`http://127.0.0.1:${rt.port}${p}`, {
			method,
			headers: { authorization: `Bearer ${rt.controlToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});
		let json = null;
		try { json = await r.json(); } catch { /* not JSON */ }
		return { status: r.status, body: json };
	} catch { return { status: 0, body: null }; }
}
const fileOf = (root, env) => stateFile(root, runtimeDir(env));
/** The workspace's server when it proves it is the runtime file's: `{ port, controlToken, pid, movedFrom }`, else null. */
/** What a verb that needs the server throws when a live server does not answer: it prints the line and exits 1. */
class NotAnswering extends Error { constructor(p) { super(notAnsweringLine(p)); this.notAnswering = true; } }
const current = async (root, env, timeoutMs = 2000, { refuseSilent = true } = {}) => {
	const p = await probeServer(fileOf(root, env), { timeoutMs });
	if (p?.state === 'silent' && refuseSilent) throw new NotAnswering(p);
	return p?.proven && typeof p.token === 'string' ? { port: p.port, controlToken: p.token, pid: p.pid, movedFrom: p.movedFrom } : null;
};
const failed = (log, r) => { log(`✖ ${r.body?.error ?? (r.status ? `the server answered ${r.status}` : 'the server did not answer')}`); return 1; };

/**
 * The workspace's server, started detached when it is not running (or is on its way down): `dt-web <root> start
 * --foreground` with its output in `<runtime dir>/<key>.log`, waited for up to ten seconds. `bin` is this package's
 * dt-web, or — for a handoff — the one the target workspace installed.
 * @returns {Promise<{ port: number, controlToken: string }>}
 */
export async function ensureRunning(root, { log = console.log, env = process.env, appDir, bin = BIN } = {}) {
	// a live server that does not answer throws NotAnswering here: never a second server beside it
	const now = await current(root, env);
	if (now) return now;
	// no server, or a stale runtime file (a server on its way down, a hard-killed one whose pid or port another program
	// holds): the child clears what is stale and starts
	const dir = runtimeDir(env);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const logFile = path.join(dir, `${workspaceKey(root)}.log`);
	const fd = fs.openSync(logFile, 'a', 0o600);
	const child = spawn(process.execPath, [bin, root, 'start', '--foreground'], {
		detached: true,
		stdio: ['ignore', fd, fd],
		env: { ...env, ...(appDir ? { DT_WEB_APP_DIR: appDir } : {}) },
	});
	child.unref();
	fs.closeSync(fd);
	const until = Date.now() + START_WAIT_MS;
	while (Date.now() < until) {
		const rt = await current(root, env, 1000, { refuseSilent: false });
		if (rt) {
			if (rt.movedFrom) log(movedLine(rt.movedFrom, rt.port));
			return rt;
		}
		await sleep(100);
	}
	throw new Error(`dt web did not start within ${START_WAIT_MS / 1000} s — its log: ${logFile}`);
}

export async function main(root, argv, { log = console.log, env = process.env, appDir = env.DT_WEB_APP_DIR || undefined } = {}) {
	const o = parseArgs(argv, env);
	const sdir = stateDir(env);
	const ensure = () => ensureRunning(root, { log, env, appDir });
	try {
		return await verb(root, o, { log, env, appDir, sdir, ensure });
	} catch (e) {
		if (!e?.notAnswering) throw e;
		log(e.message);
		return 1;
	}
}

async function verb(root, o, { log, env, appDir, sdir, ensure }) {

	if (o.cmd === 'status') {
		const now = await probeServer(fileOf(root, env));
		if (now?.state === 'silent') { log(notAnsweringLine(now)); return 1; }
		if (!now?.proven) { log('not running'); return 1; }
		log(`running at http://127.0.0.1:${now.port} · pid ${now.pid} · level ${LEVEL_WORD(readWorkspaceState(root, sdir).level)}${now.owner ? ` · owner ${now.owner}` : ''} · since ${now.started}`);
		return 0;
	}
	if (o.cmd === 'stop') {
		if (o.revoke) { const code = await revoke(root, {}, { log, env }); if (code) return code; }
		const now = await probeServer(fileOf(root, env));
		if (!now) { log('not running'); return o.revoke ? 0 : 1; }
		if (now.state === 'silent') {
			if (!o.force) { log(notAnsweringLine(now)); return 1; }
			// --force signals only a process shown to be this server: the start time the runtime file recorded is its own
			if (now.sameProcess !== true) {
				log(`✖ cannot prove pid ${now.pid} is this workspace's server — it was not signalled (its start time ${now.lstart ? 'could not be read' : 'is not recorded'}); check it yourself: ps -p ${now.pid}`);
				return 1;
			}
			log(`pid ${now.pid} is not answering; its start time is this server's — sending SIGTERM`);
		} else if (!now.proven) {
			clearStale(now.file, now);
			log(`not running — removed a stale runtime file: pid ${now.pid} is not this workspace's server, and was not signalled`);
			return o.revoke ? 0 : 1;
		}
		process.kill(now.pid, 'SIGTERM');
		// stopped = the server removed its runtime file (a process its parent has not reaped yet still answers kill 0)
		const gone = () => !readState(now.file) || !alive(now.pid);
		for (let i = 0; i < 50 && !gone(); i++) await sleep(100);
		log(gone() ? 'stopped' : `pid ${now.pid} did not stop`);
		return gone() ? 0 : 1;
	}
	if (o.cmd === 'list') {
		const rows = readRegistry(sdir);
		if (!rows.length) { log('no workspace was opened with dt web on this machine'); return 0; }
		for (const e of rows) {
			const here = fs.existsSync(e.root);
			const p = here ? await probeServer(fileOf(e.root, env), { timeoutMs: 1000 }) : null;
			const r = p?.proven || p?.state === 'silent' ? p : null;
			const port = r?.port ?? (here ? readWorkspaceState(e.root, sdir).port : null);
			log(`${e.name} · ${port ?? '-'} · ${p?.state === 'silent' ? 'not answering' : r ? 'running' : 'stopped'} · ${e.root}`);
		}
		return 0;
	}
	if (o.cmd === 'hook') {
		const r = installHook(root);
		const rel = path.relative(root, r.file);
		log(r.wrote ? `✔ the pane hook is in ${rel}: ${r.command}` : `the pane hook is already in ${rel}: ${r.command}`);
		if (!r.ignored) log(`add ${rel} to .gitignore — it holds this machine's paths`);
		return 0;
	}
	if (o.cmd === 'revoke') return revoke(root, { token: o.token }, { log, env });
	if (o.cmd === 'start') {
		if (o.foreground) return foreground(root, o, { log, env, appDir });
		const rt = await ensure();
		log(`running at http://127.0.0.1:${rt.port}`);
		return 0;
	}
	if (o.cmd === 'open') {
		await register({ root, name: workspaceName(root) }, sdir);
		const rt = await ensure();
		if (o.level) {
			const r = await ask(rt, 'POST', '/_dt/level', { level: o.level });
			if (r.status !== 200) return failed(log, r);
		}
		const pair = await ask(rt, 'POST', '/_dt/pair', o.target !== undefined ? { target: o.target } : {});
		if (pair.status !== 200) return failed(log, pair);
		log(`✔ open in the pane: ${pair.body.url}`);
		log(`level: ${LEVEL_WORD(readWorkspaceState(root, sdir).level)}`);
		if (!hookInstalled(root)) log('the chat cannot see the pane yet — run: dt web hook --install');
		if (o.browser) openBrowser(pair.body.url);
		return 0;
	}
	if (o.cmd === 'show' || o.cmd === 'select') {
		const rt = await ensure();
		const body = o.cmd === 'show' ? { type: 'navigate', target: o.target } : o.clear ? { type: 'select', clear: true } : { type: 'select', refs: o.refs };
		const r = await ask(rt, 'POST', '/_dt/push', body);
		if (r.status !== 200) return failed(log, r);
		if (r.body.delivered === 0) { log(`no page is connected — run: dt web open${o.cmd === 'show' ? ` ${o.target}` : ''}`); return 1; }
		log(o.cmd === 'show' ? `✔ the pane shows ${r.body.route}` : `✔ ${r.body.refs.length} selected in the pane`);
		return 0;
	}
	if (o.cmd === 'selection') {
		const rt = await ensure();
		const r = await ask(rt, 'GET', '/_dt/pane');
		if (r.status !== 200) return failed(log, r);
		if (o.json) { log(JSON.stringify({ place: r.body.place, view: r.body.view, refs: r.body.refs, connected: r.body.connected }, null, 2)); return 0; }
		log(`showing: ${r.body.place ?? '-'}`);
		for (const ref of r.body.refs) log(ref);
		return 0;
	}
	if (o.cmd === 'token') {
		const rt = await ensure();
		const r = await ask(rt, 'POST', '/_dt/token', { name: o.name ?? 'default', level: o.level ?? 'read' });
		if (r.status !== 200) return failed(log, r);
		log(`API ${r.body.api}`);
		log(`token ${r.body.token}`);
		return 0;
	}
	throw bad(`dt web has no verb "${o.cmd}"`);
}

/** `dt web revoke [--token <n>]`: through the server when it runs, else in the state file under the start lock. */
async function revoke(root, { token }, { log, env }) {
	const said = (n) => {
		log(token !== undefined ? (n ? `✔ revoked the token ${token}` : `no token named ${token}`) : `✔ revoked ${n} session(s)`);
		return token !== undefined && !n ? 1 : 0;
	};
	const rt = await current(root, env);
	if (rt) {
		const r = await ask(rt, 'POST', '/_dt/revoke', token !== undefined ? { token } : {});
		if (r.status !== 200) return failed(log, r);
		return said(r.body.revoked);
	}
	// no server, no session: they live in its memory only, so a stopped server has signed every page out already
	if (token === undefined) return said(0);
	const lock = claimStart(stateFile(root, runtimeDir(env)));
	if (!lock.ok) { log(`dt web is starting${lock.pid ? ` (pid ${lock.pid})` : ''} — run dt web revoke again`); return 1; }
	try {
		const dir = stateDir(env);
		const state = readWorkspaceState(root, dir);
		const n = state.clientTokens.length;
		state.clientTokens = state.clientTokens.filter((t) => t.name !== token);
		writeWorkspaceState(root, state, dir);
		return said(n - state.clientTokens.length);
	} finally { lock.release(); }
}

/** `dt web start --foreground`: serve in this process — what the detached child runs, and a launch.json entry. */
async function foreground(root, o, { log, env, appDir = appDirOf() }) {
	const file = fileOf(root, env);
	const was = await probeServer(file);
	if (was?.proven) { log(`already running at http://127.0.0.1:${was.port} (pid ${was.pid})`); return 1; }
	if (was?.state === 'silent') { log(notAnsweringLine(was)); return 1; }
	// a runtime file whose process lives but cannot prove it is this server: stale, with its lock when that pid holds it
	if (was) clearStale(file, was);
	const { startWeb } = await import('./server.js');
	const lock = claimStart(file);
	if (!lock.ok) { log(`already running or starting${lock.pid ? ` (pid ${lock.pid})` : ''} — dt web status`); return 1; }
	let web;
	try {
		web = await startWeb({ root, appDir, port: o.port ?? 0, idleMinutes: o.idle ?? 60, ownerPid: o.ownerPid, stateDir: stateDir(env), onStop: () => { removeState(file); lock.release(); } });
	} catch (e) {
		lock.release();
		throw e;
	}
	writeState(file, { pid: process.pid, port: web.port, started: new Date().toISOString(), owner: o.ownerPid ?? null, token: web.controlToken, instance: web.instance, lstart: processStart(process.pid), ...(web.movedFrom ? { movedFrom: web.movedFrom } : {}) });
	// the handlers before the first line: a caller may signal the moment it reads it
	const stop = () => web.close('signal');
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	log(`✔ dt web serving ${workspaceName(root)} at http://127.0.0.1:${web.port} · pid ${process.pid}`);
	if (web.movedFrom) log(movedLine(web.movedFrom, web.port));
	const why = await web.closed;
	log(`stopped: ${why}`);
	removeState(file);
	lock.release();
	return 0;
}

function openBrowser(url) {
	const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
	try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* print-only */ }
}

export { readState };
