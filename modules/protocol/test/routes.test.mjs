// The written protocol and its route table say the same thing, and every route has a contract case.
// PROTOCOL.md's `### <METHOD> <pattern>` headings are the document; `ROUTES` is the same list as data.
// A route documented in one and not the other, or a route with no case in the contract suite, fails here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ROUTES, matchRoute } = await import(pathToFileURL(path.join(PKG, 'src', 'routes.js')).href);

const pair = (r) => `${r.method} ${r.pattern}`;
const documented = () => [...fs.readFileSync(path.join(PKG, 'PROTOCOL.md'), 'utf8').matchAll(/^### (GET|POST|PATCH|PUT|DELETE) (\/\S*)\s*$/gm)].map((m) => `${m[1]} ${m[2]}`);

describe('the route table', () => {
	test('names 28 method-and-pattern pairs, each once, each with an id and a doc anchor', () => {
		const pairs = ROUTES.map(pair);
		assert.equal(pairs.length, 28, pairs.join('\n'));
		assert.equal(new Set(pairs).size, pairs.length, 'a pair is listed twice');
		assert.equal(new Set(ROUTES.map((r) => r.id)).size, ROUTES.length, 'an id is listed twice');
		for (const r of ROUTES) assert.ok(r.id && r.doc, `${pair(r)} has no id or doc`);
	});

	test('PROTOCOL.md documents exactly the pairs ROUTES lists', () => {
		assert.deepEqual([...documented()].sort(), ROUTES.map(pair).sort());
	});

	test('every pair matches a sample path, and the params come back decoded', () => {
		const samples = {
			'GET /collections/:collection/records/*id': ['/collections/lab%2Fsamples/records/2026/11/a', { collection: 'lab/samples', id: '2026/11/a' }],
			'POST /fields/:collection/:field/rename': ['/fields/tasks/status/rename', { collection: 'tasks', field: 'status' }],
			'GET /info': ['/info?x=1', {}],
		};
		for (const [p, [sample, params]] of Object.entries(samples)) {
			const [method] = p.split(' ');
			const hit = matchRoute(method, sample);
			assert.ok(hit, `${p} does not match ${sample}`);
			assert.equal(pair(hit.route), p);
			assert.deepEqual(hit.params, params);
		}
		for (const r of ROUTES) {
			const sample = r.pattern.replace(/:[a-z]+/g, 'x').replace(/\*[a-z]+/g, 'a/b');
			const hit = matchRoute(r.method, sample);
			assert.ok(hit, `${pair(r)} does not match its own sample ${sample}`);
			assert.equal(pair(hit.route), pair(r), `${sample} matched ${hit && pair(hit.route)} instead of ${pair(r)}`);
		}
		assert.equal(matchRoute('GET', '/graph'), null);
		assert.equal(matchRoute('DELETE', '/info'), null);
	});

	test('every pair has at least one contract case', async () => {
		const casesFile = path.join(PKG, 'lib', 'contract', 'cases.js');
		if (!fs.existsSync(casesFile)) return test.todo?.('the contract suite lands in task 2');
		const { cases } = await import(pathToFileURL(casesFile).href);
		const covered = new Set(cases.map((c) => c.route));
		const missing = ROUTES.filter((r) => !covered.has(r.id)).map(pair);
		assert.deepEqual(missing, [], `routes with no contract case:\n${missing.join('\n')}`);
	});
});
