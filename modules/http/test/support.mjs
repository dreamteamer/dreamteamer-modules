// Shared by this package's tests: a fixture workspace with @dreamteamer/http installed, collections
// written as module sources, and the app mounted on an ephemeral loopback port.
import { once } from 'node:events';
import { api, workspace, writeSource } from '../../../tests/helpers/fixture.mjs';
import { bind, createApp } from '../src/app.js';

/** A minimal valid descriptor, so a test states only the part it is about. */
export function simpleCollection(extra = {}) {
	return {
		id: { generate: '{{ name | slug }}' },
		schema: {
			type: 'object',
			required: ['name'],
			properties: { name: { type: 'string' }, notes: { type: 'string', format: 'markdown', 'x-body': true } },
		},
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

/** The app on 127.0.0.1:<ephemeral>. Returns the api base url and a close(). */
export async function mount(ws) {
	bind(api);
	const server = createApp(ws).listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { base: `http://127.0.0.1:${server.address().port}/api`, close: () => new Promise((r) => server.close(r)) };
}

/** One request with a hard timeout; the body parsed as JSON when it is JSON. */
export async function call(method, url, body) {
	const res = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	});
	const text = await res.text();
	let json = null;
	try { json = text ? JSON.parse(text) : null; } catch { json = text; }
	return { status: res.status, json };
}
