/**
 * EVERY LIST HAS THE SOURCE PICKER (operator 2026-10-29: "all list views should have sources filter,
 * skills, commands, agents"). Skills, commands and agents browse through the ordinary pipeline, so the
 * host sourcing their rows to a module is enough (unit: `runtimeSources`); the Schema tab's Modules
 * and Collections pages are tables of their own, so this renders one against the host stub and
 * performs the pick: a source picked, the other source's rows leave.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import ModuleList from '../../src/pages/ModuleList.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/modules');
	await r.isReady();
	return r;
}

const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'modules/default', installed: true, count: 1 },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/modules/project-a', installed: true, count: 1 },
	{ name: 'tasks', kind: 'module', repo: '.', path: 'node_modules/@scope/tasks', installed: true, count: 1 },
];

const press = async (n: TestNode) => {
	(n.props['onClick'] as () => void)();
	await flush();
};
const moduleRows = (root: TestNode) => all(root, (n) => n.tag === 'tr' && n.parent?.tag === 'tbody').map((n) => text(n));

test('the Modules page has the picker, and a pick narrows its rows to that source', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { modules: [] };
		if (method === 'GET' && path.startsWith('/collections/modules/records')) {
			return {
				records: [
					{ id: 'default', name: 'default', $source: 'my-hq' },
					{ id: 'project-a', name: 'project-a', $source: 'project-a' },
					{ id: 'tasks', name: 'tasks', $source: 'tasks' },
				],
				total: 3,
				sources: SOURCES,
			};
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const root = await render(ModuleList, {}, [await router()]);
	await flush();
	await flush();
	assert.equal(moduleRows(root).length, 3);

	const trigger = find(root, (n) => hasClass(n, 'dt-source-picker__trigger'));
	assert.ok(trigger, 'the Modules page draws the source picker');
	await press(trigger!);
	const row = find(root, (n) => hasClass(n, 'dt-source-picker__row') && n.props['data-source'] === 'project-a')!;
	assert.match(text(row), /1/);
	await press(row);

	const left = moduleRows(root);
	assert.equal(left.length, 1);
	assert.match(left[0]!, /project-a/);
});
