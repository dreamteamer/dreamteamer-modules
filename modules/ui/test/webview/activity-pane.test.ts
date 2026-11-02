/**
 * THE ACTIVITY PAGE (operator 2026-10-29: "activity should link to commit item on source control.
 * paging. aggregated activity should show repo name"). Rendered against the host stub and proved by
 * performing each gesture: a commit click asks the host to open it, the pager asks for the next
 * offset, and an unnarrowed page marks every entry with its repo while a narrowed one does not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { notifications, onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import ActivityPane from '../../src/pages/ActivityPane.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/activity');
	await r.isReady();
	return r;
}

const entry = (sha: string, repo: string, source: string, date = '2026-10-03T10:00:00+00:00') => ({ sha, repo, source, author: 'Dana', date, subject: `subject ${sha}`, records: [], files: 0 });

function stub() {
	resetHost();
	notifications.length = 0;
	onHostRequest((method, path) => {
		if (method === 'GET' && path.startsWith('/activity')) {
			const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset') ?? 0);
			return offset === 0
				? { module: null, scopes: [{ repo: '.', paths: [] }], entries: [entry('aaaaaaa1', '.', 'my-hq'), entry('bbbbbbb2', 'git_modules/project-a', 'project-a')], offset, limit: 20, hasMore: true, pending: [], failed: [], settled: 1 }
				: { module: null, scopes: [{ repo: '.', paths: [] }], entries: [entry('ccccccc3', '.', 'my-hq')], offset, limit: 20, hasMore: false, pending: [], failed: [], settled: 1 };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}

const press = async (n: TestNode) => {
	(n.props['onClick'] as () => void)();
	await flush();
	await flush();
};
const marks = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-source-mark__name')).map((n) => text(n).trim());

test('unnarrowed, every entry carries its repo name; a commit click opens it in Source Control', async () => {
	stub();
	const root = await render(ActivityPane, {}, [await router()]);
	await flush();
	await flush();
	assert.deepEqual(marks(root), ['my-hq', 'project-a']);

	await press(find(root, (n) => hasClass(n, 'dt-activity__subject') && text(n).includes('bbbbbbb2'))!);
	assert.deepEqual(notifications.at(-1), { type: 'dt:command', payload: { command: 'dreamteamer.viewCommit', arg: { repo: 'git_modules/project-a', sha: 'bbbbbbb2' } } });
});

test('narrowed to one module, no repo mark — every entry is that module', async () => {
	stub();
	const root = await render(ActivityPane, { module: 'project-a', moduleTitle: 'Project A' }, [await router()]);
	await flush();
	await flush();
	assert.deepEqual(marks(root), []);
});

test('the pager asks for the next page and stops where the host says there is none', async () => {
	stub();
	const root = await render(ActivityPane, {}, [await router()]);
	await flush();
	await flush();
	const pager = () => find(root, (n) => hasClass(n, 'dt-activity__pager'))!;
	const [newer, older] = all(pager(), (n) => n.tag === 'button');
	assert.equal(newer!.props['disabled'], true);
	await press(older!);
	assert.match(requests.at(-1)!.path, /offset=20/);
	assert.match(text(root), /subject ccccccc3/);
	assert.match(text(pager()), /21–21/);
	const [, older2] = all(pager(), (n) => n.tag === 'button');
	assert.equal(older2!.props['disabled'], true);
});

// operator 2026-10-31: "don't wait for everything to load, it's slow on some repos with heavy git history"
test('a repo still being read is named, and the follow-up request fills it in', async () => {
	resetHost();
	let answer!: (v: unknown) => void;
	const later = new Promise((r) => (answer = r));
	onHostRequest((method, path) => {
		const q = new URLSearchParams(path.split('?')[1]);
		if (method !== 'GET' || !path.startsWith('/activity')) throw new Error(`the render tier did not stub ${method} ${path}`);
		const base = { module: null, scopes: [{ repo: '.', paths: [] }, { repo: 'git_modules/heavy', paths: [] }], offset: 0, limit: 20, hasMore: false, failed: [] };
		if (!q.has('settled')) return { ...base, entries: [entry('aaaaaaa1', '.', 'my-hq')], pending: ['heavy'], settled: 1 };
		return later.then(() => ({ ...base, entries: [entry('hhhhhhh1', 'git_modules/heavy', 'heavy', '2026-10-04T10:00:00+00:00'), entry('aaaaaaa1', '.', 'my-hq')], pending: [], settled: 2 }));
	});
	const root = await render(ActivityPane, {}, [await router()]);
	await flush();
	await flush();
	assert.deepEqual(marks(root), ['my-hq'], 'the repo that answered is on screen');
	assert.match(text(root), /Still reading heavy/);
	assert.match(requests.at(-1)!.path, /settled=1/, 'and the pane asked again with what it has');

	answer(undefined);
	await flush();
	await flush();
	assert.deepEqual(marks(root), ['heavy', 'my-hq']);
	assert.doesNotMatch(text(root), /Still reading/);
	assert.equal(requests.filter((r) => r.path.startsWith('/activity')).length, 2, 'no more requests once nothing is pending');
});

test('leaving the page stops its follow-up requests — none is sent for an unmounted pane', async () => {
	resetHost();
	const held: Array<() => void> = [];
	onHostRequest((method, path) => {
		if (method !== 'GET' || !path.startsWith('/activity')) throw new Error(`the render tier did not stub ${method} ${path}`);
		const page = { module: null, scopes: [{ repo: '.', paths: [] }, { repo: 'git_modules/heavy', paths: [] }], offset: 0, limit: 20, hasMore: false, failed: [], entries: [entry('aaaaaaa1', '.', 'my-hq')], pending: ['heavy'], settled: 1 };
		if (!new URLSearchParams(path.split('?')[1]).has('settled')) return page;
		return new Promise((resolve) => held.push(() => resolve(page)));
	});
	await render(ActivityPane, {}, [await router()]);
	await flush();
	await flush();
	const asked = () => requests.filter((r) => r.path.startsWith('/activity')).length;
	assert.equal(asked(), 2, 'the page, and one follow-up in flight');
	unmountAll();
	held.shift()!();
	await flush();
	await flush();
	assert.equal(asked(), 2, 'the answer to the last follow-up asks for nothing more');
});
