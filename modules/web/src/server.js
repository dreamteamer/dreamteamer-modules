// dt web's ONE loopback listener (cr-modules-017 §1). A strict prefix dispatcher (dispatch.js) names what a path is
// before anything else runs: the shell (/app/, no cookie, no data), sign-in (/sign-in/<code>), the protocol (/api/,
// the cookie with Fetch-Metadata), the server's own routes (/_dt/), record files (/_files/<key>/, sandboxed) and module
// frames (/_frames/<key>/, sandbox allow-scripts). Every rule here is written in modules/web/README.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHandler } from '@dreamteamer/protocol/handler';
import { validateSelection } from '@dreamteamer/protocol/pane';
import { engine } from '@dreamteamer/protocol/host/engine';
import { envRoots } from '@dreamteamer/protocol/host/folder-images';
import { changeScope, invalidateMessage, NAV_DOC_FILE } from '@dreamteamer/protocol/host/changes';
import { hasNavSettings } from '@dreamteamer/protocol/host/nav';
import { migrateNavSettings } from '@dreamteamer/protocol/nav-doc';
import { workspaceNavSettings } from '@dreamteamer/protocol/nav-model';
import { gate } from '@dreamteamer/protocol/gate';
import { internalCollections, LEVELS, levelRank, lowerLevel, paneScope } from '@dreamteamer/protocol/pane-scope';
import { matchRoute } from '@dreamteamer/protocol/routes';
import { appCsp, baseHeaders, FILE_CSP } from './headers.js';
import { classify } from './dispatch.js';
import { moduleFrameRoute, resolveGuest } from './module-frames.js';
import { createPairing } from './pairing.js';
import { createSessions } from './sessions.js';
import { readWorkspaceState, stateDir as defaultStateDir, workspaceKey, writeWorkspaceState } from './state.js';
import { matchClientToken, mintClientToken } from './tokens.js';
import { createPaneStore, workspaceName } from './pane-store.js';
import { handoff, listWorkspaces } from './handoff.js';

const DEBOUNCE_MS = 150;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
export const NAV_MIGRATED_NOTICE = 'nav.yaml written from your nav settings — they are no longer read';
export const SIGN_IN_REFUSED = 'This sign-in link was used or is older than a minute — ask the chat to show the pane again (dt web open).';
export const NOT_FROM_THE_PANE = "a request with the pane's cookie must come from the pane";
export const CLIENT_NOT_PANE = "a client token cannot set the pane's selection or queue — they are the page's";
export const PAGE_CANNOT_RAISE = (level) => `the page cannot raise the level — ask in the chat (dt web open --${level})`;
const SIGN_IN_FIRST = 'sign in: ask the chat to show the pane (dt web open)';
export const HOST_CAPABILITIES = { nav: 'app', commands: false, openFile: 'tab', tabs: false, history: 'hash', moduleFrames: 'url' };
const random = (n = 24) => crypto.randomBytes(n).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
/** A record file's bytes are data, never code or style the browser would apply. */
const NEVER_ACTIVE = new Set(['.js', '.mjs', '.cjs', '.css']);
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** `file` under `root` after resolving every link, or null — `..`, absolute paths and links out are refused. */
export function contained(root, rel) {
	if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
	let realRoot, real;
	try { realRoot = fs.realpathSync(root); real = fs.realpathSync(path.join(root, rel)); } catch { return null; }
	return real === realRoot || real.startsWith(realRoot + path.sep) ? real : null;
}

const hostNames = (port) => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const decode = (s) => { try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'a malformed percent-escape in the path'); } };

/**
 * Start dt web for the workspace at `root` on one listener. `appDir` holds the built app (index.html + assets/) —
 * @dreamteamer/ui's dist/app. `stateDir` is the per-user state dir (state.js); `pane` the PaneStore the protocol's
 * pane routes answer from (absent: the handler's own memory store).
 * Resolves `{ url, port, controlToken, filesKey, pair({ route?, cap? }) → url, broadcast(msg), clients() → number, close(why?), closed, movedFrom? }` — `movedFrom` the stored port it could not take.
 */
export async function startWeb({ root, appDir, port = 0, idleMinutes = 60, ownerPid, onStop, now = Date.now, stateDir = defaultStateDir(), moduleGuest, pane } = {}) {
	if (!fs.existsSync(path.join(appDir, 'index.html'))) {
		throw new Error(`the app is missing: ${path.join(appDir, 'index.html')} — @dreamteamer/ui is installed without its build (see the README)`);
	}
	const state = readWorkspaceState(root, stateDir);
	const save = () => writeWorkspaceState(root, state, stateDir);
	const sessions = createSessions({ now });
	const pairing = createPairing({ now });
	const controlToken = random(32);
	const filesKey = random(18);
	let handler = null;
	const store = pane ?? createPaneStore({
		root, state, save, filesKey, now,
		workspace: { id: workspaceKey(root), name: workspaceName(root) },
		fileBases: () => fileBases(),
		varRoots: () => varRoots(),
		onChange: (type) => broadcast({ type }),
	});
	handler = await createHandler({ root, pane: store });
	// cr-dt-008: the old nav settings are written into nav.yaml on the first GET /nav of this server's life, once; a
	// failure is logged and the request still answers (the legacy tree, from the settings)
	let navMigrationTried = false;
	const migrateNavOnce = () => {
		if (navMigrationTried) return false;
		navMigrationTried = true;
		try {
			if (fs.existsSync(path.join(root, NAV_DOC_FILE))) return false;
			const settings = workspaceNavSettings(root);
			return hasNavSettings(settings) && migrateNavSettings(root, settings).written;
		} catch (e) {
			console.error(`dt web: your nav settings were not written into nav.yaml — ${String(e?.message ?? e).split('\n')[0]}`);
			return false;
		}
	};

	const clientStreams = new Set();
	let listenPort;
	const cookieName = () => `dt_pane_${listenPort}`;

	// ---- record files and module frames --------------------------------------------------------
	const varRoots = () => { try { const e = engine(); return envRoots(e.declaredVars ?? [], e.renderEnv); } catch { return []; } };
	const fileBases = () => {
		const out = [];
		try {
			const { isBinary, storageOf } = engine().descriptor;
			for (const d of handler.api.descriptors().values()) if (isBinary(d) && storageOf(d).path) out.push({ collection: String(d.name), path: storageOf(d).path, suffix: String(storageOf(d).suffix ?? '') });
		} catch { /* no binary collections */ }
		return out;
	};
	// cr-modules-008: module apps run in frames; `moduleGuest: null` forces the missing-guest path in tests
	const frameRoute = moduleFrameRoute({ root, appPort: () => listenPort, guest: moduleGuest === undefined ? resolveGuest(path.dirname(new URL(import.meta.url).pathname)) : moduleGuest });

	const serveFile = (req, res, url, rest) => {
		res.setHeader('Content-Security-Policy', FILE_CSP);
		if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'read only');
		const [key, kind, ...tail] = rest;
		if (!same(key, filesKey)) return send(res, 404, 'not found');
		const parts = tail.map(decode);
		let file = null;
		if (kind === 'v') {
			const r = varRoots().find((x) => x.name === parts[0]);
			if (r) file = contained(r.path, parts.slice(1).join('/'));
		} else if (kind === 'w') {
			const rel = parts.join('/');
			const allowed = rel.endsWith('.html') && !rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules')
				|| fileBases().some((b) => rel.startsWith(b.path.replace(/\\/g, '/') + '/'));
			if (allowed) file = contained(root, rel);
		}
		if (!file || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
		const ext = path.extname(file).toLowerCase();
		const headers = {};
		if ((ext === '.svg' || ext === '.html') && url.searchParams.get('frame') !== '1') headers['Content-Disposition'] = 'attachment';
		const type = NEVER_ACTIVE.has(ext) ? 'application/octet-stream' : (MIME[ext] ?? 'application/octet-stream');
		return sendFile(res, fs.readFileSync(file), type, headers, req.method === 'HEAD');
	};
	const serveFrame = (req, res, rest) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'read only');
		const [key, ...tail] = rest;
		if (!same(key, filesKey)) return send(res, 404, 'not found');
		const out = frameRoute(tail.map(decode), req);
		if (!out) return send(res, 404, 'no frame');
		if (out.status) return send(res, out.status, out.body);
		return sendFile(res, out.body, out.type ?? 'text/html; charset=utf-8', out.headers, req.method === 'HEAD');
	};

	// ---- the shell -----------------------------------------------------------------------------
	const appHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
	const boot = (nonce) => {
		const json = JSON.stringify({ __DT_HOST__: HOST_CAPABILITIES }).replace(/</g, '\\u003c');
		return `<script nonce="${nonce}">Object.assign(window, ${json});</script>`;
	};
	const serveShell = (req, res, url, host) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'the app is read only');
		const rel = url.pathname.slice('/app/'.length);
		if (rel === '' || rel === 'index.html') {
			const nonce = random(16);
			res.setHeader('Content-Security-Policy', appCsp(nonce, host));
			res.setHeader('Cache-Control', 'no-store');
			return sendFile(res, appHtml.replace(/<head>/i, `<head>${boot(nonce)}`), 'text/html; charset=utf-8', {}, req.method === 'HEAD');
		}
		const f = contained(appDir, decode(rel));
		if (!f || !fs.statSync(f).isFile()) return send(res, 404, 'not found');
		return sendFile(res, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream', {}, req.method === 'HEAD');
	};

	// ---- sign-in -------------------------------------------------------------------------------
	const signIn = (req, res, url) => {
		if (req.method !== 'GET') return send(res, 405, 'sign in with GET');
		const taken = pairing.take(url.pathname.slice('/sign-in/'.length));
		if (!taken) return page(res, 401, SIGN_IN_REFUSED);
		const sid = sessions.mint(taken.cap ?? null);
		// a browser-session cookie: no Max-Age, since the session itself lives only as long as this process
		res.setHeader('Set-Cookie', `${cookieName()}=${sid}; HttpOnly; SameSite=Strict; Path=/`);
		res.writeHead(302, { Location: `/app/#${taken.route}` });
		return res.end();
	};
	const pairUrl = ({ route = '/', cap = null } = {}) => `http://127.0.0.1:${listenPort}/sign-in/${pairing.mint({ route, cap })}`;

	// ---- who is asking -------------------------------------------------------------------------
	const bearerOf = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
	const cookieOf = (req) => {
		const name = cookieName();
		for (const part of String(req.headers.cookie ?? '').split(';')) {
			const i = part.indexOf('=');
			if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
		}
		return null;
	};
	/** A cookie counts only from the pane's own page: Sec-Fetch-Site same-origin, or an Origin equal to this request's. */
	const fromThePane = (req) => {
		const site = req.headers['sec-fetch-site'];
		const origin = req.headers.origin;
		if (origin !== undefined) return origin === `http://${String(req.headers.host ?? '').toLowerCase()}` && (site === undefined || site === 'same-origin');
		return site === 'same-origin';
	};

	const readBody = async (req) => {
		let size = 0;
		const chunks = [];
		for await (const chunk of req) {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) throw new HttpError(413, 'the body is too large');
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString('utf8');
	};
	/** A write's body: JSON only, by Content-Type — 415 for any other type, 400 for JSON that does not parse. */
	const jsonBody = async (req) => {
		const raw = await readBody(req);
		if (!WRITES.has(req.method) || !raw.length) return undefined;
		if (!JSON_TYPE.test(String(req.headers['content-type'] ?? ''))) throw new HttpError(415, `${req.method} takes Content-Type: application/json`);
		try { return JSON.parse(raw); } catch { throw new HttpError(400, 'the body is not JSON'); }
	};

	// ---- levels ---------------------------------------------------------------------------------
	// the collections whose record WRITES need admin (reading 1), recomputed when the descriptors change
	let internalFor = null;
	let internal = null;
	const internalNow = () => {
		const d = handler.api.descriptors();
		if (d !== internalFor) {
			let e = {};
			try { e = engine().descriptor; } catch { /* no engine: system collections only */ }
			internal = internalCollections(d.values(), e);
			internalFor = d;
		}
		return internal;
	};
	/** The level a request is answered at: the stored level lowered by the session's cap, or the client token's own. */
	const levelOf = (who) => (who.kind === 'client' ? who.record.level : lowerLevel(state.level, who.cap ?? 'admin'));
	const setLevel = (level) => {
		const was = state.level;
		if (levelRank(level) > levelRank(was)) state.raisedAt = new Date(now()).toISOString();
		else if (levelRank(level) < levelRank(was)) state.raisedAt = null;
		state.level = level;
		save();
		broadcast({ type: 'dt:host' });
	};

	// ---- /api/ and /_dt/ -----------------------------------------------------------------------
	/** Who asks /api/: a client token (bearer), or the cookie from the pane's own page. The control token is not one. */
	const apiCaller = (req) => {
		const bearer = bearerOf(req);
		if (bearer !== null) {
			const record = matchClientToken(state.clientTokens, bearer);
			if (!record) return { refuse: [401, same(bearer, controlToken) ? 'the control token opens /_dt/ only — /api/ takes the cookie or a client token (dt web token)' : 'not a client token of this server'] };
			return { kind: 'client', record };
		}
		const sid = cookieOf(req);
		const session = sid ? sessions.check(sid) : null;
		if (!session) return { refuse: [401, SIGN_IN_FIRST] };
		if (!fromThePane(req)) return { refuse: [403, NOT_FROM_THE_PANE] };
		return { kind: 'cookie', cap: session.cap, sid };
	};

	const serveApi = async (req, res, url) => {
		const who = apiCaller(req);
		if (who.refuse) return json(res, who.refuse[0], { error: who.refuse[1] });
		if (who.kind === 'client') idle.reset();
		if (req.method === 'GET' && url.pathname === '/api/events') return openStream(req, res);
		const body = await jsonBody(req);
		const apiPath = req.url.slice(4);
		const hit = matchRoute(req.method, apiPath);
		if (who.kind === 'client' && (hit?.route.id === 'selection-put' || hit?.route.id === 'queue-post')) return json(res, 403, { error: CLIENT_NOT_PANE });
		const level = levelOf(who);
		const decision = gate(paneScope({ level, internal: internalNow(), label: who.kind === 'client' ? 'this token' : 'this pane' }), handler.api.descriptors(), req.method, apiPath, url.searchParams, body);
		// no route: the handler answers its own 404, with the encoding hint
		if (!decision.ok && decision.status !== 404) return json(res, decision.status, { error: decision.error });
		if (hit?.route.id === 'host') return json(res, 200, await store.host({ level }));
		const log = console.log;
		console.log = () => {};
		try {
			const migrated = req.method === 'GET' && url.pathname === '/api/nav' && migrateNavOnce();
			const out = await handler.handle(req.method, apiPath, body);
			if (migrated && out.status === 200 && Array.isArray(out.body) && out.body[0]?.kind === 'workspace') out.body[0] = { ...out.body[0], notice: NAV_MIGRATED_NOTICE };
			return json(res, out.status, out.body ?? null);
		} catch (e) {
			if (e instanceof URIError) throw new HttpError(400, 'a malformed percent-escape in the path');
			return json(res, 500, { error: String(e?.message ?? e) });
		} finally { console.log = log; }
	};

	// ---- the push's targets --------------------------------------------------------------------
	const reader = { descriptors: () => handler.api.descriptors(), handle: (m, p) => handler.handle(m, p) };
	const parseRef = (ref) => { try { return engine().parseRef(ref); } catch { return null; } };
	/** `dt web show`'s target → the app route: a collection, then a record ref, then a ui-view id; null for none. */
	const resolveTarget = async (target) => {
		if (typeof target !== 'string' || !target || target.length > 500) return null;
		if (handler.api.descriptors().has(target)) return `/content/${target}`;
		const ref = parseRef(target);
		if (ref?.collection && ref.id && handler.api.descriptors().has(ref.collection)) {
			const r = await handler.handle('GET', `/collections/${encodeURIComponent(ref.collection)}/records/${ref.id.split('/').map(encodeURIComponent).join('/')}`);
			if (r.status === 200) return `/content/${ref.collection}/${ref.id}`;
		}
		if (!target.includes('/')) {
			const v = await handler.handle('GET', `/collections/ui-views/records/${encodeURIComponent(target)}`);
			const route = v.status === 200 ? v.body?.fields?.route : null;
			if (typeof route === 'string' && route.startsWith('/')) return route;
		}
		return null;
	};
	/** `dt web select`'s refs: existing records, at most 50, all of one collection (as PUT /selection checks them). */
	const checkRefs = async (refs) => {
		const r = await validateSelection(reader, { view: { other: true }, refs });
		if (!r.ok) throw new HttpError(400, r.error);
		if (new Set(r.value.refs.map((x) => parseRef(x)?.collection)).size > 1) throw new HttpError(400, 'the refs of a selection are all of one collection');
		return r.value.refs;
	};

	const levelIn = (body) => {
		if (!LEVELS.includes(body?.level)) throw new HttpError(400, `a level is ${LEVELS.join(', ')}`);
		return body.level;
	};
	/** /_dt/ under the control token: the verbs' routes. */
	const controlRoutes = {
		'POST /_dt/pair': async (body) => {
			let route = typeof body?.route === 'string' && body.route.startsWith('/') ? body.route : '/';
			// `dt web open <target>`: the same resolver as the push
			if (body?.target !== undefined) {
				route = await resolveTarget(body.target);
				if (!route) return [400, { error: `no record, collection or ui-view ${body.target}` }];
			}
			const cap = LEVELS.includes(body?.cap) ? body.cap : null;
			return [200, { url: pairUrl({ route, cap }) }];
		},
		'POST /_dt/token': (body) => {
			let minted;
			try { minted = mintClientToken({ name: body?.name, level: body?.level ?? 'read', now }); } catch (e) { throw new HttpError(400, e.message); }
			state.clientTokens = [...state.clientTokens.filter((t) => t.name !== minted.record.name), minted.record];
			save();
			return [200, { token: minted.token, api: `http://127.0.0.1:${listenPort}/api` }];
		},
		'POST /_dt/revoke': (body) => {
			if (body?.token !== undefined) {
				const n = state.clientTokens.length;
				state.clientTokens = state.clientTokens.filter((t) => t.name !== body.token);
				save();
				return [200, { revoked: n - state.clientTokens.length }];
			}
			const n = sessions.revokeAll();
			for (const c of clientStreams) c.end();
			return [200, { revoked: n }];
		},
		'POST /_dt/level': (body) => { setLevel(levelIn(body)); return [200, { level: state.level, raisedAt: state.raisedAt ?? null }]; },
		'POST /_dt/push': async (body) => {
			if (body?.type === 'navigate') {
				const route = await resolveTarget(body.target);
				if (!route) return [400, { error: `no record, collection or ui-view ${body.target}` }];
				broadcast({ type: 'dt:navigate', route });
				return [200, { route, delivered: clientStreams.size }];
			}
			if (body?.type === 'select') {
				const refs = body.clear === true ? [] : await checkRefs(body.refs);
				broadcast({ type: 'dt:select', refs });
				return [200, { refs, delivered: clientStreams.size }];
			}
			return [400, { error: 'a push is { type: "navigate", target } or { type: "select", refs | clear: true }' }];
		},
		'GET /_dt/pane': (_body, _who, url) => [200, store.snapshot({ hook: url.searchParams.get('hook') === '1', connected: clientStreams.size > 0 })],
		'POST /_dt/pane/delivered': (body) => [200, { delivered: store.delivered(body?.ids) }],
	};
	/** /_dt/ under the cookie: the page's own routes. */
	const pageRoutes = {
		'POST /_dt/level': (body, who) => {
			const level = levelIn(body);
			if (levelRank(level) > levelRank(levelOf(who))) return [403, { error: PAGE_CANNOT_RAISE(level) }];
			if (level !== state.level) setLevel(level);
			return [200, { level }];
		},
		'GET /_dt/workspaces': () => [200, listWorkspaces({ selfId: workspaceKey(root), stateDir })],
		'POST /_dt/handoff': async (body, who) => {
			const r = await handoff({ id: body?.id, pageLevel: levelOf(who), selfId: workspaceKey(root), stateDir, now, moved: (to) => store.moved?.(to) });
			return [r.status, r.body];
		},
	};

	const serveDt = async (req, res, url) => {
		const key = `${req.method} ${url.pathname}`;
		const bearer = bearerOf(req);
		if (bearer !== null) {
			if (!same(bearer, controlToken)) {
				const client = matchClientToken(state.clientTokens, bearer);
				return json(res, 401, { error: client ? 'a client token opens /api/ only' : 'not this server\'s control token' });
			}
			idle.reset();
			const body = await jsonBody(req);
			const fn = controlRoutes[key];
			if (!fn) return json(res, 404, { error: `no route ${key}` });
			const [status, out] = await fn(body, { kind: 'control' }, url);
			return json(res, status, out);
		}
		const sid = cookieOf(req);
		if (sid !== null) {
			if (!fromThePane(req)) return json(res, 403, { error: NOT_FROM_THE_PANE });
			const session = sessions.check(sid);
			if (!session) return json(res, 401, { error: SIGN_IN_FIRST });
			const body = await jsonBody(req);
			const fn = pageRoutes[key];
			if (!fn) return json(res, 401, { error: `${key} takes the control token` });
			const [status, out] = await fn(body, { kind: 'cookie', cap: session.cap, sid }, url);
			return json(res, status, out);
		}
		return json(res, 401, { error: `${url.pathname} takes the control token` });
	};

	// ---- the event stream ----------------------------------------------------------------------
	const openStream = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
		res.write(': open\n\n');
		clientStreams.add(res);
		idle.reset();
		req.on('close', () => { clientStreams.delete(res); idle.reset(); });
	};
	const broadcast = (msg) => {
		const data = `data: ${JSON.stringify(msg)}\n\n`;
		for (const c of clientStreams) c.write(data);
	};

	// ---- one request ---------------------------------------------------------------------------
	const handle = async (req, res) => {
		baseHeaders(res);
		const host = String(req.headers.host ?? '').toLowerCase();
		if (!hostNames(listenPort).has(host)) return send(res, 403, `Host "${req.headers.host ?? ''}" is not this server — use 127.0.0.1:${listenPort}`);
		if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'a request from another site is refused');
		const origin = req.headers.origin;
		if (origin !== undefined && origin !== 'null' && !(origin.startsWith('http://') && hostNames(listenPort).has(origin.slice(7).toLowerCase()))) return send(res, 403, `Origin "${origin}" may not call this server`);
		// CSP has no IPv6 host-source, so module frames cannot name [::1] as an ancestor: the page moves to 127.0.0.1
		if (host.startsWith('[::1]')) {
			res.writeHead(302, { Location: `http://127.0.0.1:${listenPort}${req.url}` });
			return res.end();
		}
		const url = new URL(req.url, 'http://x');
		const rawPath = String(req.url).split('?')[0];
		const kind = classify(rawPath);
		// a sandboxed document (a record file, a module frame) has an opaque origin: it reaches nothing but bytes
		if (origin === 'null' && kind !== 'files' && kind !== 'frames') return kind === 'api' || kind === 'dt' ? json(res, 403, { error: NOT_FROM_THE_PANE }) : send(res, 403, 'a request from a sandboxed document is refused');
		switch (kind) {
			case 'root':
				res.writeHead(302, { Location: '/app/' });
				return res.end();
			case 'shell': return serveShell(req, res, url, host);
			case 'sign-in': return signIn(req, res, url);
			case 'api': return serveApi(req, res, url);
			case 'dt': return serveDt(req, res, url);
			case 'files': return serveFile(req, res, url, rawPath.slice('/_files/'.length).split('/'));
			case 'frames': return serveFrame(req, res, rawPath.slice('/_frames/'.length).split('/'));
			default: return send(res, 404, 'not found');
		}
	};
	// a request that throws — a malformed percent-escape, a client gone mid-body — answers or is dropped, never takes
	// the server down with it
	const server = http.createServer((req, res) => {
		handle(req, res).catch((err) => {
			// a request whose body was read to its end is `destroyed` by then; only a gone socket is beyond answering
			if (res.headersSent || res.destroyed || req.socket?.destroyed) return void res.destroy();
			const status = err instanceof HttpError ? err.status : err instanceof URIError ? 400 : 500;
			const message = err instanceof HttpError ? err.message : err instanceof URIError ? 'a malformed percent-escape in the path' : 'the request failed';
			const kind = classify(String(req.url ?? '').split('?')[0]);
			return kind === 'api' || kind === 'dt' ? json(res, status, { error: message }) : send(res, status, message);
		});
	});

	// ---- live updates ------------------------------------------------------------------------
	let pending = null;
	let timer = null;
	const changed = (file) => {
		const scope = changeScope(root, file);
		pending = pending === 'schema' || scope === 'schema' ? 'schema' : 'data';
		clearTimeout(timer);
		timer = setTimeout(() => { const s = pending; pending = null; broadcast(invalidateMessage(s)); }, DEBOUNCE_MS);
	};
	const watchers = [];
	const watchDir = (dir) => {
		if (!fs.existsSync(dir)) return;
		try { watchers.push(fs.watch(dir, { recursive: true }, (_e, f) => f && changed(path.join(dir, String(f))))); } catch { /* unwatchable */ }
	};
	for (const d of ['data', 'state', '.dreamteamer']) watchDir(path.join(root, d));
	// nav.yaml at the root, by name: a save renames a temp file over it, which only a watch on the folder sees
	try { watchers.push(fs.watch(root, (_e, f) => f && String(f) === NAV_DOC_FILE && changed(path.join(root, NAV_DOC_FILE)))); } catch { /* unwatchable */ }
	try { for (const l of fs.readdirSync(path.join(root, 'git_modules'))) watchDir(path.join(root, 'git_modules', l, 'data')); } catch { /* no layers */ }

	// ---- lifetime ----------------------------------------------------------------------------
	let stopped = false;
	let resolveClosed;
	const closed = new Promise((r) => { resolveClosed = r; });
	let v6 = null;
	const close = async (why = 'stopped') => {
		try { v6?.close(); } catch { /* not listening */ }
		if (stopped) return closed;
		stopped = true;
		clearTimeout(timer); idle.clear(); clearInterval(ownerTimer);
		for (const w of watchers) w.close();
		for (const c of clientStreams) c.end();
		try { store.flush?.(); } catch { /* the state dir went away: the next start reads what was written */ }
		const done = new Promise((r) => server.close(r));
		server.closeAllConnections?.();
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
			if (idleMinutes > 0 && clientStreams.size === 0) this.t = setTimeout(() => close('idle'), idleMinutes * 60_000);
		},
	};
	const ownerTimer = ownerPid ? setInterval(() => { try { process.kill(ownerPid, 0); } catch (e) { if (e.code !== 'EPERM') close('owner gone'); } }, 5_000) : null;
	ownerTimer?.unref?.();

	// the port: the one asked for, else the stored one, else any. A stored port another process took moves the server and
	// the caller says where from (no session outlives a process, so the old port's cookie names nothing here); a port the
	// person asked for is theirs, and taken it is an error. The port is stored at once.
	const listenOn = (p) => new Promise((resolve, reject) => {
		const fail = (e) => reject(e);
		server.once('error', fail);
		server.listen(p, '127.0.0.1', () => { server.off('error', fail); resolve(server.address().port); });
	});
	const stored = port ? null : state.port;
	let movedFrom;
	try {
		try {
			listenPort = await listenOn(port || stored || 0);
		} catch (e) {
			if (e?.code !== 'EADDRINUSE' || !stored) throw e;
			movedFrom = stored;
			listenPort = await listenOn(0);
		}
	} catch (e) {
		clearTimeout(timer); clearInterval(ownerTimer);
		for (const w of watchers) w.close();
		throw e;
	}
	if (state.port !== listenPort) { state.port = listenPort; save(); }
	// [::1] answers only to send the page to 127.0.0.1: CSP cannot name an IPv6 ancestor for module frames (cr-modules-008 t13)
	v6 = http.createServer((req, res) => { baseHeaders(res); res.writeHead(302, { Location: `http://127.0.0.1:${listenPort}${req.url ?? '/'}` }); res.end(); });
	v6.on('error', () => { /* no IPv6 loopback here: nothing to redirect */ });
	v6.listen(listenPort, '::1');
	idle.reset();
	return {
		url: `http://127.0.0.1:${listenPort}`,
		port: listenPort,
		controlToken,
		filesKey,
		pair: pairUrl,
		broadcast,
		clients: () => clientStreams.size,
		close,
		closed,
		...(movedFrom !== undefined ? { movedFrom } : {}),
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
function page(res, status, text) {
	res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" });
	res.end(`<!doctype html><meta charset="utf-8"><title>dreamteamer</title><p style="font:14px system-ui;margin:2em">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`);
}
function sendFile(res, body, type, headers = {}, headOnly = false) {
	res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
	res.end(headOnly ? undefined : body);
}
