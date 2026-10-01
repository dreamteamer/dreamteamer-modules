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

export { bind } from './engine.js';

const GIT_TIMEOUT_MS = 30_000;
const COMMIT_KEYS = ['only', 'message', 'dryRun'];

/**
 * The express app for one workspace. `ws` is the handle from `dt.openWorkspace` — it carries the
 * loaded extensions, and every schema write compiles through it, so an extension's `analyze` judges
 * a write made over HTTP exactly as it judges one made from the CLI.
 *
 * `host` is the name the server was bound to; `token`, when set, is required on every request as
 * `Authorization: Bearer <token>`.
 */
export function createApp(ws, { host, token } = {}) {
	if (!dt) throw new Error('@dreamteamer/http: no engine bound — activate(dt) binds it; a tool mounting createApp calls bind(api) first');
	const app = express();
	app.use(requestGuard({ host, token }));
	app.use(express.json({ limit: '10mb' }));

	// One Store per process, rebuilt when the compiled manifest moves: a `dt compile` elsewhere is
	// visible to the next request without a restart.
	let store = new dt.Store(ws);
	const reload = () => { store = new dt.Store(ws); };
	const manifestPath = path.join(dt.runtimeDir(ws.root), 'manifest.yaml');
	const mtime = () => { try { return fs.statSync(manifestPath).mtimeMs; } catch { return 0; } };
	let manifestMtime = mtime();

	const api = express.Router();
	api.use((req, res, next) => {
		const m = mtime();
		if (m !== manifestMtime) { manifestMtime = m; reload(); }
		next();
	});

	api.use(writeGuard);

	api.get('/info', (req, res) => {
		const manifest = dt.readManifest(ws.root);
		res.json({
			name: ws.pkg.name,
			host: manifest?.host,
			compiled: manifest?.compiled,
			modules: manifest?.modules ?? [],
			ui: manifest?.ui ?? [],
			stale: dt.staleness(ws.root).stale?.length ?? 0,
			collections: [...store.descriptors.keys()],
		});
	});

	api.get('/schema', (req, res) => {
		res.json([...store.descriptors.values()].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
	});

	// ⚠ A NAMESPACED COLLECTION NAME CONTAINS A SLASH (`lab/samples`), and `:name` is one path
	// segment — so a client percent-encodes it: `/collections/lab%2Fsamples/records`. Express matches
	// on the still-encoded path and decodes params afterwards, so `req.params.name` arrives as
	// `lab/samples`. A `*name` wildcard would be wrong: `/collections/*name/records/*id` has several
	// readings of `/collections/a/b/records/c`, and the router would pick one.
	//
	// Record ids are PATHS, so `*id` is a greedy wildcard — and therefore always the LAST segment.
	api.get('/collections/:name/records', (req, res) => {
		const d = store.descriptor(req.params.name);
		const bf = dt.bodyField(d);
		const { limit = 200, offset = 0, sort, q, filter, ...rest } = req.query;
		// EVERY folder the collection's records can sit in — a collection stored under another
		// (`storage.under`, engine 0.32+) keeps most of its files inside the parent's folders, which
		// `store.dir(d)` (its own root) never reaches. Older engines have no `recordDirs`; the fallback
		// is the one root they have.
		const modified = gitModifiedMap(ws.root, store.recordDirs?.(d) ?? [store.dir(d)]);
		let rows = [];
		for (const { id, file, fields } of store.readAll(req.params.name)) {
			// the record id WINS over any schema field named "id"
			rows.push({ ...fields, id, 'last-modified': modified.get(path.relative(ws.root, file)) ?? null });
		}
		// ?filter=<json> — the engine's operators (_eq/_contains/_and/…) plus one-hop relational
		// conditions through the memoized resolver
		if (filter) {
			const f = typeof filter === 'string' ? JSON.parse(filter) : filter;
			const resolve = dt.recordResolver(store);
			rows = rows.filter((r) => dt.matchesFilter(r, f, resolve));
		}
		// simple equality: filter[field]=value or bare field=value
		for (const [k, v] of Object.entries(rest)) {
			if (k === 'with-body') continue;
			const key = k.startsWith('filter[') ? k.slice(7, -1) : k;
			rows = rows.filter((r) => String(r[key] ?? '') === String(v));
		}
		if (q) {
			const needle = String(q).toLowerCase();
			rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
		}
		dt.sortRows(rows, sort);
		const total = rows.length;
		rows = rows.slice(Number(offset), Number(offset) + Number(limit));
		if (bf && req.query['with-body'] !== 'true') for (const r of rows) delete r[bf];
		res.json({ records: rows, total });
	});

	api.get('/collections/:name/records/*id', (req, res) => {
		const id = idParam(req);
		const { fields, file } = store.read(req.params.name, id);
		const commit = gitLastCommit(ws.root, file);
		res.json({
			id,
			fields: {
				...fields,
				'last-modified': commit?.date ?? null,
				'$last-modified-by': commit?.author ?? null,
				'$last-commit-message': commit?.message ?? null,
			},
			path: path.relative(ws.root, file),
		});
	});

	// A SYSTEM collection (compiled into the runtime: collections, modules, skills, ui-views, …) is
	// written through its schema op, not the record store — the same interception the CLI performs.
	const isSystem = (name) => store.descriptors.get(name)?.storage?.base === 'runtime';
	const system = (req, res) => {
		const out = systemWrite(ws, store, req);
		if (!req.dryRun) reload();
		res.json(out);
	};

	api.post('/collections/:name/records', (req, res) => {
		if (isSystem(req.params.name)) return system(req, res);
		const { id: explicitId, ...fields } = req.body ?? {};
		const { id, file } = store.add(req.params.name, fields, { id: explicitId });
		res.status(201).json({ id, path: path.relative(ws.root, file) });
	});

	api.patch('/collections/:name/records/*id', (req, res) => {
		if (isSystem(req.params.name)) return system(req, res);
		// a client may echo the synthetic response keys back on save — never persist them
		const { id: _id, path: _path, 'last-modified': _lm, '$last-modified-by': _lmb, '$last-commit-message': _lcm, ...changes } = req.body ?? {};
		store.set(req.params.name, idParam(req), changes);
		res.json({ id: idParam(req) });
	});

	api.delete('/collections/:name/records/*id', (req, res) => {
		if (isSystem(req.params.name)) return system(req, res);
		store.rm(req.params.name, idParam(req), { force: req.query.force === 'true' });
		res.json({ id: idParam(req) });
	});

	// Manual ordering. ⚠ The verb comes BEFORE the wildcard: `…/records/charlie/position` would read
	// as the record `charlie/position` and the record PATCH would answer 404. Keys are generated by
	// the engine, next to the comparator they must agree with.
	api.patch('/collections/:name/position/*id', (req, res) => {
		const d = store.descriptor(req.params.name);
		const field = d.sort_field;
		if (!field) return res.status(400).json({ error: `collection "${d.name}" declares no sort_field` });
		const rows = [];
		for (const { id, fields } of store.readAll(d.name)) rows.push({ id, key: fields[field] ?? '' });
		dt.sortRows(rows, 'key');
		const id = idParam(req);
		// every failure here is a bad destination (a neighbour that is not in the order), never a
		// missing route — so it is a 400 whatever the sentence says
		try {
			store.set(d.name, id, { [field]: dt.placementKey(rows, id, req.body ?? {}, d.name) });
		} catch (e) { return res.status(400).json({ error: e.message }); }
		res.json({ id });
	});

	api.post('/collections/:name/rename', (req, res) => {
		const { old: oldId, new: newId } = req.body ?? {};
		res.json(store.rename(req.params.name, oldId, newId));
	});

	api.post('/collections/:name/records-revert/*id', (req, res) => {
		res.json(store.revert(req.params.name, idParam(req), String(req.body?.hash ?? '')));
	});

	// the vocabulary a field actually uses (same op as `dt values <collection> <field>`)
	api.get('/collections/:name/values/:field', (req, res) => {
		const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
		res.json(dt.distinctValues(store, req.params.name, req.params.field, { limit }));
	});

	api.get('/history/:name/*id', (req, res) => {
		res.json(dt.history(store, req.params.name, idParam(req)));
	});
	api.get('/history-diff/:name/*id', (req, res) => {
		res.json(dt.historyDiff(store, req.params.name, idParam(req), String(req.query.hash ?? 'HEAD')));
	});

	// how to RENDER each collection and field
	api.get('/presentation', (req, res) => {
		res.json(dt.presentation(store.descriptors));
	});

	// bound commands and per-record state — ?ids=<id>[,<id>…] (same op as `dt next`)
	api.get('/commands/:name', (req, res) => {
		const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean) : [];
		res.json(dt.commandsFor(store, req.params.name, ids));
	});

	// ---- fields: the one sub-entity, so they keep dedicated routes. Every op writes the descriptor
	// source, proves it with a real compile (a CompileError is a 400 and the source is restored),
	// commits, and the Store reloads.
	const schemaOp = (fn) => (req, res) => {
		const out = fn(req);
		if (!req.dryRun) reload();
		res.json(out);
	};
	api.post('/collections/:name/fields', schemaOp((req) => {
		const b = req.body ?? {};
		const prop = b.prop ?? dt.fieldDef(store, b, req.params.name);
		return dt.addField(ws, store, req.params.name, { name: b.name, prop, required: b.required === true, moduleId: moduleParam(req) });
	}));
	api.patch('/collections/:name/fields/:field', schemaOp((req) => {
		const b = req.body ?? {};
		const prop = b.prop ?? dt.fieldDef(store, b, req.params.name);
		// A whole `prop` states the entire field; a body in the flag vocabulary states only the flags
		// it names, and updateField carries every relation keyword it did not restate.
		const stated = b.prop ? undefined : dt.statedKeywords(b);
		return dt.updateField(ws, store, req.params.name, req.params.field, { prop, required: b.required, flags: b.prop ? {} : b, stated, moduleId: moduleParam(req) });
	}));
	// `…/name` rather than a body key: a rename rewrites the key in every record, descriptor, view and
	// binding that names it — a different act from editing the field.
	api.patch('/collections/:name/fields/:field/name', schemaOp((req) =>
		dt.renameField(ws, store, req.params.name, req.params.field, String(req.body?.to ?? ''),
			{ moduleId: moduleParam(req), dryRun: req.dryRun })));
	api.delete('/collections/:name/fields/:field', schemaOp((req) =>
		dt.removeField(ws, store, req.params.name, req.params.field, { moduleId: moduleParam(req) })));

	// `dt commit` over HTTP: publish the pending record writes `only` names — `<collection>/<id>`
	// references or whole collections, never an implicit everything. The answer is the results array
	// exactly as `dt commit --json` prints it; a repo `blocked` by an in-progress merge or rebase makes
	// it a 409. `?dry-run=true` or `"dryRun": true` asks for the plan.
	api.post('/commit', (req, res) => {
		const b = req.body ?? {};
		const bad = (msg) => res.status(400).json({ error: `POST /commit ${msg} — body: { only: string[], message?: string, dryRun?: boolean }` });
		if (typeof b !== 'object' || Array.isArray(b)) return bad('takes a JSON object');
		const unknown = Object.keys(b).filter((k) => !COMMIT_KEYS.includes(k));
		if (unknown.length) return bad(`does not take ${unknown.map((k) => `"${k}"`).join(', ')}`);
		if (!(Array.isArray(b.only) && b.only.length && b.only.every((t) => typeof t === 'string' && t))) return bad('needs "only": a non-empty array of targets');
		if (b.message !== undefined && typeof b.message !== 'string') return bad('needs "message" to be a string');
		if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') return bad('needs "dryRun" to be a boolean');
		const results = dt.commitPending(new dt.Store(ws), { only: b.only, message: b.message, dryRun: b.dryRun === true || req.dryRun });
		res.status(results.some((r) => r.blocked) ? 409 : 200).json(results);
	});

	api.post('/reload', (req, res) => { reload(); res.json({ ok: true }); });

	api.use((req, res) => res.status(404).json({ error: `no route ${req.method} /api${req.path}` }));

	app.use('/api', api);
	app.get('/', (req, res) => res.redirect('/api/info'));

	// error contract: 400 validation and refusals · 404 missing record · 409 referenced or exists
	// (401, 403 and 415 are answered by the guards before any route)
	app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
		const msg = err.message ?? String(err);
		if (err instanceof DryRunUnsupported) return res.status(400).json({ error: msg, 'dry-run': 'unsupported' });
		const code = err instanceof dt.CompileError ? 400
			: /no such record/.test(msg) ? 404
			: /referenced by|already exists/.test(msg) ? 409 : 400;
		res.status(code).json({ error: msg });
	});

	return app;
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

/** The writes that return a plan under dry-run, as `[verb, method, path, body condition]`. Matched
 *  on the still-encoded path, so a route spelled any other way is refused, never performed. */
const PLANNERS = [
	['modules:rm', 'DELETE', /^\/collections\/modules\/records\/[^/].*$/],
	['collections:move', 'PATCH', /^\/collections\/collections\/records\/[^/].*$/, (req) => typeof req.body?.module === 'string'],
	['fields:rename', 'PATCH', /^\/collections\/[^/]+\/fields\/[^/]+\/name\/?$/],
	['commit', 'POST', /^\/commit\/?$/],
];
const planner = (req) => PLANNERS.find(([, method, re, when]) => req.method === method && re.test(req.path) && (!when || when(req)));

class DryRunUnsupported extends Error {
	constructor(what) {
		super(`dry-run is not supported for ${what} — supported: ${PLANNERS.map(([verb]) => verb).join(', ')}. `
			+ 'Nothing was written; re-send without dry-run to perform it.');
	}
}

/** `?dry-run` is absent, `true` or `false`; any other value, or a repeat, throws. */
function parseDryRun(value) {
	if (value === undefined || value === 'false') return false;
	if (value === 'true') return true;
	const shown = Array.isArray(value) ? value.join('&dry-run=') : value;
	throw new Error(`does not understand ?dry-run=${shown} — use ?dry-run=true or ?dry-run=false`);
}

/**
 * Every write, before its route: the body is `application/json` (a DELETE with no body may omit the
 * header), `?dry-run` parses strictly, and a dry run of a write that has no planner is answered 400
 * without the op being called. Routes read the parsed flag as `req.dryRun`.
 */
function writeGuard(req, res, next) {
	if (READS.has(req.method)) return next();
	const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
	const bodiless = req.headers['transfer-encoding'] === undefined && !(Number(req.headers['content-length']) > 0);
	if (type !== 'application/json' && !(req.method === 'DELETE' && !type && bodiless)) {
		return res.status(415).json({ error: `${req.method} /api${req.path} takes Content-Type: application/json (got ${type || 'none'})` });
	}
	try { req.dryRun = parseDryRun(req.query['dry-run']); } catch (e) {
		return res.status(400).json({ error: `${req.method} /api${req.path} ${e.message}` });
	}
	if (req.dryRun && !planner(req)) {
		const err = new DryRunUnsupported(`${req.method} /api${req.path}`);
		return res.status(400).json({ error: err.message, 'dry-run': 'unsupported' });
	}
	next();
}

/**
 * The HTTP face of the CLI's system verbs — same functions, same validation, same commit shape.
 *
 *   POST   /collections/collections/records?module=hr   {name, description}      → create in hr
 *   PATCH  /collections/collections/records/people?module=default {description}  → edit the overlay
 *   PATCH  /collections/collections/records/people      {module: "hr"}           → the MOVE
 */
function systemWrite(ws, store, req) {
	const kind = req.params.name;
	const id = req.params.id ? idParam(req) : undefined;
	const moduleId = moduleParam(req);
	const b = req.body ?? {};
	const force = req.query.force === 'true';
	if (req.dryRun) {
		// the write guard admits only the planner shapes; any other shape is refused here as well
		if (req.method === 'DELETE' && kind === 'modules') return dt.removeModule(ws, store, id, { force, dryRun: true });
		if (req.method === 'PATCH' && kind === 'collections' && typeof b.module === 'string') return dt.moveCollection(ws, store, id, b.module, { dryRun: true });
		throw new DryRunUnsupported(`${kind}:${req.method.toLowerCase()}`);
	}
	if (req.method === 'POST') {
		if (kind === 'collections') return dt.createCollection(ws, store, { ...b, moduleId });
		if (kind === 'modules') return dt.createModule(ws, store, b);
		if (kind === 'skills') return dt.createSkill(ws, store, { ...b, moduleId });
		if (kind === 'ui-views') return dt.saveUiView(ws, store, { id: b.id, view: b.view });
		return dt.refuseHandAuthored(ws, store, kind, b.name, moduleId);
	}
	if (req.method === 'DELETE') {
		if (kind === 'collections') return dt.removeCollection(ws, store, id, { force });
		if (kind === 'modules') return dt.removeModule(ws, store, id, { force });
		if (kind === 'ui-views') return dt.removeUiView(ws, store, id);
		return dt.removeEntity(ws, store, kind, id);
	}
	// PATCH
	if (kind === 'collections') {
		if (typeof b.module === 'string') return dt.moveCollection(ws, store, id, b.module);
		return dt.setCollectionScalars(ws, store, id, b, { moduleId });
	}
	if (kind === 'modules') return dt.setModule(ws, store, id, b);
	if (kind === 'ui-views') return dt.saveUiView(ws, store, { id, view: b.view ?? b });
	return dt.setEntityFrontmatter(ws, store, kind, id, b);
}

/** The `?module=` SELECTOR. Selector in the query string, field in the body — which keeps "edit the
 *  overlay" (`?module=default`) and "change the owner" (`{module: "hr"}`) two different requests. */
function moduleParam(req) {
	return req.query.module ? String(req.query.module) : undefined;
}

/** Express 5 hands a `*id` wildcard over as its segments. */
function idParam(req) {
	const id = req.params.id;
	return Array.isArray(id) ? id.join('/') : id;
}

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
