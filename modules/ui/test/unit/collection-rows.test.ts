// Tier 1 — the display contract's COLLECTION rows reach every surface verbatim (descriptor v2,
// §4.3). `collectionRows` is the one hop between the engine's `presentation()` and `GET
// /collections`, and it names its keys rather than spreading them — so a key it forgets is a key no
// surface can read, however correct the surface. This pins that each of the contract's keys arrives,
// unchanged, and that nothing of the old `meta` wrapper is manufactured on the way.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRows, type PresentationCollection } from '../../src/api/collection-rows';

// One row as the engine emits it for a fully authored collection (the design's clinic sample).
const VISITS: PresentationCollection = {
	collection: 'health/visits',
	title: 'Visits',
	nav: { icon: 'pulse', order: 20, section: 'care' },
	list: { layout: 'table', columns: ['reason', 'patient', 'date'], sort: '-date', options: { page_size: 50 } },
	record: { layout: 'page', subtitle: '{{ patient }} · {{ kind }}', badge: 'status', color_by: 'kind' },
	form: { sections: [{ title: 'Visit', fields: ['reason', 'patient'] }] },
	position_field: 'position',
	record_title: '{{ reason }} · {{ date }}',
	record_type: 'visit',
	runtime: false,
	internal: false,
};

describe('collectionRows', () => {
	test('every contract key arrives unchanged, plus the two webview constants', () => {
		const [row] = collectionRows([VISITS]);
		assert.deepEqual(row, { ...VISITS, provenance: 'disk', layer: '' });
	});

	test('no v1 wrapper is manufactured on the way', () => {
		const [row] = collectionRows([VISITS]);
		for (const word of ['meta', 'schema', 'system', 'group', 'list_fields', 'sort_field', 'title_template']) {
			assert.equal(word in (row as object), false, `${word} on a collection row`);
		}
	});

	test('a collection with no hand order carries no position_field — absent, not undefined', () => {
		const { position_field: _drop, ...plain } = VISITS;
		const [row] = collectionRows([plain]);
		assert.equal('position_field' in (row as object), false);
	});

	test('the runtime and internal answers are carried as the engine gave them', () => {
		const [row] = collectionRows([{ ...VISITS, collection: 'skills', runtime: true, internal: true }]);
		assert.equal(row?.runtime, true);
		assert.equal(row?.internal, true);
	});
});
