/**
 * Held-out h6 (cr-vscode-012) — the test stage's file; not committed to the branch. Render tier,
 * through the host stub and the real adapter, mounted as t7 mounts the Sources section.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { HostError, onHostRequest, requests, resetHost, type Responder } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import SourcesPane from '../../src/pages/SourcesPane.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/sources');
	await r.isReady();
	return r;
}

const coll = (repo: string) => [{ collection: 'notes', path: `${repo}/data/notes`, count: 1 }];
const STACK = {
	workspace: { name: 'example-ws', kind: 'own', repo: '.', installed: true, via: 'own', access: 'write', collections: [{ collection: 'tasks', path: 'data/tasks', count: 2 }] },
	layers: [
		{ name: 'layer-a', kind: 'layer', repo: 'git_modules/layer-a', installed: true, via: 'layer', access: 'write', collections: coll('git_modules/layer-a') },
		{ name: 'layer-b', kind: 'layer', repo: 'git_modules/layer-b', installed: false, via: 'layer', access: 'read', collections: coll('git_modules/layer-b') },
	],
	modules: [{ name: 'pkg-mod', kind: 'module', repo: 'node_modules/pkg-mod', installed: true, via: 'package', access: 'read', collections: coll('node_modules/pkg-mod') }],
};
const LOCAL: Record<string, string> = { 'layer-a': 'write', 'layer-b': 'read', 'pkg-mod': 'read' };

const A = {
	access: {
		'example-ws': { state: 'not-checked', reason: 'no remote' },
		'layer-a': { state: 'not-checked', reason: 'gitlab.example.com is not GitHub or Bitbucket' },
		'layer-b': { state: 'not-checked', reason: 'no remote' },
	},
};
const UNANSWERED = { state: 'unknown', reason: 'did not answer within 8 s' };
const B = { access: { 'example-ws': UNANSWERED, 'layer-a': UNANSWERED, 'layer-b': UNANSWERED } };
const E = {
	access: {
		...A.access,
		'layer-a': { state: 'ok', level: 'write', account: 'acme-dev', tiedToPushKey: true, remote: { provider: 'github', host: 'github.com', owner: 'acme', repo: 'widgets' } },
	},
};

function stub(access: Responder, members: Responder = () => ({ state: 'ok', members: [] })) {
	resetHost();
	onHostRequest((method, path, body) => {
		if (method === 'GET' && path === '/sources') return STACK;
		if (method === 'GET' && path.startsWith('/sources/access/members')) return members(method, path, body);
		if (method === 'GET' && path.startsWith('/sources/access')) return access(method, path, body);
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}
async function pane() {
	const root = await render(SourcesPane, {}, [await router()]);
	await flush();
	await flush();
	return root;
}
const markOf = (root: TestNode, source: string) => find(root, (n) => hasClass(n, 'dt-remote-access') && n.props['data-source'] === source);
const press = async (n: TestNode | null) => {
	assert.ok(n, 'the control exists');
	(n!.props['onClick'] as () => void)();
	await flush();
	await flush();
};

/** Every scenario: the four entries and the local marks the section draws. */
function stackDrawn(root: TestNode) {
	const ownBlock = find(root, (n) => hasClass(n, 'dt-sources__block') && n.props['data-kind'] === 'own');
	assert.ok(ownBlock, 'the workspace block is drawn');
	assert.match(text(ownBlock!), /example-ws/);
	for (const name of ['layer-a', 'layer-b', 'pkg-mod']) {
		const entry = find(root, (n) => hasClass(n, 'dt-sources__entry') && n.props['data-source'] === name);
		assert.ok(entry, `${name} is drawn`);
		const mark = find(entry!, (n) => hasClass(n, 'dt-source-mark') && n.props['data-source'] === name);
		assert.ok(mark, `${name}'s local mark is drawn`);
		assert.equal(mark!.props['data-access'], LOCAL[name], `${name}'s local mark`);
	}
}
const noWarning = (root: TestNode) => {
	assert.equal(all(root, (n) => hasClass(n, 'is-warning')).length, 0, 'no warning class');
	assert.equal(all(root, (n) => hasClass(n, 'dt-remote-access') && !!find(n, (c) => hasClass(c, 'codicon-warning'))).length, 0, 'no warning glyph');
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test('A — no source checkable: not-checked words, no remote mark on the package, no warning, no members request', async () => {
	stub(() => A);
	const root = await pane();
	stackDrawn(root);
	for (const [name, a] of Object.entries(A.access)) {
		const m = markOf(root, name);
		assert.ok(m, `${name} has a remote mark`);
		assert.equal(text(m!).trim(), `remote not checked — ${a.reason}`);
	}
	assert.equal(markOf(root, 'pkg-mod'), null, 'pkg-mod draws no remote mark');
	noWarning(root);
	assert.equal(requests.filter((r) => r.path.startsWith('/sources/access/members')).length, 0);
	unmountAll();
});

test('B — every provider failing: unknown words, no warning', async () => {
	stub(() => B);
	const root = await pane();
	stackDrawn(root);
	for (const name of Object.keys(B.access)) assert.equal(text(markOf(root, name)!).trim(), 'remote unknown — did not answer within 8 s');
	noWarning(root);
	unmountAll();
});

test('C — the route failing: one sentence, nothing stuck at checking, the message hidden; Re-check recovers', async () => {
	let answer: Responder = () => {
		throw new HostError('remote access failed (/sources/access)', 500);
	};
	stub((m, p, b) => answer(m, p, b));
	const root = await pane();
	stackDrawn(root);
	const t = text(root);
	assert.equal(count(t, 'remote access could not be read'), 1);
	assert.ok(!t.includes('remote …'), 'no entry still shows the checking text');
	assert.ok(!t.includes('remote access failed'), "the error's own message is not shown");
	answer = () => B;
	const before = requests.length;
	await press(find(root, (n) => hasClass(n, 'dt-sources__recheck')));
	assert.ok(requests.slice(before).some((r) => r.path.includes('fresh=1')), requests.map((r) => r.path).join(', '));
	stackDrawn(root);
	for (const name of Object.keys(B.access)) assert.equal(text(markOf(root, name)!).trim(), 'remote unknown — did not answer within 8 s');
	unmountAll();
});

test('D — the route never settling: the stack is drawn, the entries show the muted checking state', async () => {
	stub(() => new Promise(() => {}));
	const root = await pane();
	stackDrawn(root);
	for (const name of ['example-ws', 'layer-a', 'layer-b']) {
		const m = markOf(root, name);
		assert.ok(m, `${name} has a remote mark`);
		assert.equal(m!.props['data-state'], 'checking');
		assert.ok(!hasClass(m!, 'is-warning'));
	}
	unmountAll();
});

test('E — members failing: a sentence in the disclosure, the section still drawn, the mark unchanged', async () => {
	stub(
		() => E,
		() => {
			throw new HostError('remote access failed (/sources/access/members)', 500);
		},
	);
	const root = await pane();
	await press(find(root, (n) => hasClass(n, 'dt-sources__who') && n.props['data-source'] === 'layer-a'));
	assert.ok(requests.some((r) => r.path === '/sources/access/members?source=layer-a'), requests.map((r) => r.path).join(', '));
	const entry = find(root, (n) => hasClass(n, 'dt-sources__entry') && n.props['data-source'] === 'layer-a')!;
	const disclosure = find(entry, (n) => hasClass(n, 'dt-remote-members'));
	assert.ok(disclosure, 'the disclosure is open');
	const said = text(disclosure!).trim();
	assert.ok(said.length > 0, 'the disclosure says something');
	assert.ok(!said.includes('remote access failed'), `the raw HostError text is shown: ${said}`);
	stackDrawn(root);
	assert.equal(text(markOf(root, 'layer-a')!).trim(), 'remote write · as acme-dev');
	unmountAll();
});
