/**
 * The RECORD PAGE draws the display contract's field answers (descriptor v2 §3.4.2, §3.5) — in BOTH
 * layouts, because the page defaults to `ItemProperties` and a `.schema/presets` record can pin
 * `ItemForm` (CLAUDE.md), so a rule honoured in one of them is invisible to half the operators.
 *
 * Every assertion is about what RENDERS, off a `/presentation` payload the host stub serves: the
 * adapter, the sections composable, the resolution chain and the Edit/View components are the real
 * code. Five answers:
 *   - SECTIONS from `form.sections`: each in its own field order, the unclaimed fields last and
 *     unnamed, the body after them all;
 *   - `editable: create`: a control on the create form, the read on the edit form;
 *   - `unit: currency` + `unit_field`: the amount in the sibling field's currency;
 *   - `direction: rtl`: on the read and on the control;
 *   - `hidden: [form]`: on the read, absent from the edit form.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ref, type Component } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, render, text, type TestNode } from './render';
import type { FieldRow } from '../../webview/src/api/types';
import type { useItem } from '../../webview/src/composables/items';
import { bodyRow, fieldRow, mirrorRow } from '../unit/field-rows';
import { edits, views } from '../../webview/src/registry/index';
import EditInput from '../../webview/src/edits/EditInput.vue';
import EditNumber from '../../webview/src/edits/EditNumber.vue';
import ViewText from '../../webview/src/views/ViewText.vue';
import ViewMarkdown from '../../webview/src/views/ViewMarkdown.vue';
import ItemForm from '../../webview/src/components/ItemForm.vue';
import ItemProperties from '../../webview/src/components/ItemProperties.vue';

// The components these fields resolve to, registered directly rather than through
// `register-defaults`, which reaches ListMap and therefore leaflet's png-referencing CSS.
edits.register({ id: 'input', name: 'Input', types: ['string'], component: EditInput });
edits.register({ id: 'input-number', name: 'Number', types: ['number'], component: EditNumber });
views.register({ id: 'text', name: 'Text', types: [], component: ViewText });
views.register({ id: 'markdown', name: 'Markdown', types: [], component: ViewMarkdown });

// This tier has no DOM; the record page's relation embed reaches BrowseView, which listens on both.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

// ---- a synthetic visit --------------------------------------------------------------------------

const C = 'clinic/visits';
const row = (name: string, over: Partial<FieldRow> = {}): FieldRow => fieldRow(name, { collection: C, ...over });

const FIELDS: FieldRow[] = [
	row('code', { editable: 'create', description: 'set once, when the visit is booked' }),
	row('reason', { direction: 'rtl', placeholder: 'why the visit' }),
	row('date', { type: 'date' }),
	row('fee', { type: 'number', unit: 'currency', unit_field: 'currency' }),
	row('currency'),
	row('front_desk_note', { hidden: ['form'] }),
	{ ...bodyRow('notes'), collection: C },
];

const SECTIONS = [
	{ title: 'Billing', fields: ['currency', 'fee'] },
	{ title: 'Visit', fields: ['date', 'reason'] },
];

const RECORD = {
	id: 'v-01',
	code: 'NW-17',
	reason: 'مراجعة',
	date: '2026-03-04',
	fee: 120,
	currency: 'USD',
	front_desk_note: 'arrived early',
	notes: 'Dana Oren, follow-up in two weeks.',
};

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return { collections: [{ collection: C, form: { sections: SECTIONS } }], fields: { [C]: FIELDS }, relations: [] };
		}
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function fakeItem(record: Record<string, unknown> | null): ReturnType<typeof useItem> {
	const editsRef = ref<Record<string, unknown>>({});
	return {
		record: ref(record),
		edits: editsRef,
		setField(field: string, value: unknown) {
			editsRef.value = { ...editsRef.value, [field]: value };
		},
	} as unknown as ReturnType<typeof useItem>;
}

// ---- the two layouts, read through one lens -----------------------------------------------------

interface Layout {
	name: string;
	component: Component;
	/** a field's whole row */
	fieldNode(root: TestNode, field: string): TestNode | null;
	/** is this row drawing a CONTROL (rather than the read)? */
	hasControl(node: TestNode): boolean;
	/** the element that carries the value's direction */
	valueBox(node: TestNode): TestNode | null;
}

const cls = (n: TestNode, name: string) => String(n.props['class'] ?? '').split(/\s+/).includes(name);

const LAYOUTS: Layout[] = [
	{
		name: 'ItemForm',
		component: ItemForm,
		fieldNode: (root, field) => find(root, (n) => cls(n, 'dt-form-field') && n.props['data-field'] === field),
		hasControl: (node) => find(node, (n) => cls(n, 'dt-form-field-control')) !== null,
		valueBox: (node) => find(node, (n) => cls(n, 'dt-form-field-view') || cls(n, 'dt-form-field-control')),
	},
	{
		name: 'ItemProperties',
		component: ItemProperties,
		fieldNode: (root, field) => find(root, (n) => cls(n, 'dt-prop') && n.props['data-field'] === field),
		hasControl: (node) => find(node, (n) => cls(n, 'dt-prop__control')) !== null,
		valueBox: (node) => find(node, (n) => cls(n, 'dt-prop__value')),
	},
];

const sectionTitles = (root: TestNode) => all(root, (n) => n.tag === 'section' && 'data-section' in n.props).map((n) => String(n.props['data-section']));
const fieldsIn = (root: TestNode, title: string) => {
	const section = find(root, (n) => n.tag === 'section' && n.props['data-section'] === title);
	return section ? all(section, (n) => typeof n.props['data-field'] === 'string').map((n) => String(n.props['data-field'])) : [];
};

for (const layout of LAYOUTS) {
	const mount = (props: { readonly?: boolean; create?: boolean; fields?: FieldRow[]; record?: Record<string, unknown> | null }) =>
		render(layout.component, {
			fields: props.fields ?? FIELDS,
			item: fakeItem(props.record === undefined ? RECORD : props.record),
			readonly: props.readonly ?? false,
			create: props.create ?? false,
		});

	test(`${layout.name}: sections from form.sections, each in its own order, the rest last and unnamed, the body after`, async () => {
		const root = await mount({ readonly: true });
		assert.deepEqual(sectionTitles(root), ['Billing', 'Visit', ''], 'authored order, then the unnamed section');
		assert.deepEqual(fieldsIn(root, 'Billing'), ['currency', 'fee'], 'the section\'s order, not field order');
		assert.deepEqual(fieldsIn(root, 'Visit'), ['date', 'reason']);
		assert.deepEqual(fieldsIn(root, ''), ['code', 'front_desk_note'], 'unclaimed fields keep field order');
		const words = text(root);
		assert.ok(words.indexOf('arrived early') < words.indexOf('Dana Oren'), 'the body comes after every section');
		assert.ok(text(root).includes('Billing'), 'a named section draws its title');
	});

	test(`${layout.name}: editable: create is a control on the create form only`, async () => {
		const fields = FIELDS.filter((f) => f.role !== 'body');
		const created = await mount({ create: true, fields, record: null });
		assert.equal(layout.hasControl(layout.fieldNode(created, 'code')!), true, 'the create form offers the control');

		const edited = await mount({ fields });
		const code = layout.fieldNode(edited, 'code')!;
		assert.equal(layout.hasControl(code), false, 'an existing record draws it read-only');
		assert.ok(text(code).includes('NW-17'), 'and still shows the value');
		assert.equal(layout.hasControl(layout.fieldNode(edited, 'reason')!), true, 'an ordinary field stays editable');
	});

	test(`${layout.name}: a currency amount reads in the sibling field's currency`, async () => {
		const root = await mount({ readonly: true });
		assert.match(text(layout.fieldNode(root, 'fee')!), /\$120\.00/);

		const edit = await mount({ fields: FIELDS.filter((f) => f.role !== 'body') });
		assert.ok(text(layout.fieldNode(edit, 'fee')!).includes('USD'), 'the control carries the code beside it');
	});

	test(`${layout.name}: direction rtl is on the read and on the control, with the placeholder`, async () => {
		const read = await mount({ readonly: true });
		assert.equal(layout.valueBox(layout.fieldNode(read, 'reason')!)?.props['dir'], 'rtl');

		const edit = await mount({ fields: FIELDS.filter((f) => f.role !== 'body') });
		const input = find(layout.fieldNode(edit, 'reason')!, (n) => n.tag === 'input');
		assert.equal(input?.props['dir'], 'rtl', 'the input itself, not only its wrapper');
		assert.equal(input?.props['placeholder'], 'why the visit');
		const plain = find(layout.fieldNode(edit, 'currency')!, (n) => n.tag === 'input');
		assert.equal(plain?.props['dir'], 'auto', 'a field with no direction keeps auto');
	});

	test(`${layout.name}: every computed value is drawn dimmed and read-only, with its reason as the tooltip — and an editable field is not`, async () => {
		// a mirror, an engine-virtual field and an authored `editable: false`, beside an ordinary field
		const fields = [
			row('reason'),
			{ ...mirrorRow('booked_by', 'visit', false), collection: C },
			row('checked_in', { kind: 'virtual', editable: false, description: 'When the desk scanned the card. Computed; never stored.' }),
			row('room', { editable: false }),
		];
		const record = { id: 'v-01', reason: 'checkup', booked_by: 'clinic/bookings/b-1', checked_in: '09:12', room: '4B' };
		const dimmed = (node: TestNode) => find(node, (n) => cls(n, 'dt-computed'));
		for (const readonly of [true, false]) {
			const root = await mount({ readonly, fields, record });
			const mode = readonly ? 'view' : 'edit';
			for (const [field, why] of [['booked_by', /Generated from visit — set that field\./], ['checked_in', /Computed; never stored/], ['room', /Read-only/]] as const) {
				const node = layout.fieldNode(root, field)!;
				assert.ok(node, `${field} is drawn (${mode})`);
				const box = dimmed(node);
				assert.ok(box, `${field} is dimmed (${mode})`);
				assert.match(String(box!.props['title'] ?? ''), why, `${field} says why (${mode})`);
				assert.equal(layout.hasControl(node), false, `${field} has no control (${mode})`);
				assert.doesNotMatch(text(node), /\(computed\)/, `${field} carries no "(computed)" label (${mode})`);
			}
			const plain = layout.fieldNode(root, 'reason')!;
			assert.equal(dimmed(plain), null, `an editable field is never dimmed (${mode})`);
			assert.equal(layout.hasControl(plain), !readonly, `and has its control in edit mode only (${mode})`);
		}
	});

	test(`${layout.name}: hidden: [form] is drawn on the read and absent from the edit form`, async () => {
		const read = await mount({ readonly: true });
		assert.ok(layout.fieldNode(read, 'front_desk_note'), 'the record read draws it');

		const edit = await mount({ fields: FIELDS.filter((f) => f.role !== 'body') });
		assert.equal(layout.fieldNode(edit, 'front_desk_note'), null, 'the form does not');
		assert.ok(layout.fieldNode(edit, 'reason'), 'while its neighbours are there');
	});
}
