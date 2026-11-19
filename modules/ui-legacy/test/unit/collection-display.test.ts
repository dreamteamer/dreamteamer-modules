// Tier 1 — the collection's display, read off the display contract (descriptor v2 §3.5 / §4.3): the
// record header's badge chips, the `color_by` tint a row, a card and the header share, and which
// field tints a list. Every fixture is a v2 contract row; nothing here reads a descriptor.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	badgeChips, choiceOf, colorByFor, isReferenceField, themeColor, tintOf, tintStyle,
} from '../../src/lib/collection-display';
import type { CollectionRow } from '../../src/api/types';
import { enumRow, fieldRow, referenceRow } from './field-rows';

const ROW: CollectionRow = {
	collection: 'health/visits',
	title: 'Visits',
	nav: {},
	list: { layout: 'table' },
	record: { layout: 'page', subtitle: '{{ patient }} · {{ kind }}', badge: 'status', color_by: 'kind' },
	form: { sections: [] },
	record_title: '{{ reason }}',
	record_type: 'visit',
	runtime: false,
	internal: false,
};

const KIND = enumRow('kind', [
	{ label: 'Intake', value: 'intake', icon: 'person-add', color: 'charts.blue' },
	{ label: 'Urgent', value: 'urgent', color: 'charts.red', background: 'charts.orange' },
	{ label: 'Remote', value: 'remote' },
]);
const STATUS = enumRow('status', [{ label: 'Seen', value: 'seen', icon: 'check', color: 'charts.green' }, { label: 'booked', value: 'booked' }]);
const TAGS = fieldRow('tags', { many: true });
const PATIENT = referenceRow('patient');
const FIELDS = [KIND, STATUS, TAGS, PATIENT];

describe('choiceOf', () => {
	test('finds the declared choice for a value', () => {
		assert.equal(choiceOf(KIND, 'urgent')?.label, 'Urgent');
	});
	test('a value outside the enum is not decorated by guessing', () => {
		assert.equal(choiceOf(KIND, 'walk-in'), null);
		assert.equal(choiceOf(KIND, ''), null);
		assert.equal(choiceOf(TAGS, 'x'), null, 'a field with no enum has no choices');
	});
});

describe('badgeChips', () => {
	test('the badge field\'s value as a chip, decorated by its choice', () => {
		assert.deepEqual(badgeChips(ROW, FIELDS, { status: 'seen' }), [
			{ value: 'seen', label: 'Seen', icon: 'check', color: 'charts.green' },
		]);
	});
	test('an undecorated value is a plain chip carrying the value itself', () => {
		assert.deepEqual(badgeChips(ROW, FIELDS, { status: 'arrived' }), [{ value: 'arrived', label: 'arrived' }]);
	});
	test('a many field draws one chip per value', () => {
		const row = { ...ROW, record: { ...ROW.record, badge: 'tags' } };
		assert.deepEqual(badgeChips(row, FIELDS, { tags: ['alpha', 'bravo'] }).map((c) => c.label), ['alpha', 'bravo']);
	});
	test('no badge named, or no value held: no chip', () => {
		assert.deepEqual(badgeChips({ ...ROW, record: { layout: 'page' } }, FIELDS, { status: 'seen' }), []);
		assert.deepEqual(badgeChips(ROW, FIELDS, {}), []);
		assert.deepEqual(badgeChips(ROW, FIELDS, null), []);
	});
});

describe('tintOf / tintStyle', () => {
	test('a value whose choice authored a colour tints, as theme colour ids', () => {
		assert.deepEqual(tintOf('kind', FIELDS, { kind: 'intake' }), { color: 'charts.blue' });
		assert.deepEqual(tintStyle({ color: 'charts.blue' }), {
			'--dt-tint': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))',
			'--dt-tint-bg': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))',
		});
	});
	test('a choice with a background fills with it and keeps the colour for the rail', () => {
		assert.deepEqual(tintStyle(tintOf('kind', FIELDS, { kind: 'urgent' })), {
			'--dt-tint': 'var(--vscode-charts-red, var(--dt-color-charts-red, var(--dt-unknown-color)))',
			'--dt-tint-bg': 'var(--vscode-charts-orange, var(--dt-color-charts-orange, var(--dt-unknown-color)))',
		});
	});
	test('no colour authored, a value outside the enum, or no color_by: no tint', () => {
		assert.equal(tintOf('kind', FIELDS, { kind: 'remote' }), null);
		assert.equal(tintOf('kind', FIELDS, { kind: 'walk-in' }), null);
		assert.equal(tintOf(null, FIELDS, { kind: 'intake' }), null);
		assert.equal(tintOf('nope', FIELDS, { nope: 'intake' }), null, 'a field the collection does not carry');
		assert.equal(tintStyle(null), undefined);
	});
	test('never a hex — a theme colour id becomes a var', () => {
		assert.equal(themeColor('charts.purple'), 'var(--vscode-charts-purple, var(--dt-color-charts-purple, var(--dt-unknown-color)))');
	});
});

describe('colorByFor', () => {
	test('the collection\'s record.color_by is the default', () => {
		assert.equal(colorByFor(ROW, {}), 'kind');
	});
	test('a layout\'s own color_by option wins', () => {
		assert.equal(colorByFor(ROW, { color_by: 'status' }), 'status');
	});
	test('neither: no tint', () => {
		assert.equal(colorByFor({ ...ROW, record: { layout: 'page' } }, undefined), null);
	});
});

test('isReferenceField reads the field row\'s role', () => {
	assert.equal(isReferenceField(FIELDS, 'patient'), true);
	assert.equal(isReferenceField(FIELDS, 'kind'), false);
	assert.equal(isReferenceField([{ field: 'visits', type: 'string', role: 'mirror' }], 'visits'), true);
});
