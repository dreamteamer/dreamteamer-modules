/**
 * The harness for the shell-flag tests (shell-flag-off / shell-flag-on): a window that keeps its listeners, App mounted
 * over a router whose content route draws a table list whose records never arrive (a first load in progress), and the
 * marks each shell feature leaves. The host flag must be set BEFORE this module loads: `lib/app-shell.ts` reads
 * `window.__DT_HOST__` once, at import — which is why each test file sets it in its own first import.
 */
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, flush, hasClass, render, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { lists } from '../../src/registry/index';
import { fieldRow } from '../unit/field-rows';
import App from '../../src/App.vue';
import BrowseView from '../../src/components/BrowseView.vue';
import DataTable from '../../src/components/DataTable.vue';

import { windowListeners } from './shell-host-globals';

const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: [] };

export async function mountApp(): Promise<TestNode> {
	lists.register({ id: 'table', name: 'Table', component: DataTable, fillsHeight: true } as never);
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { name: 'northwind', modules: [] };
		if (path === '/nav') return [{ kind: 'workspace', key: 'workspace', label: 'northwind', children: [{ kind: 'collection', key: 'c/tasks', label: 'Tasks', route: '/content/tasks', target: { name: 'tasks' } }] }];
		// the list's first load never answers: what DataTable draws while it waits is under test
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return new Promise(() => {});
		if (path.startsWith('/commit')) return [];
		if (path === '/ui-views' || path.startsWith('/collections')) return [];
		return {};
	});
	await refreshCollections();
	const Tasks = defineComponent({ setup: () => () => h(BrowseView, { collection: 'tasks' }) });
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/content/tasks', component: Tasks }, { path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push('/content/tasks');
	await router.isReady();
	const root = await render(App, {}, [router]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}

export const has = (root: TestNode, cls: string) => all(root, (n) => hasClass(n, cls)).length > 0;

/** Press Cmd-K the way a browser delivers it to every window keydown listener. */
export async function cmdK(): Promise<void> {
	for (const fn of [...(windowListeners['keydown'] ?? [])]) fn({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} });
	for (let i = 0; i < 3; i++) await flush();
}
