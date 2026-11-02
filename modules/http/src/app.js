// The REST api over the same validating store the CLI uses. `createApp` builds it without listening,
// so a host tool or a test can mount it; `serve` listens. Every engine call goes through `dt`, the
// running engine's public API that `activate(dt)` bound.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { dt } from './engine.js';
import { createHandler } from '@dreamteamer/protocol/handler';

export { bind } from './engine.js';

const GIT_TIMEOUT_MS = 30_000;

/**
 * The express app for one workspace. `ws` is the handle from `dt.openWorkspace`; its `root` is the
 * workspace the shared handler (@dreamteamer/protocol) answers for — the same host side the VS Code
 * extension runs in-process, so dt serve answers every route with the extension's shapes and cannot fall
 * behind it. The handler loads the WORKSPACE's own engine (the one `dt` resolves: a `git_modules/dreamteamer`
 * shadow, else `node_modules/dreamteamer`) and re-opens it before every compile-gated write.
 *
 * In front of it, the TRANSPORT rules only a network host has: `Host` and `Origin` must be this server's own
 * (403), a token when one is set (401), and a write's body must be JSON (415). A same-origin or Origin-less
 * write's body is parsed as JSON whatever its `Content-Type` — a workspace module's bare
 * `fetch('/api/…', { method, body: JSON.stringify(x) })` sends `text/plain` — while a cross-site one never
 * gets this far (403). Dry run is the handler's: a plan where it has a planner, the null plan elsewhere.
 *
 * `host` is the name the server was bound to; `token`, when set, is required on every request as
 * `Authorization: Bearer <token>`.
 */
export function createApp(ws, { host, token } = {}) {
	if (!dt) throw new Error('@dreamteamer/http: no engine bound — activate(dt) binds it; a tool mounting createApp calls bind(api) first');
	const app = express();
	app.use(requestGuard({ host, token }));
	let handler = null;
	const ready = () => (handler ??= createHandler({ root: ws.root }));

	app.use('/api', express.text({ type: () => true, limit: '10mb' }), async (req, res) => {
		let body;
		if (!READS.has(req.method) && typeof req.body === 'string' && req.body.length) {
			try { body = JSON.parse(req.body); } catch {
				return res.status(415).json({ error: `${req.method} /api${req.path} takes a JSON body (got ${String(req.headers['content-type'] ?? 'no content type')} that does not parse)` });
			}
		}
		try {
			const h = await ready();
			const out = await quietly(() => h.handle(req.method, req.url, body));
			// a repository blocked by an in-progress merge or rebase: the results say which, and over HTTP
			// the status says so too (the protocol's transport rule for POST /commit)
			const blocked = req.method === 'POST' && req.path === '/commit' && Array.isArray(out.body) && out.body.some((r) => r?.blocked);
			res.status(blocked ? 409 : out.status).json(out.body ?? null);
		} catch (e) {
			res.status(500).json({ error: String(e?.message ?? e) });
		}
	});
	app.get('/', (req, res) => res.redirect('/api/info'));
	return app;
}

/** The engine's schema ops REPORT by printing; a server's stdout is not the place for a write's report. */
async function quietly(fn) {
	const log = console.log;
	console.log = () => {};
	try { return await fn(); } finally { console.log = log; }
}

/** Listen on `host:port` (loopback by default). Resolves with the http.Server once it is listening.
 *  A host beyond loopback is refused unless `token` is set. */
export async function serve(ws, { port = 8080, host = '127.0.0.1', token } = {}) {
	assertExposure(host, token);
	const server = http.createServer(createApp(ws, { host, token }));
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.off('error', reject);
			const shown = host.includes(':') ? `[${host}]` : host;
			console.log(`✔ dreamteamer api at http://${shown}:${server.address().port}/api`);
			resolve(server);
		});
	});
}

// ---- request guards ---------------------------------------------------------------------------

/** True when `host` names this machine's loopback interface. */
function isLoopbackHost(host) {
	const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
	return h === 'localhost' || h === '::1' || (net.isIPv4(h) && h.startsWith('127.'));
}

/** A host beyond loopback needs a token; refused before anything listens. */
export function assertExposure(host, token) {
	if (!isLoopbackHost(host) && !token) {
		throw new Error(`--host ${host} is beyond loopback and needs --token <secret>; every request then sends "Authorization: Bearer <secret>"`);
	}
}

/** An address as it appears in a Host header: lower-case, IPv6 bracketed, IPv4-mapped unwrapped. */
const hostLiteral = (h) => {
	const bare = String(h).toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.)/, '');
	return net.isIPv6(bare) ? `[${bare}]` : bare;
};
const WILDCARD = new Set(['0.0.0.0', '[::]']);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/**
 * Every request: `Host` is the address the connection arrived on, the bound `--host` name, or (on a
 * loopback address) `localhost`, `127.0.0.1` or `[::1]` — each with the bound port. An `Origin`, when
 * sent, is `http://` plus one of those. With a token, `Authorization: Bearer <token>`. A page on
 * another origin, or a DNS name rebound to this address, is answered 403 before any route runs.
 */
function requestGuard({ host, token }) {
	const tokenHash = token ? sha(token) : null;
	return (req, res, next) => {
		const port = req.socket.localPort;
		const local = hostLiteral(req.socket.localAddress ?? '');
		const names = new Set([local]);
		if (host && !WILDCARD.has(hostLiteral(host))) names.add(hostLiteral(host));
		if (isLoopbackHost(local)) for (const n of ['localhost', '127.0.0.1', '[::1]']) names.add(n);
		const allowed = new Set([...names].map((n) => `${n}:${port}`));
		if (port === 80) for (const n of names) allowed.add(n);
		if (!allowed.has(String(req.headers.host ?? '').toLowerCase())) {
			return res.status(403).json({ error: `Host "${req.headers.host ?? ''}" is not this server — use ${local}:${port}` });
		}
		const origin = req.headers.origin;
		if (origin !== undefined && !(/^http:\/\//i.test(origin) && allowed.has(origin.slice(7).toLowerCase()))) {
			return res.status(403).json({ error: `Origin "${origin}" may not call this api — only http://${local}:${port}` });
		}
		if (tokenHash) {
			const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
			if (!m || !crypto.timingSafeEqual(sha(m[1]), tokenHash)) {
				return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'this api needs "Authorization: Bearer <token>" with the --token it was started with' });
			}
		}
		next();
	};
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

// List-level "last modified": ONE `git log` per listing, newest first, so the first sighting of a
// path is its latest commit. A dir outside the repo, or with no history (untracked, or the gitignored
// runtime), degrades to an empty map — every row gets `null`.
/** Workspace-relative path → the instant of its last commit, for every file under `dirs` (one or
 *  several folders — one git call either way). Exported for its test; the app is its consumer. */
export function gitModifiedMap(root, dirs) {
	const map = new Map();
	const rels = [].concat(dirs).map((dir) => path.relative(root, dir)).filter((rel) => rel && !rel.startsWith('..'));
	if (!rels.length) return map;
	let out;
	try {
		out = execFileSync('git', ['log', '--format=%x01%aI', '--name-only', '--', ...rels], { cwd: root, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
	} catch { return map; }
	let date = null;
	for (const line of out.split('\n')) {
		if (line.startsWith('\x01')) { date = line.slice(1); continue; }
		if (line && !map.has(line)) map.set(line, date);
	}
	return map;
}

/** One record's last commit — date, author name, subject. */
function gitLastCommit(root, file) {
	const rel = path.relative(root, file);
	if (rel.startsWith('..')) return null;
	try {
		const out = execFileSync('git', ['log', '-1', '--format=%aI%x00%an%x00%s', '--', rel], { cwd: root, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		if (!out) return null;
		const [date, author, message] = out.split('\0');
		return { date, author, message };
	} catch { return null; }
}
