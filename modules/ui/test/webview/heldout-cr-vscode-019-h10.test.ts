// held-out cr-vscode-019-h10
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { flush, render, type TestNode } from './render';
import ActivityPane from '../../src/pages/ActivityPane.vue';

test('the unscoped Activity page draws its feed first, no empty slot, no /sessions/running', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (method === 'GET' && path.startsWith('/activity'))
			return { module: null, scopes: [{ repo: '.', paths: [] }], entries: [{ sha: 'aaaaaaa1', repo: '.', source: 'my-hq', author: 'Dana', date: '2026-10-03T10:00:00+00:00', subject: 'subject a', records: [], files: 0 }], offset: 0, limit: 20, hasMore: false, pending: [], failed: [], settled: 1 };
		if (path.startsWith('/sessions')) return { sessions: [] };
		return {};
	});
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/activity');
	await r.isReady();
	const root = await render(ActivityPane, {}, [r]);
	for (let i = 0; i < 4; i++) await flush();
	const page = (root.children.find((c) => typeof c !== 'string' && c.tag !== '#comment' && c.tag !== '#text') as TestNode);
	const kids = page.children.filter((c): c is TestNode => typeof c !== 'string' && c.tag !== '#comment' && !(c.tag === '#text' && !String(c.props['text'] ?? '').trim()));
	const desc = kids.map((k) => `${k.tag}.${String(k.props['class'] ?? '')}`);
	console.log('h10 page', String(page.props['class']), 'children', JSON.stringify(desc));
	console.log('h10 requests', JSON.stringify(requests.map((q) => q.path)));
	const first = kids[0]!;
	const cls = String(first.props['class'] ?? '');
	assert.ok(/dt-activity__head|dt-activity__day/.test(cls), `first child is the feed or its header, got ${first.tag}.${cls}`);
	assert.ok(first.children.length > 0, 'not an empty element');
	assert.equal(requests.filter((q) => q.path.startsWith('/sessions/running')).length, 0);
});
