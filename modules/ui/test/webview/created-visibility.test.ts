/**
 * A RECORD CREATED UNDER A SOURCES SELECTION STAYS VISIBLE (design 2026-10-30, Q3-B). The list opens
 * create with its selection on the route (`?sources=project-a`); after the save, the list it returns to
 * WIDENS the selection to the root the record was saved to, and says so, once. `useBrowseState` is the
 * real composable, over a host stub. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { flush, render } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { useBrowseState } from '../../src/composables/browse-state';
import { noteCreated } from '../../src/lib/created-visibility';
import { selectedSources, withSourceSelection } from '../../src/lib/sources';
import { emptyFilterGroup, serializeFilterGroup } from '../../src/lib/filter-query';
import { fieldRow } from '../unit/field-rows';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 1 },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1 },
];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };

function host() {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { modules: [] };
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return { records: [], total: 0, sources: SOURCES };
		return {};
	});
}

const onlyProjectA = serializeFilterGroup(withSourceSelection(emptyFilterGroup(), ['project-a']))!;

async function mountAt(url: string) {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(url);
	await r.isReady();
	let state!: ReturnType<typeof useBrowseState>;
	const Harness = defineComponent({ setup() { state = useBrowseState('tasks'); return () => null; } });
	await render(Harness, {}, [r]);
	await flush();
	return { state, router: r };
}

test('create from a list narrowed to project-a carries the selection on the route', async () => {
	host();
	const { state, router } = await mountAt(`/tasks?filter=${encodeURIComponent(onlyProjectA)}`);
	assert.deepEqual(selectedSources(state.filterGroup.value), ['project-a']);
	state.createRecord();
	await flush();
	assert.match(router.currentRoute.value.path, /\/tasks\/\+$/, 'the create route');
	assert.equal(router.currentRoute.value.query['sources'], 'project-a');
});

test('back on the list after a save to my-hq: the selection widens to show it, and a notice says so — once', async () => {
	host();
	noteCreated({ collection: 'tasks', id: 'call-harbor', source: 'my-hq' });
	const { state, router } = await mountAt(`/tasks?filter=${encodeURIComponent(onlyProjectA)}`);
	assert.deepEqual(selectedSources(state.filterGroup.value), ['project-a', 'my-hq'], 'widened to the root the record was saved to');
	assert.deepEqual(state.createdNotice.value, { collection: 'tasks', id: 'call-harbor', source: 'my-hq' });
	assert.match(String(router.currentRoute.value.query['filter']), /my-hq/, 'the widened selection is written to the URL like any pick');

	const again = await mountAt(`/tasks?filter=${encodeURIComponent(onlyProjectA)}`);
	assert.deepEqual(selectedSources(again.state.filterGroup.value), ['project-a'], 'consumed: a later visit is not widened');
	assert.equal(again.state.createdNotice.value, null);
});

test('a list already showing the root is left alone, with no notice', async () => {
	host();
	noteCreated({ collection: 'tasks', id: 'call-harbor', source: 'my-hq' });
	const { state } = await mountAt('/tasks');
	assert.deepEqual(selectedSources(state.filterGroup.value), []);
	assert.equal(state.createdNotice.value, null);
});

test('the widening survives the view seed — a session scratch narrowed to project-a does not narrow it back', async () => {
	// measured in a dev host: the list's session scratch (the filter as it was BEFORE the create)
	// was re-applied when the view seed landed, and the notice drew over a list still narrowed
	host();
	const first = await mountAt('/tasks');
	first.state.filterGroup.value = withSourceSelection(first.state.filterGroup.value, ['project-a']);
	await flush();
	noteCreated({ collection: 'tasks', id: 'call-harbor', source: 'my-hq' });
	const { state } = await mountAt(`/tasks?filter=${encodeURIComponent(onlyProjectA)}`);
	await flush();
	assert.deepEqual(selectedSources(state.filterGroup.value), ['project-a', 'my-hq']);
	assert.ok(state.createdNotice.value);
});

