/**
 * The sessions list's `records` column (cr-vscode-019, acceptance line 4; test cr-vscode-019-t4). Core
 * 0.9.0's `sessions.records` is a many-reference with NO target collection — refs into any collection,
 * a namespaced one included — and `display.list.columns` lists it. The table draws a column through
 * `ViewRelation`; each ref reads as its own record's title and links to it, in the list cell too: such a
 * column has no target to open from the row, so the cell rule (text only) keeps to TARGETED references.
 * `DtLink` stops the click, so the row's own gesture is untouched. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, flush, hasClass, render, text } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import type { CollectionRow } from '../../src/api/types';
import { referenceRow } from '../unit/field-rows';
import ViewRelation from '../../src/views/ViewRelation.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const row = (collection: string, record_title: string): CollectionRow => ({
	collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] },
	record_title, record_type: collection, runtime: false, internal: false,
});

async function mount(context: 'cell' | 'record') {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [row('sessions', '{{ name }}'), row('things', '{{ title }}'), row('ns/widgets', '{{ label }}'), row('notes', '{{ title }}')], fields: { sessions: [] }, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		if (path === '/collections/things/records/a') return { id: 'a', fields: { title: 'Alpha thing' } };
		if (path === '/collections/ns%2Fwidgets/records/b') return { id: 'b', fields: { label: 'Bravo widget' } };
		if (path === '/collections/notes/records/c') return { id: 'c', fields: { title: 'Charlie note' } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/sessions/s-1');
	await r.isReady();
	const field = referenceRow('records', true, { collection: 'sessions' });
	const root = await render(ViewRelation, { value: ['things/a', 'ns/widgets/b', 'notes/c'], field, context }, [r]);
	for (let i = 0; i < 8; i++) await flush();
	return root;
}

test('the list cell links each ref of an untargeted many-reference to its record, read as its title (code review c1-01)', async () => {
	const root = await mount('cell');
	const links = all(root, (n) => hasClass(n, 'dt-link'));
	assert.deepEqual(links.map((l) => [text(l).trim(), l.props['href']]), [
		['Alpha thing', '/content/things/a'],
		['Bravo widget', '/content/ns/widgets/b'],
		['Charlie note', '/content/notes/c'],
	]);
});

test('a TARGETED reference column keeps the cell rule: text, no link', async () => {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [row('visits', '{{ reason }}'), row('things', '{{ title }}')], fields: { visits: [] }, relations: [{ collection: 'visits', field: 'thing', related_collection: 'things', list: false, kind: 'm2o' }] };
		if (path === '/info') return { name: 'scratch' };
		if (path === '/collections/things/records/a') return { id: 'a', fields: { title: 'Alpha thing' } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/visits/v-1');
	await r.isReady();
	const root = await render(ViewRelation, { value: 'things/a', field: referenceRow('thing', false, { collection: 'visits' }) }, [r]);
	for (let i = 0; i < 8; i++) await flush();
	assert.equal(all(root, (n) => hasClass(n, 'dt-link')).length, 0);
	assert.match(text(all(root, (n) => hasClass(n, 'dt-display-relation'))[0]!), /Alpha thing/);
});

test("on the session's page each title is a link to its record, the namespaced one included", async () => {
	const root = await mount('record');
	const links = all(root, (n) => hasClass(n, 'dt-link'));
	assert.deepEqual(links.map((l) => [text(l).trim(), l.props['href']]), [
		['Alpha thing', '/content/things/a'],
		['Bravo widget', '/content/ns/widgets/b'],
		['Charlie note', '/content/notes/c'],
	]);
});
