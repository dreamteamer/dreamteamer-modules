/**
 * cr-vscode-012 — THE SOURCES SECTION DRAWS REMOTE ACCESS. Rendered against the host stub through the
 * real adapter: each source's remote level beside its local mark, AS which account; the push-refused
 * warning only when the local mark writes, the remote is below write and the answer is tied to the push
 * key; a missing login named while the other sources still draw; Re-check asking with `fresh=1`; and
 * Who has access asking for one source and drawing its rows — or the provider's reason with yourself.
 * Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import SourcesPane from '../../src/pages/SourcesPane.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/sources');
	await r.isReady();
	return r;
}

const entry = (name: string, kind: 'layer' | 'module', extra: Record<string, unknown> = {}) => ({
	name,
	kind,
	repo: kind === 'layer' ? `git_modules/${name}` : '.',
	installed: true,
	via: kind === 'layer' ? 'layer' : 'clone',
	access: 'write',
	collections: [{ collection: 'notes', path: `git_modules/${name}/data/notes`, count: 1 }],
	...extra,
});
const STACK = {
	workspace: { name: 'my-hq', kind: 'own', repo: '.', installed: true, via: 'own', access: 'write', collections: [{ collection: 'tasks', path: 'data/tasks', count: 2 }] },
	layers: [entry('project-a', 'layer'), entry('project-b', 'layer'), entry('project-c', 'layer', { installed: false, access: 'read' }), entry('project-d', 'layer', { access: 'read' })],
	modules: [entry('org', 'module')],
};
const gh = (repo: string) => ({ provider: 'github', host: 'github.com', owner: 'acme', repo });
const bb = (repo: string) => ({ provider: 'bitbucket', host: 'bitbucket.org', owner: 'example-ws', repo });
const ACCESS = {
	available: true,
	access: {
		'my-hq': { remote: gh('hq'), state: 'ok', level: 'admin', role: 'admin', account: 'dev-one', tiedToPushKey: true },
		'project-a': { remote: bb('project-a'), state: 'ok', level: 'read', role: 'read', account: 'Dev Example', tiedToPushKey: true },
		'project-b': { remote: gh('project-b'), state: 'ok', level: 'read', role: 'pull', account: 'dev-two', tiedToPushKey: false, reason: "as dev-two (gh's active account) — an https push may use another account" },
		'project-c': { state: 'not-checked', reason: 'not installed' },
		'project-d': { remote: gh('project-d'), state: 'ok', level: 'read', role: 'pull', account: 'dev-one', tiedToPushKey: true },
		org: { remote: bb('org'), state: 'no-login', reason: "no Bitbucket login — run 'dreamteamer: Set Bitbucket credential'" },
	},
};
const MEMBERS: Record<string, unknown> = {
	'my-hq': { remote: gh('hq'), state: 'partial', account: 'dev-one', reason: 'teams are not visible to dev-one', members: [{ name: 'dev-one', kind: 'user', level: 'admin', role: 'admin' }, { name: 'user-b', kind: 'user', level: 'read', role: 'read' }] },
	'project-a': { remote: bb('project-a'), state: 'refused', account: 'Dev Example', reason: "Bitbucket lists everyone's access only to repo admins; Dev Example has read", members: [{ name: 'Dev Example', kind: 'user', level: 'read', via: 'you' }] },
};

function stub(access: unknown = ACCESS) {
	resetHost();
	onHostRequest((method, path) => {
		if (method === 'GET' && path === '/sources') return STACK;
		if (method === 'GET' && path.startsWith('/sources/access/members')) return MEMBERS[new URLSearchParams(path.split('?')[1]).get('source') ?? ''] ?? { state: 'unknown', members: [] };
		if (method === 'GET' && path.startsWith('/sources/access')) {
			if (access instanceof Error) throw access;
			return access;
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}
async function pane() {
	const root = await render(SourcesPane, {}, [await router()]);
	await flush();
	await flush();
	return root;
}
/** Each members row as its cells' words, joined by one space. */
const rowsOf = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-remote-members__row')).map((r) => all(r, (c) => c.tag === 'td').map((c) => text(c).trim()).join(' '));
const markOf = (root: TestNode, source: string) => find(root, (n) => hasClass(n, 'dt-remote-access') && n.props['data-source'] === source);
const press = async (n: TestNode | null) => {
	assert.ok(n, 'the control exists');
	(n!.props['onClick'] as () => void)();
	await flush();
	await flush();
};

test('each source draws its remote level as its account, beside the local mark', async () => {
	stub();
	const root = await pane();
	const ws = markOf(root, 'my-hq')!;
	assert.ok(ws, 'the workspace has a remote mark');
	assert.match(text(ws), /remote admin · as dev-one/);
	assert.equal(ws.props['data-state'], 'ok');
	assert.match(String(ws.props['title'] ?? ''), /GitHub: admin on acme\/hq/);
	const entryHead = find(root, (n) => hasClass(n, 'dt-sources__entry') && n.props['data-source'] === 'project-d')!;
	assert.ok(find(entryHead, (n) => hasClass(n, 'dt-source-mark__name')), 'the local mark is still drawn');
	assert.ok(find(entryHead, (n) => hasClass(n, 'dt-remote-access')), 'and the remote mark beside it');
	assert.match(text(markOf(root, 'project-d')!), /remote read · as dev-one/, 'local read, remote read: no warning');
	assert.ok(!hasClass(markOf(root, 'project-d')!, 'is-warning'));
	unmountAll();
});

test('push refused only when the local mark writes, the remote is below write, and the answer is tied', async () => {
	stub();
	const root = await pane();
	const a = markOf(root, 'project-a')!;
	assert.ok(hasClass(a, 'is-warning'), 'tied, read, local write → warning');
	assert.match(text(a), /push refused — Dev Example has read on example-ws\/project-a/);
	const b = markOf(root, 'project-b')!;
	assert.ok(!hasClass(b, 'is-warning'), 'untied → no warning it cannot stand behind');
	assert.match(text(b), /remote read · as dev-two/);
	assert.match(text(b) + String(b.props['title'] ?? ''), /could not be confirmed/);
	unmountAll();
});

test('a missing login names the login and how to add it; an absent layer is not checked; the others still draw', async () => {
	stub();
	const root = await pane();
	assert.match(text(markOf(root, 'org')!), /no Bitbucket login — run 'dreamteamer: Set Bitbucket credential'/);
	assert.match(text(markOf(root, 'project-c')!), /remote not checked — not installed/);
	assert.ok(markOf(root, 'my-hq') && markOf(root, 'project-a'), 'the rest of the section drew');
	unmountAll();
});

test('the stack draws first; a failing access read leaves it drawn and says so', async () => {
	stub(new Error('down'));
	const root = await pane();
	assert.ok(find(root, (n) => hasClass(n, 'dt-sources__entry') && n.props['data-source'] === 'project-a'), 'the stack is drawn');
	assert.match(text(root), /remote access could not be read/);
	unmountAll();
});

test('Re-check asks the host again with fresh=1', async () => {
	stub();
	const root = await pane();
	const before = requests.filter((r) => r.path.startsWith('/sources/access')).length;
	await press(find(root, (n) => hasClass(n, 'dt-sources__recheck')));
	const asked = requests.filter((r) => r.path.startsWith('/sources/access')).slice(before);
	assert.deepEqual(asked.map((r) => r.path), ['/sources/access?fresh=1']);
	unmountAll();
});

test('Who has access asks for that one source and draws its rows with level and the provider\'s note', async () => {
	stub();
	const root = await pane();
	await press(find(root, (n) => hasClass(n, 'dt-sources__who') && n.props['data-source'] === 'my-hq'));
	assert.ok(requests.some((r) => r.path === '/sources/access/members?source=my-hq'), requests.map((r) => r.path).join(', '));
	const rows = rowsOf(root);
	assert.deepEqual(rows, ['dev-one user admin', 'user-b user read']);
	assert.match(text(find(root, (n) => hasClass(n, 'dt-remote-members__reason'))!), /teams are not visible to dev-one/);
	unmountAll();
});

test('refused: the provider\'s rule in our words, and yourself as the one row', async () => {
	stub();
	const root = await pane();
	await press(find(root, (n) => hasClass(n, 'dt-sources__who') && n.props['data-source'] === 'project-a'));
	assert.match(text(find(root, (n) => hasClass(n, 'dt-remote-members__reason'))!), /only to repo admins; Dev Example has read/);
	const rows = rowsOf(root);
	assert.deepEqual(rows, ['Dev Example user read you']);
	unmountAll();
});

test('no Who has access on a source that was not checked', async () => {
	stub();
	const root = await pane();
	assert.equal(find(root, (n) => hasClass(n, 'dt-sources__who') && n.props['data-source'] === 'project-c'), null);
	unmountAll();
});
