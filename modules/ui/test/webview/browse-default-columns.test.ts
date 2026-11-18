/**
 * A browse whose collection authors no `display.list.columns` falls back to the HEURISTIC column set —
 * and must do so when the collection's fields are ALREADY LOADED, which is the ordinary second visit.
 *
 * ⚠ THE BUG THIS GUARDS (measured in a dev host, 0.24.19): `ensureSelection` is first run by a
 * watcher registered with `immediate: true`, and the heuristic branch reads `sources` — a computed
 * declared further down the composable. With the fields cached, that first run happened during setup,
 * hit the temporal dead zone ("Cannot access … before initialization") AFTER marking the selection
 * initialised, and the list drew zero columns for the rest of the session. A collection with authored
 * columns never evaluates the heuristic, which is why it hid for so long.
 *
 * The collection is invented here (`gadgets`); nothing is copied from any workspace.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { flush, render } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { useFields } from '../../src/composables/fields';
import { useCollections } from '../../src/composables/collections';
import { useBrowseState } from '../../src/composables/browse-state';
import { fieldRow } from '../unit/field-rows';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const FIELDS = [fieldRow('name', { collection: 'gadgets' }), fieldRow('status', { collection: 'gadgets', editor_options: { choices: [{ text: 'on', value: 'on' }] } })];
const ROW = { collection: 'gadgets', title: 'Gadgets', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'gadget', runtime: false, internal: false };

test('with the fields already loaded, a collection with no authored columns still gets the heuristic set', async () => {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { gadgets: FIELDS }, relations: [] };
		if (path === '/info') return { modules: [] };
		if (method === 'GET' && path.startsWith('/collections/gadgets/records')) return { records: [], total: 0 };
		return {};
	});
	// the second visit: fields and the collections overview are both resolved before the browse mounts
	useFields('gadgets');
	useCollections();
	await flush();
	await flush();

	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push('/content/gadgets');
	await router.isReady();
	let state: ReturnType<typeof useBrowseState> | undefined;
	const Probe = defineComponent({
		setup() {
			state = useBrowseState('gadgets');
			return () => null;
		},
	});
	await render(Probe, {}, [router]);
	await flush();
	assert.deepEqual(state!.columns.value.map((f) => f.field), ['name', 'status']);
});
