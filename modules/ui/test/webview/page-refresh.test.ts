/**
 * THE REFRESH BUTTON'S WEBVIEW HALF: `refreshPages()` (composables/page-caches.ts) makes the open list
 * and record page re-fetch their records AND the titles of the records they reference, keeps a dirty
 * record's edits, and says so.
 *
 * Over the real adapter, composables and `ViewRelation`, with the host stub as the disk: the stub's
 * answers change between the first paint and the refresh, exactly as a terminal `dt set` changes the
 * files behind an open tab. A title is read through the rendered relation cell, never by calling the
 * resolver in the harness — a resolver that answers when asked but tells no renderer to ask again is
 * the defect this guards against.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { defineComponent, effectScope, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { HostError, onHostRequest, requests, resetHost } from './host-stub';
import { find, flush, hasClass, render, text, unmountAll } from './render';
import { invalidateContract } from '../../src/api/adapter';
import type { CollectionRow } from '../../src/api/types';
import { referenceRow } from '../unit/field-rows';
import ViewRelation from '../../src/views/ViewRelation.vue';
import RefreshSkippedNotice from '../../src/components/RefreshSkippedNotice.vue';
import { useItem, useItems } from '../../src/composables/items';
import { useGroupLabels } from '../../src/lib/group-label';
import { refreshPages } from '../../src/composables/page-caches';

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

const VISITS = row('clinic/visits', '{{ reason }}');
const DOCTORS = row('clinic/doctors', '{{ name }}');

/** The "disk": what the host answers right now. */
const disk = { reason: 'checkup', doctors: {} as Record<string, string> };
/** A doctor read held open until the test releases it — the in-flight title load of the race case. */
let hold: { id: string; release?: () => void } | null = null;

beforeEach(() => {
	unmountAll(); // a page left mounted by the test before would answer the refresh too
	resetHost();
	invalidateContract();
	disk.reason = 'checkup';
	hold = null;
	onHostRequest(async (method, path) => {
		if (path === '/presentation') {
			return {
				collections: [VISITS, DOCTORS],
				fields: { 'clinic/visits': [], 'clinic/doctors': [] },
				relations: [{ collection: 'clinic/visits', field: 'doctor', related_collection: 'clinic/doctors', list: false, kind: 'm2o' }],
			};
		}
		if (path === '/info') return { name: 'scratch' };
		if (path === '/relations') return [];
		if (method === 'GET' && path.startsWith('/collections/clinic%2Fvisits/records?')) {
			return { records: [{ id: 'v1', reason: disk.reason }], total: 1 };
		}
		if (method === 'GET' && path === '/collections/clinic%2Fvisits/records/v1') return { id: 'v1', fields: { reason: disk.reason } };
		const doc = /^\/collections\/clinic%2Fdoctors\/records\/(.+)$/.exec(path);
		if (method === 'GET' && doc) {
			const id = decodeURIComponent(doc[1]!);
			if (disk.doctors[id] === undefined) throw new HostError(`no record ${id}`, 404); // removed on disk
			const answer = { id, fields: { name: disk.doctors[id] } };
			if (hold && hold.id === id && !hold.release) {
				// answer with what the disk said WHEN ASKED, but only once released
				return await new Promise((resolve) => {
					hold!.release = () => resolve(answer);
				});
			}
			return answer;
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function router() {
	return createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
}

const gets = (prefix: string) => requests.filter((r) => r.method === 'GET' && r.path.startsWith(prefix)).length;
const settle = async () => {
	for (let i = 0; i < 4; i++) await flush();
};

/** A page: a list of visits, one visit's record, and that visit's doctor through the real relation cell. */
async function page(doctorId: string) {
	let item!: ReturnType<typeof useItem>;
	const field = referenceRow('doctor', false, { collection: 'clinic/visits' });
	const Harness = defineComponent({
		setup() {
			const list = useItems('clinic/visits');
			item = useItem('clinic/visits', 'v1');
			void item.load();
			return () =>
				h('div', [
					h('span', { class: 'probe-list' }, list.items.value.map((r) => String(r['reason'])).join(',')),
					h('span', { class: 'probe-record' }, String(item.record.value?.['reason'] ?? '')),
					h(ViewRelation, { value: `clinic/doctors/${doctorId}`, field }),
				]);
		},
	});
	const r = router();
	await r.push('/content/clinic/visits/v1');
	await r.isReady();
	const root = await render(Harness, {}, [r]);
	await settle();
	const read = (cls: string) => text(find(root, (n) => hasClass(n, cls))!).trim();
	return {
		item,
		list: () => read('probe-list'),
		record: () => read('probe-record'),
		doctor: () => read('dt-display-relation'),
	};
}

test('refresh re-fetches the list, the record and the referenced title, with no flash to the bare reference', async () => {
	disk.doctors['dr-a'] = 'Avery Lane';
	const p = await page('dr-a');
	assert.equal(p.list(), 'checkup');
	assert.equal(p.record(), 'checkup');
	assert.equal(p.doctor(), 'Avery Lane');

	// a terminal `dt set` on both records
	disk.reason = 'follow-up';
	disk.doctors['dr-a'] = 'Avery Lane-Okafor';
	const before = { list: gets('/collections/clinic%2Fvisits/records?'), record: gets('/collections/clinic%2Fvisits/records/v1'), doctor: gets('/collections/clinic%2Fdoctors/records/dr-a') };

	refreshPages();
	await nextTick(); // the re-render the reset caused, before any new title can land
	assert.equal(p.doctor(), 'Avery Lane', 'while the new title is in flight the cell keeps the old one, never the bare reference');
	await settle();

	assert.ok(gets('/collections/clinic%2Fvisits/records?') > before.list, 'the list was asked again');
	assert.ok(gets('/collections/clinic%2Fvisits/records/v1') > before.record, 'the record was asked again');
	assert.ok(gets('/collections/clinic%2Fdoctors/records/dr-a') > before.doctor, 'the referenced record was asked again');
	assert.equal(p.list(), 'follow-up');
	assert.equal(p.record(), 'follow-up');
	assert.equal(p.doctor(), 'Avery Lane-Okafor', 'the relation cell reads the referenced record’s new title');
});

test('a dirty record is not re-fetched by refresh, keeps its edit, and says so until the edit is discarded', async () => {
	disk.doctors['dr-b'] = 'Blake Moss';
	const p = await page('dr-b');
	p.item.setField('reason', 'typed, unsaved');
	disk.reason = 'changed on disk';
	const before = gets('/collections/clinic%2Fvisits/records/v1');
	refreshPages();
	await settle();
	assert.equal(gets('/collections/clinic%2Fvisits/records/v1'), before, 'no record GET while dirty');
	assert.deepEqual(p.item.edits.value, { reason: 'typed, unsaved' }, 'the edit is kept');
	assert.equal(p.item.refreshSkipped.value, true, 'the page knows it did not reload');
	p.item.discard();
	await flush();
	assert.equal(p.item.refreshSkipped.value, false, 'discarding the edit clears the notice');
	assert.equal(p.list(), 'changed on disk', 'the list beside it did re-fetch');
});

test('a title load in flight across a refresh cannot write the old title back', async () => {
	disk.doctors['dr-c'] = 'Casey Old';
	hold = { id: 'dr-c' };
	const p = await page('dr-c');
	assert.ok(hold.release, 'the first title read is held open');
	disk.doctors['dr-c'] = 'Casey New';
	refreshPages(); // drops the record cache too, so the second read is a fresh request
	await settle();
	assert.equal(p.doctor(), 'Casey New');
	hold.release!(); // the stale v1 answer lands last
	await settle();
	assert.equal(p.doctor(), 'Casey New', 'the late v1 answer is dropped');
});

test('gantt band labels re-fetch their records on refresh', async () => {
	disk.doctors['dr-d'] = 'Dana Fox';
	const field = referenceRow('doctor', false, { collection: 'clinic/visits' });
	const scope = effectScope();
	const labels = scope.run(() =>
		useGroupLabels({ values: () => ['clinic/doctors/dr-d'], field: () => field, template: () => null, collection: () => 'clinic/visits' }),
	)!;
	labels.resolve();
	await settle();
	assert.equal(labels.labels.value['clinic/doctors/dr-d'], 'Dana Fox');
	disk.doctors['dr-d'] = 'Dana Fox-Rivera';
	const before = gets('/collections/clinic%2Fdoctors/records/dr-d');
	refreshPages();
	await settle();
	assert.ok(gets('/collections/clinic%2Fdoctors/records/dr-d') > before, 'the band record was asked again');
	assert.equal(labels.labels.value['clinic/doctors/dr-d'], 'Dana Fox-Rivera');
	scope.stop();
	const after = gets('/collections/clinic%2Fdoctors/records/dr-d');
	refreshPages();
	await settle();
	assert.equal(gets('/collections/clinic%2Fdoctors/records/dr-d'), after, 'a disposed resolver no longer listens');
});

test('the notice draws "Not reloaded" when shown, and nothing otherwise', async () => {
	assert.match(text(await render(RefreshSkippedNotice, { show: true })), /Not reloaded — this record has unsaved changes/);
	assert.equal(text(await render(RefreshSkippedNotice, { show: false })).trim(), '');
});

test('a referenced record removed on disk: after refresh the cell falls back to the reference, not the old title', async () => {
	disk.doctors['dr-e'] = 'Erin Hale';
	const p = await page('dr-e');
	assert.equal(p.doctor(), 'Erin Hale');
	delete disk.doctors['dr-e']; // a terminal `dt rm`
	refreshPages();
	await settle();
	assert.equal(p.doctor(), 'dr-e', 'the dangling reference draws its stem, as on a fresh window');
});

test('a band whose record was removed on disk drops its label on refresh', async () => {
	disk.doctors['dr-g'] = 'Gale Ito';
	const field = referenceRow('doctor', false, { collection: 'clinic/visits' });
	const scope = effectScope();
	const labels = scope.run(() =>
		useGroupLabels({ values: () => ['clinic/doctors/dr-g'], field: () => field, template: () => null, collection: () => 'clinic/visits' }),
	)!;
	labels.resolve();
	await settle();
	assert.equal(labels.labels.value['clinic/doctors/dr-g'], 'Gale Ito');
	delete disk.doctors['dr-g'];
	refreshPages();
	await settle();
	assert.equal(labels.labels.value['clinic/doctors/dr-g'], undefined, 'the band falls back to its de-slugged value');
	scope.stop();
});

test('a band read in flight across a refresh cannot write the old label back', async () => {
	disk.doctors['dr-f'] = 'Finn Old';
	hold = { id: 'dr-f' };
	const field = referenceRow('doctor', false, { collection: 'clinic/visits' });
	const scope = effectScope();
	const labels = scope.run(() =>
		useGroupLabels({ values: () => ['clinic/doctors/dr-f'], field: () => field, template: () => null, collection: () => 'clinic/visits' }),
	)!;
	labels.resolve();
	await settle();
	assert.ok(hold.release, 'the first band read is held open');
	disk.doctors['dr-f'] = 'Finn New';
	refreshPages();
	await settle();
	assert.equal(labels.labels.value['clinic/doctors/dr-f'], 'Finn New');
	hold.release!(); // the stale answer lands last
	await settle();
	assert.equal(labels.labels.value['clinic/doctors/dr-f'], 'Finn New', 'the late answer is dropped');
	scope.stop();
});
