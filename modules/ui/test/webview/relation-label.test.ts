/**
 * A RELATION CELL names a record the way the record is named everywhere else: through its TARGET
 * collection's `record_title` (descriptor v2 §3.1), resolved by `lib/record-titles.ts` — the same
 * one-hop resolution a display template, a record header and a card use. A field-level
 * `viewer_options.template` is not a second answer to "what is this record called" and is not read.
 *
 * Rendered over the real adapter and the real reference resolver: the collection rows arrive through
 * `/presentation`, the target record through the host's record route, with a NAMESPACED target so the
 * reference must be split at the registered collection name, never at its first slash.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { find, flush, hasClass, render, text } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import type { CollectionRow } from '../../webview/src/api/types';
import { referenceRow } from '../unit/field-rows';
import ViewRelation from '../../webview/src/views/ViewRelation.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const row = (collection: string, record_title: string): CollectionRow => ({
	collection,
	title: collection,
	nav: {},
	list: { layout: 'table' },
	record: { layout: 'page' },
	form: { sections: [] },
	record_title,
	record_type: collection,
	runtime: false,
	internal: false,
});

const PATIENTS = row('health/patients', '{{ name }} ({{ clinic }})');
const VISITS = row('health/visits', '{{ reason }}');

beforeEach(() => {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return {
				collections: [VISITS, PATIENTS],
				fields: { 'health/visits': [], 'health/patients': [] },
				relations: [{ collection: 'health/visits', field: 'patient', related_collection: 'health/patients', list: false, kind: 'm2o' }],
			};
		}
		if (path === '/info') return { name: 'scratch' };
		if (path === '/collections/health%2Fpatients/records/dana-oren') return { id: 'dana-oren', fields: { name: 'Dana Oren', clinic: 'Northwind' } };
		if (path.startsWith('/collections/health%2Fpatients/records/')) return null;
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function router() {
	return createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
}

const cell = async (value: unknown) => {
	const r = router();
	await r.push('/content/health/visits/v-01');
	await r.isReady();
	// The field carries a field-level template on purpose: it must lose to the target's record_title.
	const field = referenceRow('patient', false, { collection: 'health/visits', viewer_options: { template: '{{ clinic }}' } });
	const root = await render(ViewRelation, { value, field }, [r]);
	for (let i = 0; i < 4; i++) await flush();
	return text(find(root, (n) => hasClass(n, 'dt-display-relation'))!).trim();
};

test('a reference reads as the target collection’s record_title, not a field-level template', async () => {
	assert.equal(await cell('health/patients/dana-oren'), 'Dana Oren (Northwind)');
});

test('a reference to a record that does not exist keeps its de-slugged stem', async () => {
	assert.equal(await cell('health/patients/no-such-person'), 'no-such-person');
});
