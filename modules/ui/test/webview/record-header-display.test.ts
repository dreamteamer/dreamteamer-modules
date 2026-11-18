/**
 * The record header's display line — subtitle, badge, color_by — RENDERED from the display contract
 * (descriptor v2, §3.5 / §4.3).
 *
 * Tier 1 (`collection-display.test.ts`, `record-titles.test.ts`) pins each decision; this pins that
 * the header actually DRAWS them, over the real adapter and the real reference resolver: a subtitle
 * whose `{{ patient }}` reads as the patient's name once the host answers, a badge chip carrying its
 * choice's label, glyph and colour, and the header tinted by the `color_by` value's colour.
 *
 * Every fixture is a v2 contract row, invented here with the synthetic cast.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import type { CollectionRow, FieldRow } from '../../src/api/types';
import { enumRow, fieldRow, referenceRow } from '../unit/field-rows';
import RecordHeaderDisplay from '../../src/components/RecordHeaderDisplay.vue';

const row = (collection: string, record: CollectionRow['record'], record_title: string): CollectionRow => ({
	collection,
	title: collection,
	nav: {},
	list: { layout: 'table' },
	record,
	form: { sections: [] },
	record_title,
	record_type: collection,
	runtime: false,
	internal: false,
});

const VISITS = row('health/visits', { layout: 'page', subtitle: '{{ patient }} · {{ kind }}', badge: 'status', color_by: 'kind' }, '{{ reason }}');
const PATIENTS = row('health/patients', { layout: 'page' }, '{{ name }}');

const FIELDS: FieldRow[] = [
	fieldRow('reason', { collection: 'health/visits' }),
	referenceRow('patient', false, { collection: 'health/visits' }),
	enumRow('kind', [{ label: 'Intake', value: 'intake', icon: 'person-add', color: 'charts.blue' }], { collection: 'health/visits' }),
	enumRow('status', [{ label: 'Seen', value: 'seen', icon: 'check', color: 'charts.green' }], { collection: 'health/visits' }),
];

const RECORD = { id: '2026-03-04--dana-oren', reason: 'Headache', patient: '/health/patients/dana-oren', kind: 'intake', status: 'seen' };

beforeEach(() => {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [VISITS, PATIENTS], fields: { 'health/visits': FIELDS, 'health/patients': [] }, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		if (path === '/collections/health%2Fpatients/records/dana-oren') return { id: 'dana-oren', fields: { name: 'Dana Oren' } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const display = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-record-display'));
const subtitle = (root: TestNode) => text(find(root, (n) => hasClass(n, 'dt-record-subtitle'))!);

test('the subtitle renders with the grammar, a reference reading as the target\'s record_title', async () => {
	const root = await render(RecordHeaderDisplay, { row: VISITS, fields: FIELDS, record: RECORD });
	await flush();
	assert.equal(subtitle(root), 'Dana Oren · intake', 'the patient by name, not by id');
	assert.equal(
		requests.filter((r) => r.path === '/collections/health%2Fpatients/records/dana-oren').length,
		1,
		'the target was read once, through the host',
	);
});

test('the badge is the named field drawn as a chip, decorated by its choice', async () => {
	const root = await render(RecordHeaderDisplay, { row: VISITS, fields: FIELDS, record: RECORD });
	const chips = all(root, (n) => hasClass(n, 'dt-record-badge'));
	assert.equal(chips.length, 1);
	const chip = chips[0]!;
	assert.equal(text(chip).trim(), 'Seen', "the choice's label, not the stored value");
	assert.ok(find(chip, (n) => hasClass(n, 'codicon-check')), "the choice's glyph");
	assert.ok(hasClass(chip, 'has-color'));
	assert.deepEqual(chip.props['style'], { '--dt-chip-color': 'var(--vscode-charts-green, var(--dt-color-charts-green, var(--dt-unknown-color)))' }, 'a theme colour, never a hex');
});

test('color_by tints the header with the value\'s choice colour', async () => {
	const root = await render(RecordHeaderDisplay, { row: VISITS, fields: FIELDS, record: RECORD });
	const block = display(root)!;
	assert.ok(hasClass(block, 'dt-tinted'));
	assert.deepEqual(block.props['style'], { '--dt-tint': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))', '--dt-tint-bg': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))' });
});

test('a value whose choice authored no colour leaves the header untinted', async () => {
	const root = await render(RecordHeaderDisplay, { row: VISITS, fields: FIELDS, record: { ...RECORD, kind: 'walk-in' } });
	assert.equal(hasClass(display(root)!, 'dt-tinted'), false);
});

test('a collection whose display.record names none of the three draws nothing at all', async () => {
	const root = await render(RecordHeaderDisplay, { row: PATIENTS, fields: [], record: { id: 'dana-oren', name: 'Dana Oren' } });
	assert.equal(display(root), null);
});
