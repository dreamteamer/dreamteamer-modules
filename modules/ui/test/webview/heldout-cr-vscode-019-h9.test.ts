// held-out cr-vscode-019-h9 — the render half: given the host's `/notes` answer naming where sessions are
// read from, the page draws the line. The host half (GET /notes names the layer, and the workspace root
// only if its source entry exists) is dreamteamer-vscode test/unit/heldout-cr-vscode-019-h9.test.ts,
// against a real engine; this stub answers exactly the shape that test asserts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { find, flush, hasClass, render, text } from './render';
import NextNotes from '../../src/components/NextNotes.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

test('only the layer holds sessions: GET /notes names it, the page draws it', async () => {
	resetHost();
	onHostRequest((method, p) => {
		if (method === 'GET' && p === '/notes/things?ids=alpha') return { notes: [], sessionsFrom: { roots: ['project-b'] } };
		throw new Error(`the render tier did not stub ${method} ${p}`);
	});
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push('/content/things/alpha');
	await router.isReady();
	const root = await render(NextNotes, { collection: 'things', id: 'alpha' }, [router]);
	for (let i = 0; i < 6; i++) await flush();
	const line = find(root, (n) => hasClass(n, 'dt-sessions-from'));
	const drawn = line ? text(line).replace(/\s+/g, ' ').trim() : null;
	console.log('h9 drawn', JSON.stringify(drawn));
	assert.ok(drawn && /^Sessions read from:/.test(drawn) && drawn.includes('project-b'));
});
