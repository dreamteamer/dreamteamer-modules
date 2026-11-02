/**
 * THE ACTIVITY PAGE'S RUNNING SESSIONS (cr-vscode-005, acceptance 3): on the unscoped Activity page only —
 * a session belongs to the machine, not to a module or a layer — above the commit feed, from
 * `GET /sessions/running`: who (the worker, else "a <harness> session"), started, the heartbeat's age, the
 * session linked, and each record it holds linked by title with core's own sentence under it. Absent: no
 * section; unreadable: one line with the reason, the feed still below; none running: one line saying so.
 * Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import ActivityPane from '../../src/pages/ActivityPane.vue';
import RunningSessions from '../../src/components/RunningSessions.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/activity');
	await r.isReady();
	return r;
}

const SID = '2026/11/2026-11-01--rnd-change-requests-cr-a';
const HELD = `in session by agents/builder since 2026-11-01T10:00:00+02:00 (sessions/${SID})`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SESSION = {
	id: SID, name: 'rnd/change-requests/cr-a — builder', worker: 'agents/builder', harness: 'claude-code',
	started: minutesAgo(90), heartbeat: minutesAgo(3),
	records: [{
		ref: 'rnd/change-requests/cr-a', collection: 'rnd/change-requests', id: 'cr-a', title: 'Change A',
		notes: [{ id: 'cr-a', text: HELD, by: '@dreamteamer/core', refs: [{ ref: `sessions/${SID}`, collection: 'sessions', id: SID, start: HELD.indexOf('sessions/'), end: HELD.length - 1, exists: true }] }],
	}],
};
const FEED = { module: null, scopes: [{ repo: '.', paths: [] }], entries: [{ sha: 'aaaaaaa1', repo: '.', source: 'my-hq', author: 'Dana', date: '2026-10-03T10:00:00+00:00', subject: 'subject aaaaaaa1', records: [], files: 0 }], offset: 0, limit: 20, hasMore: false, pending: [], failed: [], settled: 1 };

function stub(running: unknown) {
	resetHost();
	onHostRequest((method, path) => {
		if (method === 'GET' && path === '/sessions/running') return running;
		if (method === 'GET' && path.startsWith('/activity')) return FEED;
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}
const section = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-running-sessions'));
const settle = async () => { await flush(); await flush(); };

test('a running session: who, started, heartbeat age, the session linked, its record titled and linked with core\'s sentence', async () => {
	stub({ state: 'ok', sessions: [SESSION] });
	const root = await render(RunningSessions, {}, [await router()]);
	await settle();
	const rows = all(root, (n) => hasClass(n, 'dt-running-sessions__session'));
	assert.equal(rows.length, 1);
	const row = rows[0]!;
	assert.equal(text(find(row, (n) => hasClass(n, 'dt-running-sessions__who'))!), 'agents/builder');
	assert.match(text(find(row, (n) => hasClass(n, 'dt-running-sessions__heartbeat'))!), /^heartbeat 3 minutes ago$/);
	assert.ok(find(row, (n) => hasClass(n, 'dt-running-sessions__started')), 'started is shown');
	const hrefs = all(row, (n) => n.tag === 'a').map((a) => String(a.props['href']));
	assert.ok(hrefs.includes(`/content/sessions/${SID}`), `the session is linked: ${hrefs}`);
	assert.ok(hrefs.includes('/content/rnd/change-requests/cr-a'), 'the record is linked');
	const rec = find(row, (n) => hasClass(n, 'dt-running-sessions__record'))!;
	assert.match(text(rec), /Change A/);
	assert.match(text(rec), /in session by agents\/builder since/);
});

test('no worker: "a <harness> session"', async () => {
	stub({ state: 'ok', sessions: [{ ...SESSION, worker: undefined, records: [] }] });
	const root = await render(RunningSessions, {}, [await router()]);
	await settle();
	assert.equal(text(find(root, (n) => hasClass(n, 'dt-running-sessions__who'))!), 'a claude-code session');
});

test('none running: one line that says so', async () => {
	stub({ state: 'ok', sessions: [] });
	const root = await render(RunningSessions, {}, [await router()]);
	await settle();
	assert.match(text(section(root)!), /No session is running on this machine\./);
});

test('absent: no section at all', async () => {
	stub({ state: 'absent', sessions: [] });
	const root = await render(RunningSessions, {}, [await router()]);
	await settle();
	assert.equal(section(root), null);
});

test('unreadable: the reason, and the commit feed still loads below', async () => {
	stub({ state: 'unreadable', reason: 'collection "sessions" keeps its records at ${env:SESSIONS_FOLDER}, which cannot render on this machine', sessions: [] });
	const root = await render(ActivityPane, {}, [await router()]);
	await settle();
	assert.match(text(section(root)!), /SESSIONS_FOLDER/);
	assert.ok(find(root, (n) => hasClass(n, 'dt-activity__entry')), 'the feed is drawn');
});

test('only the unscoped page: a module, a source or an embedded panel draws no section', async () => {
	for (const props of [{ module: 'project-a' }, { source: 'project-a' }, { embedded: true }]) {
		stub({ state: 'ok', sessions: [SESSION] });
		const root = await render(ActivityPane, props, [await router()]);
		await settle();
		assert.equal(section(root), null, JSON.stringify(props));
	}
	stub({ state: 'ok', sessions: [SESSION] });
	const root = await render(ActivityPane, {}, [await router()]);
	await settle();
	assert.ok(section(root), 'and the unscoped page does');
});
