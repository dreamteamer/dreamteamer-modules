/**
 * A BARE `filter=<json>` on a list request reaches the host intact (cr-vscode-013, acceptance line 4).
 *
 * The adapter's `parseQueryString` used to understand only the bracket form `filter[a][_eq]=v` that
 * `buildQuery` writes. A bare `filter=<json>` set `hasFilter` and assigned nothing, so the host got
 * `filter={}` — which matches EVERY row. The record page's reverse lookup sent exactly that, and an
 * empty change request read "443 more from other sources": the whole owner collection.
 *
 * Asserted on what the HOST receives (the transport seam), never on a stubbed client:
 *   1. a bare JSON object arrives as that object;
 *   2. a bare value that is not a JSON object is refused with 400, and the host is never asked;
 *   3. bare and bracket forms together arrive as `{_and: [bare, bracket]}` — neither drops the other,
 *      and an empty `_in` list in the bare tree stays a list.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { onHostRequest, requests, resetHost } from './host-stub';
import { api } from '../../webview/src/api/client';
import { invalidateContract } from '../../webview/src/api/adapter';

const TICKETS = 'tickets';

beforeEach(() => {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return {
				collections: [{ collection: TICKETS }],
				fields: { [TICKETS]: [{ collection: TICKETS, field: 'requests', type: 'json', many: true }] },
				relations: [{ collection: TICKETS, field: 'requests', related_collection: 'requests' }],
			};
		}
		if (path === '/info') return { name: 'scratch' };
		if (path.includes('/records?')) return { records: [], total: 0 };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

/** The `filter` the host received on its one list request, parsed. */
function hostFilter(): unknown {
	const list = requests.filter((q) => q.path.includes('/records?'));
	assert.equal(list.length, 1, 'one list request reached the host');
	const params = new URLSearchParams(list[0]!.path.slice(list[0]!.path.indexOf('?') + 1));
	const raw = params.get('filter');
	assert.ok(raw !== null, 'the host received a filter');
	return JSON.parse(raw!);
}

test('a bare filter=<json> object reaches the host as that object, not as {}', async () => {
	const filter = { requests: { _eq: 'requests/r-1' } };
	await api.get(`/items/${TICKETS}?limit=1&filter=${encodeURIComponent(JSON.stringify(filter))}`);
	assert.deepEqual(hostFilter(), filter);
});

for (const [label, value] of [
	['not JSON at all', 'not-json'],
	['a JSON array', '[]'],
	['a JSON string', '"requests"'],
	['JSON null', 'null'],
] as const) {
	test(`a bare filter that is ${label} is refused with 400, and the host is never asked for rows`, async () => {
		await assert.rejects(api.get(`/items/${TICKETS}?limit=1&filter=${encodeURIComponent(value)}`), (err: { status?: number }) => {
			assert.equal(err.status, 400);
			return true;
		});
		assert.equal(requests.filter((q) => q.path.includes('/records?')).length, 0, 'no list request reached the host');
	});
}

test('a bare filter beside bracket keys arrives as {_and: [bare, bracket]} — a clash drops nothing, an empty _in stays a list', async () => {
	const bare = { stage: { _eq: 'open' }, tags: { _in: [] } };
	await api.get(`/items/${TICKETS}?limit=1&filter=${encodeURIComponent(JSON.stringify(bare))}&filter[stage][_neq]=done`);
	assert.deepEqual(hostFilter(), { _and: [bare, { stage: { _neq: 'done' } }] });
});
