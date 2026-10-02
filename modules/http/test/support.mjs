// Shared by this package's tests: a fixture workspace with @dreamteamer/http installed, collections
// written as module sources, and the app mounted on an ephemeral loopback port.
import { once } from 'node:events';
import { api, workspace, writeSource } from '../../../tests/helpers/fixture.mjs';
import { bind, createApp } from '../src/app.js';

/** A minimal valid v2 descriptor, so a test states only the part it is about. */
export function simpleCollection(extra = {}) {
	return {
		description: 'A test collection.',
		ids: { from: '{{ name | slug }}' },
		fields: { name: { type: 'string', required: true }, notes: { type: 'markdown', body: true } },
		...extra,
	};
}

/**
 * A compiled workspace with the http package installed.
 *   collections  name → descriptor, written to `modules/default/collections/<name>.collection.yaml`
 *   records      collection → [fields], added through the engine's Store (uncommitted)
 *   namespaces   `dreamteamer.namespaces`
 */
export async function httpWorkspace({ collections = {}, records = {}, namespaces } = {}) {
	const h = workspace({ packages: ['http'], compile: false, pkg: namespaces ? { namespaces } : {} });
	for (const [name, d] of Object.entries(collections)) writeSource(h.root, `collections/${name}.collection.yaml`, api.dumpYaml({ name, ...d }));
	const r = h.dt('compile');
	if (r.code !== 0) throw new Error(`fixture compile failed:\n${r.stdout}\n${r.stderr}`);
	const ws = await h.open();
	const store = new api.Store(ws);
	const ids = {};
	for (const [c, rows] of Object.entries(records)) ids[c] = rows.map((fields) => store.add(c, { ...fields }).id);
	return { ...h, ws, ids };
}

/** The app on 127.0.0.1:<ephemeral>, built with `opts` (`{host, token}`). Returns the api base url
 *  and a close(). */
export async function mount(ws, opts) {
	bind(api);
	const server = createApp(ws, opts).listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { base: `http://127.0.0.1:${server.address().port}/api`, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

/**
 * One request with a hard timeout; the body parsed as JSON when it is JSON. A POST or PATCH, and any
 * request with a body, says `content-type: application/json` unless `headers` overrides it; a string
 * body is sent as-is.
 */
export async function call(method, url, body, headers = {}) {
	const json = body !== undefined || method === 'POST' || method === 'PATCH';
	const res = await fetch(url, {
		method,
		headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	});
	const text = await res.text();
	let parsed = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
	return { status: res.status, json: parsed };
}
