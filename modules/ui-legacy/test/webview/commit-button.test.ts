/**
 * The commit button names the REPO an edit lands in — "Commit to <repo>" — and becomes a dropdown
 * with one row per repo when pending edits span several. Rendered against the host stub, because
 * the button's words are the only place "where does this commit" is said (design rule 2: the mark
 * means read-from, the commit action means commit-to), and a pure grouping function that was right
 * while the button still read "Commit 3" would be the gap this tier exists for.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text } from './render';
import CommitButton from '../../src/components/CommitButton.vue';

(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/tasks');
	await r.isReady();
	return r;
}

type Plan = Array<{ repo: string; rows: Array<{ collection: string; id: string; verb: string }> }>;

function host(plan: Plan) {
	onHostRequest((method, path, body) => {
		if (path === '/info') return { name: 'my-hq' };
		if (path === '/commit' && method === 'POST') {
			if ((body as { dryRun?: boolean })?.dryRun) return plan;
			return plan.map((p) => ({ ...p, subject: 'dreamteamer: commit', sha: 'abc' }));
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}

beforeEach(resetHost);

const button = (root: Parameters<typeof find>[0]) => find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-commit__button'));
const items = (root: Parameters<typeof all>[0]) => all(root, (n) => n.tag === 'button' && hasClass(n, 'dt-commit__item'));
const click = async (n: NonNullable<ReturnType<typeof find>>) => {
	(n.props['onClick'] as () => void)();
	await flush();
};

test('nothing pending, nothing drawn', async () => {
	host([]);
	const root = await render(CommitButton, {}, [await router()]);
	assert.equal(button(root), null);
});

test('one repo: the button says which — the workspace by its own name', async () => {
	host([{ repo: '.', rows: [{ collection: 'tasks', id: 'a', verb: 'set' }, { collection: 'tasks', id: 'b', verb: 'add' }] }]);
	const root = await render(CommitButton, {}, [await router()]);
	const b = button(root)!;
	assert.equal(text(b).replace(/\s+/g, ' ').trim(), 'Commit to my-hq · 2');
	assert.equal(b.props['data-repo'], '.');
	assert.equal(items(root).length, 0, 'no dropdown for one repo');
	await click(b);
	const commits = requests.filter((r) => r.path === '/commit' && !(r.body as { dryRun?: boolean })?.dryRun);
	assert.deepEqual(commits.map((r) => r.body), [{}], 'everything pending, unscoped');
});

test('one repo that is a clone: the button says its path — honest about which clone', async () => {
	host([{ repo: 'git_modules/org', rows: [{ collection: 'people', id: 'dana', verb: 'set' }] }]);
	const root = await render(CommitButton, {}, [await router()]);
	assert.equal(text(button(root)!).replace(/\s+/g, ' ').trim(), 'Commit to git_modules/org · 1');
});

test('several repos: a dropdown with one row per repo and its count, and a row commits that repo\'s rows alone', async () => {
	host([
		{ repo: '.', rows: [{ collection: 'tasks', id: 'a', verb: 'set' }, { collection: 'roles', id: 'reviewer', verb: 'set' }] },
		{ repo: 'git_modules/org', rows: [{ collection: 'people', id: 'dana', verb: 'add' }] },
	]);
	const root = await render(CommitButton, {}, [await router()]);
	const trigger = button(root)!;
	assert.equal(text(trigger).replace(/\s+/g, ' ').trim(), 'Commit 3');
	assert.equal(items(root).length, 0, 'closed until opened');
	await click(trigger);
	const rows = items(root);
	const part = (n: (typeof rows)[number], cls: string) => text(find(n, (x) => hasClass(x, cls))!).trim();
	assert.deepEqual(rows.map((n) => [part(n, 'dt-commit__item-label'), part(n, 'dt-commit__item-count')]), [['Commit to my-hq', '2'], ['Commit to git_modules/org', '1']]);
	assert.deepEqual(rows.map((n) => n.props['data-repo']), ['.', 'git_modules/org']);

	await click(rows[1]!);
	const commits = requests.filter((r) => r.path === '/commit' && !(r.body as { dryRun?: boolean })?.dryRun);
	assert.deepEqual(commits.map((r) => r.body), [{ only: ['people/dana'] }], 'scoped to that repo\'s own records');
	assert.equal(items(root).length, 0, 'the menu closed on the pick');
});

// cr-modules-017: a commit is an Admin route. A pane below Admin never asks for the dry run (a 403 on every page)
// and draws no button; at Admin, and in the editor (no GET /host), it does as before.
test('a pane below Admin asks no dry run and draws no button; at Admin it does', async () => {
	const { hostInfo } = await import('../../src/lib/host-boot');
	host([{ repo: '.', rows: [{ collection: 'tasks', id: 'a', verb: 'set' }] }]);
	hostInfo.value = { level: 'edit', chat: false, workspace: { id: 'w1', name: 'my-hq' } };
	const root = await render(CommitButton, {}, [await router()]);
	assert.equal(requests.filter((r) => r.path === '/commit').length, 0, 'no POST /commit below Admin');
	assert.equal(button(root), null);
	hostInfo.value = { level: 'admin', chat: false, workspace: { id: 'w1', name: 'my-hq' } };
	await flush();
	assert.ok(requests.some((r) => r.path === '/commit'), 'raised to Admin, the dry run is asked');
	assert.ok(button(root), 'and the button draws');
	hostInfo.value = null;
});
