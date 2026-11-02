// `dt web` and `dt-web <root>`: start · url · status · stop (README § commands). One argv grammar for both
// entries; `main` resolves to the process exit code.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readState, removeState, running, stateFile, writeState, alive } from './runtime.js';

// the browser page @dreamteamer/ui builds, served as it is
const appDirOf = () => path.join(path.dirname(createRequire(import.meta.url).resolve('@dreamteamer/ui/package.json')), 'dist', 'app');

export function parseArgs(argv, env = process.env) {
	const out = { cmd: 'start', port: env.DT_WEB_PORT !== undefined ? Number(env.DT_WEB_PORT) : 0, open: true, idle: 30, ownerPid: undefined };
	const args = [...argv];
	if (['url', 'status', 'stop'].includes(args[0])) out.cmd = args.shift();
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const m = /^--(port|idle|owner-pid)(?:=(.*))?$/.exec(a);
		if (a === '--no-open') { out.open = false; continue; }
		if (!m) throw new Error(`dt web does not take "${a}" — usage: dt web [url|status|stop] [--port <n>] [--no-open] [--idle <minutes>] [--owner-pid <pid>]`);
		const v = m[2] ?? args[++i];
		if (v === undefined || !/^\d+$/.test(v)) throw new Error(`--${m[1]} needs a whole number`);
		if (m[1] === 'port') { if (Number(v) > 65535) throw new Error('--port must be 0..65535'); out.port = Number(v); }
		if (m[1] === 'idle') out.idle = Number(v);
		if (m[1] === 'owner-pid') out.ownerPid = Number(v);
	}
	if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error('DT_WEB_PORT must be 0..65535');
	return out;
}

export async function main(root, argv, { log = console.log, env = process.env, appDir = env.DT_WEB_APP_DIR ?? appDirOf() } = {}) {
	const o = parseArgs(argv, env);
	const now = running(root);
	if (o.cmd === 'status') {
		if (!now) { log('not running'); return 1; }
		log(`running at http://127.0.0.1:${now.port} · pid ${now.pid}${now.owner ? ` · owner ${now.owner}` : ''} · since ${now.started}`);
		return 0;
	}
	if (o.cmd === 'stop') {
		if (!now) { log('not running'); return 1; }
		process.kill(now.pid, 'SIGTERM');
		// stopped = the server removed its state file (a process its parent has not reaped yet still answers kill 0)
		const gone = () => !readState(now.file) || !alive(now.pid);
		for (let i = 0; i < 50 && !gone(); i++) await new Promise((r) => setTimeout(r, 100));
		log(gone() ? 'stopped' : `pid ${now.pid} did not stop`);
		return gone() ? 0 : 1;
	}
	if (o.cmd === 'url') {
		if (!now) { log('not running'); return 1; }
		const r = await fetch(`http://127.0.0.1:${now.port}/_dt/sign-in`, { method: 'POST', headers: { authorization: `Bearer ${now.token}` }, signal: AbortSignal.timeout(10_000) });
		if (!r.ok) { log(`the server refused: ${r.status}`); return 1; }
		log((await r.json()).url);
		return 0;
	}
	if (now) { log(`already running at http://127.0.0.1:${now.port} (pid ${now.pid}) — npx dt web url`); return 1; }
	const { startWeb } = await import('./server.js');
	const ownerPid = o.ownerPid ?? (env.CLAUDE_PID ? Number(env.CLAUDE_PID) : undefined);
	const file = stateFile(root);
	const web = await startWeb({ root, appDir, port: o.port, idleMinutes: o.idle, ownerPid, onStop: () => removeState(file) });
	writeState(file, { pid: process.pid, port: web.appPort, filesPort: web.filesPort, started: new Date().toISOString(), owner: ownerPid ?? null, token: web.token });
	const url = web.signInUrl();
	log(`✔ dreamteamer web at ${url}`);
	if (o.open) openBrowser(url);
	const stop = () => web.close('signal');
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	await web.closed;
	removeState(file);
	return 0;
}

function openBrowser(url) {
	const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
	try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* print-only */ }
}

export { readState };
