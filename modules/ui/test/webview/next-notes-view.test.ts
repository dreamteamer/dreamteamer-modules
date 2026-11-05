/**
 * THE RECORD PAGE'S NOTES (cr-vscode-005, acceptance 2): under the record's header, one line per note an
 * extension contributes about it (`GET /notes/<collection>?ids=<id>`) — the glyph, the sentence verbatim,
 * the extension's name; each reference the host marked as held here is a link to that record (core's
 * `(sessions/<id>)`), one it marked absent stays text; an extension's failure is one `<by>: <text>` line,
 * as `dt next` prints it; no note, nothing drawn. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, hasClass, render, text, type TestNode } from './render';
import { textParts } from '../../webview/src/lib/next-notes';
import NextNotes from '../../webview/src/components/NextNotes.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const SID = 'sessions/2026/11/2026-11-01--rnd-change-requests-cr-a';
const HELD = `in session by users/nobody since 2026-11-01T10:00:00+02:00 (${SID})`;
const heldNote = {
	id: 'cr-a', text: HELD, by: '@dreamteamer/core',
	refs: [
		{ ref: 'users/nobody', collection: 'users', id: 'nobody', start: 14, end: 26, exists: false },
		{ ref: SID, collection: 'sessions', id: SID.slice(9), start: HELD.indexOf(SID), end: HELD.indexOf(SID) + SID.length, exists: true },
	],
};
const errorNote = { id: null, text: 'next failed — probe broke', by: 'probe-notes', error: true, refs: [] };

let notes: unknown[] = [];
beforeEach(() => {
	resetHost();
	notes = [];
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		if (method === 'GET' && path.startsWith('/notes/')) return { notes };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

async function mount(props: Record<string, unknown>) {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/rnd/change-requests/cr-a');
	await r.isReady();
	return render(NextNotes, props, [r]);
}
const lines = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-next-notes__line'));
const links = (n: TestNode) => all(n, (x) => x.tag === 'a');

test('textParts cuts at the host\'s offsets; an absent record stays text', () => {
	assert.deepEqual(textParts(heldNote as never), [
		{ text: 'in session by users/nobody since 2026-11-01T10:00:00+02:00 (' },
		{ text: SID, ref: SID },
		{ text: ')' },
	]);
});

test('one line per note: the sentence, the session as a link, the absent worker as text, the extension named', async () => {
	notes = [heldNote];
	const root = await mount({ collection: 'rnd/change-requests', id: 'cr-a' });
	assert.ok(requests.some((r) => r.method === 'GET' && r.path === '/notes/rnd%2Fchange-requests?ids=cr-a'), JSON.stringify(requests));
	const ls = lines(root);
	assert.equal(ls.length, 1);
	assert.equal(text(find(ls[0]!, (n) => hasClass(n, 'dt-next-notes__text'))!), HELD, 'the sentence, verbatim');
	const a = links(ls[0]!);
	assert.equal(a.length, 1, 'one link — the absent users/nobody is not one');
	assert.equal(a[0]!.props['href'], `/content/${SID}`);
	assert.equal(text(a[0]!), SID);
	assert.equal(text(find(ls[0]!, (n) => hasClass(n, 'dt-next-notes__by'))!), '@dreamteamer/core');
});

test("an extension's failure is one line, as dt next prints it", async () => {
	notes = [errorNote];
	const root = await mount({ collection: 'rnd/change-requests', id: 'cr-a' });
	const ls = lines(root);
	assert.equal(ls.length, 1);
	assert.ok(hasClass(ls[0]!, 'dt-next-notes__line--error'));
	assert.equal(text(find(ls[0]!, (n) => hasClass(n, 'dt-next-notes__text'))!), 'probe-notes: next failed — probe broke');
});

test('no note: nothing is drawn, not even an empty band', async () => {
	const root = await mount({ collection: 'rnd/change-requests', id: 'cr-a' });
	assert.equal(find(root, (n) => hasClass(n, 'dt-next-notes')), null);
});

// --- cr-vscode-019, acceptance line 3: where the sessions were read from, always ------------------
test('the record page names where its sessions were read from even with no note (cr-vscode-019 t3)', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (method === 'GET' && path.startsWith('/notes/')) return { notes: [], sessionsFrom: { roots: ['my-hq', 'project-a'] } };
		return {};
	});
	const root = await mount({ collection: 'rnd/change-requests', id: 'cr-a' });
	for (let i = 0; i < 5; i++) await Promise.resolve();
	const line = find(root, (n) => hasClass(n, 'dt-sessions-from'));
	assert.ok(line, 'the line is drawn');
	assert.equal(text(line!).replace(/\s+/g, ' ').trim(), 'Sessions read from: my-hq, project-a');
});

test('sessions not read on this machine: the reason; no sessions collection: no line (cr-vscode-019 t3)', async () => {
	resetHost();
	let answer: unknown = { notes: [], sessionsFrom: { unavailable: 'SITTINGS_FOLDER is not set' } };
	onHostRequest((method, path) => (method === 'GET' && path.startsWith('/notes/') ? answer : {}));
	const unread = await mount({ collection: 'things', id: 'a' });
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.match(text(find(unread, (n) => hasClass(n, 'dt-sessions-from'))!), /Sessions not read on this machine: SITTINGS_FOLDER is not set/);
	answer = { notes: [], sessionsFrom: null };
	const none = await mount({ collection: 'things', id: 'b' });
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.equal(find(none, (n) => hasClass(n, 'dt-sessions-from')), null);
});
