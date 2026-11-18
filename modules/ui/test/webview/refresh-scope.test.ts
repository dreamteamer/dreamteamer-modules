/**
 * Acceptance line 7 of the refresh button: its page re-fetch is the record composables' (lists, record
 * pages, relation titles, band labels). A pane that reads the host directly — the Activity pane here —
 * is out of that scope and is NOT re-asked by `refreshPages()`; the request says so rather than leaving
 * it to be discovered. If a later change subscribes such a pane, this test is where the scope moves.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { flush, render } from './render';
import ActivityPane from '../../src/pages/ActivityPane.vue';
import { refreshPages } from '../../src/composables/page-caches';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

test('refresh does not re-ask the Activity pane, which reads the host directly', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (method === 'GET' && path.startsWith('/activity')) {
			return { module: null, scopes: [{ repo: '.', paths: [] }], entries: [], offset: 0, limit: 20, hasMore: false, pending: [], failed: [], settled: 1 };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/activity');
	await r.isReady();
	await render(ActivityPane, {}, [r]);
	await flush();
	await flush();
	const reads = () => requests.filter((q) => q.path.startsWith('/activity')).length;
	const before = reads();
	assert.ok(before >= 1, 'the pane read once on mount');
	refreshPages();
	await flush();
	await flush();
	assert.equal(reads(), before, 'no /activity read after refresh — out of this request’s scope');
});
