// dt web's two loopback listeners. The APP origin serves the UI, the protocol at /api/ and the live channel;
// the FILES origin serves the record files a record points at, sandboxed, with no cookie and no API, under a
// per-start key (README § security). Every rule here is written in modules/web/README.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHandler } from '@dreamteamer/protocol/handler';
import { engine } from '@dreamteamer/protocol/host/engine';
import { envRoots } from '@dreamteamer/protocol/host/folder-images';
import { changeScope, invalidateMessage } from '@dreamteamer/protocol/host/changes';
import { appCsp, baseHeaders, FILE_CSP } from './headers.js';

const SIGN_IN_TTL_MS = 10 * 60_000;
const DEBOUNCE_MS = 150;
const random = (n = 24) => crypto.randomBytes(n).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };

/** `file` under `root` after resolving every link, or null — `..`, absolute paths and links out are refused. */
export function contained(root, rel) {
	if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
	let realRoot, real;
	try { realRoot = fs.realpathSync(root); real = fs.realpathSync(path.join(root, rel)); } catch { return null; }
	return real === realRoot || real.startsWith(realRoot + path.sep) ? real : null;
}

const hostNames = (port) => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

/**
 * Start dt web for the workspace at `root`. `appDir` holds the built app (index.html + assets/) — @dreamteamer/ui's dist/app.
 * Resolves `{ appUrl, filesOrigin, token, signInUrl(), close(), closed }`.
 */
export async function startWeb({ root, appDir, port = 0, idleMinutes = 30, ownerPid, onStop, signInTtlMs = SIGN_IN_TTL_MS } = {}) {
	if (!fs.existsSync(path.join(appDir, 'index.html'))) {
		throw new Error(`the app is missing: ${path.join(appDir, 'index.html')} — @dreamteamer/ui is installed without its build (see the README)`);
	}
	const handler = await createHandler({ root });
	const token = random(32);
	const filesKey = random(18);
	const signIns = new Map(); // code → expiry
	const sessions = new Set();
	const clients = new Set();
	let appPort, filesPort;

	// ---- the files origin --------------------------------------------------------------------
	const varRoots = () => { try { const e = engine(); return envRoots(e.declaredVars ?? [], e.renderEnv); } catch { return []; } };
	const fileBases = () => {
		const out = [];
		try {
			const { isBinary, storageOf } = engine().descriptor;
			for (const d of handler.api.descriptors().values()) if (isBinary(d) && storageOf(d).path) out.push({ collection: String(d.name), path: storageOf(d).path, suffix: String(storageOf(d).suffix ?? '') });
		} catch { /* no binary collections */ }
		return out;
	};
	const frameRoutes = [];
	const files = http.createServer((req, res) => {
		baseHeaders(res);
		res.setHeader('Content-Security-Policy', FILE_CSP);
		if (!hostNames(filesPort).has(String(req.headers.host ?? '').toLowerCase())) return send(res, 403, 'not this server');
		if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'cross-site');
		if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'read only');
		const url = new URL(req.url, 'http://x');
		const parts = url.pathname.split('/').slice(1);
		if (!same(parts[0], filesKey)) return send(res, 404, 'not found');
		const kind = parts[1];
		const rest = parts.slice(2).map((p) => { try { return decodeURIComponent(p); } catch { return '\0'; } });
		if (kind === '_dt' && rest[0] === 'frame') {
			for (const r of frameRoutes) { const out = r(rest.slice(1), req); if (out) return sendFile(res, out.body, out.type ?? 'text/html; charset=utf-8', out.headers); }
			return send(res, 404, 'no frame');
		}
		let file = null;
		if (kind === 'v') {
			const r = varRoots().find((x) => x.name === rest[0]);
			if (r) file = contained(r.path, rest.slice(1).join('/'));
		} else if (kind === 'w') {
			const rel = rest.join('/');
			const allowed = rel.endsWith('.html') && !rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules')
				|| fileBases().some((b) => rel.startsWith(b.path.replace(/\\/g, '/') + '/'));
			if (allowed) file = contained(root, rel);
		}
		if (!file || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
		const ext = path.extname(file).toLowerCase();
		const headers = {};
		if ((ext === '.svg' || ext === '.html') && url.searchParams.get('frame') !== '1') headers['Content-Disposition'] = 'attachment';
		return sendFile(res, fs.readFileSync(file), MIME[ext] ?? 'application/octet-stream', headers);
	});

	// ---- the app origin ----------------------------------------------------------------------
	const appHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
	const filesOrigin = () => `http://127.0.0.1:${filesPort}`;
	const boot = (nonce) => {
		const base = `${filesOrigin()}/${filesKey}`;
		const globals = {
			__DT_HOST__: { nav: 'app', commands: false, openFile: 'tab', tabs: false, history: 'hash' },
			__DT_UI_BASE__: '/ui-modules',
			__DT_FILE_BASES__: fileBases().map((b) => ({ ...b, uri: `${base}/w/${b.path}` })),
			__DT_VAR_ROOTS__: varRoots().map((r) => ({ ...r, uri: `${base}/v/${encodeURIComponent(r.name)}` })),
			__DT_FILES__: base,
		};
		const json = JSON.stringify(globals).replace(/</g, '\\u003c');
		return `<script nonce="${nonce}">Object.assign(window, ${json});</script>`;
	};

	const authed = (req) => {
		const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
		if (m && same(m[1], token)) return 'bearer';
		const sid = /(?:^|;\s*)dt_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
		return sid && sessions.has(sid) ? 'cookie' : null;
	};
	// a request that throws — a malformed percent-escape, a client gone mid-body — answers or is dropped, never
	// takes the server down with it
	const app = http.createServer((req, res) => {
		handle(req, res).catch((err) => {
			if (res.headersSent || req.destroyed) return void res.destroy();
			json(res, err instanceof URIError ? 400 : 500, { error: err instanceof URIError ? 'a malformed percent-escape in the path' : 'the request failed' });
		});
	});
	const handle = async (req, res) => {
		baseHeaders(res);
		const host = String(req.headers.host ?? '').toLowerCase();
		if (!hostNames(appPort).has(host)) return send(res, 403, `Host "${req.headers.host ?? ''}" is not this server — use 127.0.0.1:${appPort}`);
		if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'a request from another site is refused');
		const origin = req.headers.origin;
		if (origin !== undefined && !(origin.startsWith('http://') && hostNames(appPort).has(origin.slice(7).toLowerCase()))) return send(res, 403, `Origin "${origin}" may not call this server`);
		const url = new URL(req.url, 'http://x');

		if (req.method === 'GET' && url.pathname.startsWith('/sign-in/')) {
			const code = url.pathname.slice('/sign-in/'.length);
			const exp = signIns.get(code);
			signIns.delete(code);
			if (!exp || exp < Date.now()) return page(res, 401, 'Sign in with the URL <code>dt web</code> printed — run <code>npx dt web url</code> for a new one.');
			const sid = random(32);
			sessions.add(sid);
			res.setHeader('Set-Cookie', `dt_session=${sid}; HttpOnly; SameSite=Strict; Path=/`);
			res.writeHead(302, { Location: '/' });
			return res.end();
		}
		if (req.method === 'POST' && url.pathname === '/_dt/sign-in') {
			if (authed(req) !== 'bearer') return send(res, 401, 'a new sign-in URL needs the bearer token');
			return json(res, 200, { url: signInUrl() });
		}
		const who = authed(req);
		if (!who) {
			if (url.pathname.startsWith('/api/')) { res.setHeader('WWW-Authenticate', 'Bearer'); return json(res, 401, { error: 'sign in with the URL dt web printed, or send Authorization: Bearer <token>' }); }
			return page(res, 401, 'Sign in with the URL <code>dt web</code> printed — run <code>npx dt web url</code> for a new one.');
		}
		const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
		if (write && who === 'cookie') {
			const named = (origin !== undefined) || req.headers['sec-fetch-site'] === 'same-origin';
			if (!named) return json(res, 403, { error: 'a write with the session cookie must carry this server\'s Origin or Sec-Fetch-Site: same-origin — or send Authorization: Bearer <token>' });
		}

		if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
			const nonce = random(16);
			res.setHeader('Content-Security-Policy', appCsp(nonce, filesOrigin()));
			res.setHeader('Cache-Control', 'no-store');
			return sendFile(res, appHtml.replace(/<head>/i, `<head>${boot(nonce)}`), 'text/html; charset=utf-8');
		}
		if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
			const f = contained(path.join(appDir, 'assets'), decodeURIComponent(url.pathname.slice(8)));
			if (!f) return send(res, 404, 'not found');
			return sendFile(res, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream');
		}
		if (req.method === 'GET' && url.pathname.startsWith('/ui-modules/')) {
			const f = contained(path.join(root, '.dreamteamer', 'ui'), decodeURIComponent(url.pathname.slice(12)));
			if (!f) return send(res, 404, 'not found');
			return sendFile(res, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream');
		}
		if (req.method === 'GET' && url.pathname === '/api/events') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
			res.write(': open\n\n');
			clients.add(res);
			idle.reset();
			req.on('close', () => { clients.delete(res); idle.reset(); });
			return;
		}
		if (url.pathname.startsWith('/api/')) {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			let body;
			if (write && raw.length) {
				try { body = JSON.parse(raw); } catch { return json(res, 415, { error: `${req.method} ${url.pathname} takes a JSON body` }); }
			}
			const log = console.log;
			console.log = () => {};
			try {
				const out = await handler.handle(req.method, req.url.slice(4), body);
				return json(res, out.status, out.body ?? null);
			} catch (e) {
				return json(res, 500, { error: String(e?.message ?? e) });
			} finally { console.log = log; }
		}
		return send(res, 404, 'not found');
	};


	// ---- live updates ------------------------------------------------------------------------
	let pending = null;
	let timer = null;
	const broadcast = (scope) => {
		const data = `data: ${JSON.stringify(invalidateMessage(scope))}\n\n`;
		for (const c of clients) c.write(data);
	};
	const changed = (file) => {
		const scope = changeScope(root, file);
		pending = pending === 'schema' || scope === 'schema' ? 'schema' : 'data';
		clearTimeout(timer);
		timer = setTimeout(() => { const s = pending; pending = null; broadcast(s); }, DEBOUNCE_MS);
	};
	const watchers = [];
	const watchDir = (dir) => {
		if (!fs.existsSync(dir)) return;
		try { watchers.push(fs.watch(dir, { recursive: true }, (_e, f) => f && changed(path.join(dir, String(f))))); } catch { /* unwatchable */ }
	};
	for (const d of ['data', 'state', '.dreamteamer']) watchDir(path.join(root, d));
	try { for (const l of fs.readdirSync(path.join(root, 'git_modules'))) watchDir(path.join(root, 'git_modules', l, 'data')); } catch { /* no layers */ }

	// ---- lifetime ----------------------------------------------------------------------------
	let stopped = false;
	let resolveClosed;
	const closed = new Promise((r) => { resolveClosed = r; });
	const close = async (why = 'stopped') => {
		if (stopped) return closed;
		stopped = true;
		clearTimeout(timer); idle.clear(); clearInterval(ownerTimer);
		for (const w of watchers) w.close();
		for (const c of clients) c.end();
		const done = Promise.all([new Promise((r) => app.close(r)), new Promise((r) => files.close(r))]);
		app.closeAllConnections?.(); files.closeAllConnections?.();
		await done;
		onStop?.(why);
		resolveClosed(why);
		return closed;
	};
	const idle = {
		t: null,
		clear() { clearTimeout(this.t); this.t = null; },
		reset() {
			this.clear();
			if (idleMinutes > 0 && clients.size === 0) this.t = setTimeout(() => close('idle'), idleMinutes * 60_000);
		},
	};
	const ownerTimer = ownerPid ? setInterval(() => { try { process.kill(ownerPid, 0); } catch (e) { if (e.code !== 'EPERM') close('owner gone'); } }, 5_000) : null;
	ownerTimer?.unref?.();

	const listen = (srv, p) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(p, '127.0.0.1', () => { srv.off('error', reject); resolve(srv.address().port); }); });
	appPort = await listen(app, port);
	filesPort = await listen(files, 0);
	idle.reset();
	const signInUrl = () => {
		const code = random(24);
		signIns.set(code, Date.now() + signInTtlMs);
		return `http://127.0.0.1:${appPort}/sign-in/${code}`;
	};
	return {
		appUrl: `http://127.0.0.1:${appPort}`,
		appPort,
		filesPort,
		filesOrigin: filesOrigin(),
		token,
		signInUrl,
		/** cr-modules-008's frame document plugs in here: (segments after /_dt/frame/, req) → { body, type?, headers? } | null */
		addFrameRoute: (fn) => frameRoutes.push(fn),
		close,
		closed,
	};
}

function send(res, status, text) {
	res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end(text);
}
function json(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}
function page(res, status, html) {
	res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" });
	res.end(`<!doctype html><meta charset="utf-8"><title>dreamteamer</title><p style="font:14px system-ui;margin:2em">${html}</p>`);
}
function sendFile(res, body, type, headers = {}) {
	res.writeHead(200, { 'Content-Type': type, ...headers });
	res.end(body);
}
