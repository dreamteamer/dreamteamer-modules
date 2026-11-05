/**
 * The designer's SAVE, as the host sees it (descriptor v2, §3.4) — the real `useDesignerState` over
 * the real adapter, with the host answered by the render tier's stub, and the assertion on the
 * REQUESTS: what the write path sends is the contract, and a green rendering says nothing about it.
 *
 *  1. an edited field is PATCHed as a whole v2 field, built over the field as its source authored it —
 *     keys the drawer does not model ride along, and the new display key lands in `display`;
 *  2. a relation authored from the mirror side writes the KEY first (flags, on the other collection)
 *     and then the mirror (`mirror_of`), never an `x-` keyword or an `inverse` flag;
 *  3. a field's form section survives a save on both sides of the row: a field this collection's
 *     source does not declare (an overlay's) keeps the row's section, and a DEPRECATED field — whose
 *     row carries no section — keeps the one its source names;
 *  4. a list of integers, numbers, booleans, dates or datetimes keeps its element type and `many`
 *     through a save that changes only its description, placeholder or width.
 *
 * Every fixture is invented here (`patients`, `visits`, `samples`).
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ref } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { invalidateContract } from '../../webview/src/api/adapter';
import { invalidateRelations } from '../../webview/src/composables/fields';
import { useDesignerState } from '../../webview/src/composables/designer-state';
import { flush } from './render';

const row = (collection: string) => ({
	collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] },
	record_title: '{{ name }}', record_type: collection, runtime: false, internal: false,
});
const field = (name: string, over: Record<string, unknown> = {}) => ({ field: name, type: 'string', title: name, required: false, editable: true, nullable: true, ...over });

/** The scalar element types a list can hold besides string — each one a `samples` field named `<type>s`. */
const SCALAR_LISTS = ['integer', 'number', 'boolean', 'date', 'datetime'] as const;

const PRESENTATION = {
	collections: [row('patients'), row('visits'), row('samples')],
	fields: {
		patients: [field('id', { kind: 'virtual', editable: false, hidden: ['list', 'form', 'record'] }), field('name', { required: true, nullable: false, sensitive: true })],
		visits: [
			field('id', { kind: 'virtual', editable: false, hidden: ['list', 'form', 'record'] }),
			field('reason'),
			// declared by another module's overlay: on the row, absent from the visits source
			field('copay', { type: 'number', form_section: 'Billing' }),
			// deprecated: the engine's row carries no form_section for it, its source does
			field('old_fee', { type: 'number', deprecated: true }),
		],
		samples: [field('id', { kind: 'virtual', editable: false, hidden: ['list', 'form', 'record'] }), ...SCALAR_LISTS.map((t) => field(`${t}s`, { type: t, many: true }))],
	},
	relations: [],
};
/** The `patients` descriptor as its record reads — `fields` is the source, as authored. */
const PATIENTS_RECORD = { id: 'patients', fields: { name: 'patients', fields: { name: { type: 'string', required: true, sensitive: true, pattern: '^.+$' } } } };
/** The `samples` source as authored: one list per scalar element type. */
const SAMPLES_RECORD = { id: 'samples', fields: { name: 'samples', fields: Object.fromEntries(SCALAR_LISTS.map((t) => [`${t}s`, { type: t, many: true }])) } };
/** The `visits` source as authored — `copay` is not in it: an overlay declares that one. */
const VISITS_RECORD = {
	id: 'visits',
	fields: { name: 'visits', fields: { reason: { type: 'string' }, old_fee: { type: 'number', deprecated: true, display: { form_section: 'Billing' } } } },
};

beforeEach(() => {
	resetHost();
	invalidateContract();
	invalidateRelations();
	onHostRequest((method, path) => {
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (method === 'GET' && path === '/collections/collections/records/patients') return PATIENTS_RECORD;
		if (method === 'GET' && path === '/collections/collections/records/visits') return VISITS_RECORD;
		if (method === 'GET' && path === '/collections/collections/records/samples') return SAMPLES_RECORD;
		if (method !== 'GET' && path.startsWith('/fields/')) return {};
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const writes = () => requests.filter((r) => r.method !== 'GET');

test('an edited field is PATCHed whole, over the authored field, with its display key', async () => {
	const state = useDesignerState(ref('patients'));
	await state.load();
	state.update('name', { placeholder: 'as on the card' });
	const outcome = await state.save();
	await flush();
	assert.deepEqual(outcome.errors, []);
	assert.deepEqual(writes(), [{
		method: 'PATCH',
		path: '/fields/patients/name',
		body: { field: { type: 'string', required: true, sensitive: true, pattern: '^.+$', display: { placeholder: 'as on the card' } } },
	}]);
});

test('a relation kept on the other collection: the key first, as flags; then the mirror, naming it', async () => {
	const state = useDesignerState(ref('patients'));
	await state.load();
	state.add({ key: 'visits', def: { type: 'list', of: 'relation', target: '/visits', link_side: 'target', far_field: 'patient' }, implicit: false });
	const outcome = await state.save();
	assert.deepEqual(outcome.errors, []);
	assert.deepEqual(writes(), [
		{ method: 'POST', path: '/fields/visits', body: { name: 'patient', type: 'patients' } },
		{ method: 'POST', path: '/fields/patients', body: { name: 'visits', field: { type: 'visits', many: true, mirror_of: 'patient' } } },
	]);
	assert.match(outcome.notices.join(' '), /patients\.visits ↔ visits\.patient/);
});

test('a relation kept HERE: this key first, then the far mirror as flags the engine completes', async () => {
	const state = useDesignerState(ref('patients'));
	await state.load();
	state.add({ key: 'clinic_visit', def: { type: 'relation', target: '/visits', link_side: 'here', far_field: 'patient', unique: true }, implicit: false });
	await state.save();
	assert.deepEqual(writes(), [
		{ method: 'POST', path: '/fields/patients', body: { name: 'clinic_visit', field: { type: 'visits', unique: true } } },
		{ method: 'POST', path: '/fields/visits', body: { name: 'patient', type: 'patients', 'mirror-of': 'clinic_visit' } },
	]);
});

test('an overlay\'s field, absent from this source, keeps the row\'s form section through a save', async () => {
	const state = useDesignerState(ref('visits'));
	await state.load();
	assert.equal(state.fields.value.find((f) => f.key === 'copay')?.def['form_section'], 'Billing', 'staged off the row');
	state.update('copay', { placeholder: 'in the clinic\'s currency' });
	const outcome = await state.save();
	assert.deepEqual(outcome.errors, []);
	assert.deepEqual(writes(), [{
		method: 'PATCH',
		path: '/fields/visits/copay',
		body: { field: { type: 'number', display: { form_section: 'Billing', placeholder: 'in the clinic\'s currency' } } },
	}]);
});

test('a DEPRECATED field keeps the form section its source names, though its row carries none', async () => {
	const state = useDesignerState(ref('visits'));
	await state.load();
	state.update('old_fee', { description: 'Replaced by copay.' });
	const outcome = await state.save();
	assert.deepEqual(outcome.errors, []);
	assert.deepEqual(writes(), [{
		method: 'PATCH',
		path: '/fields/visits/old_fee',
		body: { field: { type: 'number', deprecated: true, display: { form_section: 'Billing' }, description: 'Replaced by copay.' } },
	}]);
});

/** The three metadata-only edits, each with the display it leaves on the written field. */
const METADATA_EDITS: [Record<string, unknown>, Record<string, unknown>][] = [
	[{ description: 'What was measured.' }, { description: 'What was measured.' }],
	[{ placeholder: 'one per line' }, { display: { placeholder: 'one per line' } }],
	[{ width: 14 }, { display: { width: 14 } }],
];

for (const t of SCALAR_LISTS) {
	test(`a list of ${t} keeps its type and many through a description, placeholder or width edit`, async () => {
		for (const [edit, written] of METADATA_EDITS) {
			requests.length = 0;
			const state = useDesignerState(ref('samples'));
			await state.load();
			state.update(`${t}s`, edit);
			const outcome = await state.save();
			assert.deepEqual(outcome.errors, []);
			assert.deepEqual(outcome.warnings ?? [], [], 'nothing unsaved');
			assert.deepEqual(writes(), [{ method: 'PATCH', path: `/fields/samples/${t}s`, body: { field: { type: t, many: true, ...written } } }], JSON.stringify(edit));
		}
	});
}
