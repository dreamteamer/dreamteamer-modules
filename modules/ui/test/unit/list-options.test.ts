/**
 * Tier 1 — UNKNOWN LAYOUT OPTIONS. The engine forwards a ui-view's `options` block opaque
 * (decision 195: it validates only what it interprets), and a List reads only the keys it knows —
 * so a key this build predates is silently ignored. `lane_by` on 0.11.2 was exactly that, and the
 * silence cost a day. The List registry already declares every option per layout; this is the
 * difference between what the view asks for and what the layout declares.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { unknownOptions, RENAMED_OPTIONS } from '../../src/lib/list-options';

const unknownOptionKeys = (o: Record<string, unknown> | undefined, d?: ReadonlyArray<{ field: string }>) => unknownOptions(o, d).map((u) => u.key);

const declared = [{ field: 'group_by' }, { field: 'lane_by' }, { field: 'card_title' }];

describe('unknownOptionKeys', () => {
	test('names the keys the layout does not declare, in the view order', () => {
		assert.deepEqual(unknownOptionKeys({ lane_by: 'lane', bogus: 1, group_by: 'status', typo_by: 'x' }, declared), ['bogus', 'typo_by']);
	});
	test('all keys declared → nothing to say', () => {
		assert.deepEqual(unknownOptionKeys({ lane_by: 'lane', card_title: '**{{ name }}**' }, declared), []);
	});
	test('no options block → nothing to say', () => {
		assert.deepEqual(unknownOptionKeys(undefined, declared), []);
		assert.deepEqual(unknownOptionKeys({}, declared), []);
	});
	test('a layout that declares no options at all → every key is unknown', () => {
		assert.deepEqual(unknownOptionKeys({ a: 1 }, undefined), ['a']);
		assert.deepEqual(unknownOptionKeys({ a: 1 }, []), ['a']);
	});
});

// Descriptor v2 renamed the layout option keys (§3.5.1). An old spelling is not read — it is NAMED,
// with the name this layout declares for it, which is the whole migration path.
describe('an old option key is named with its v2 spelling', () => {
	const kanban = [{ field: 'group_by' }, { field: 'lanes_by' }, { field: 'card_title' }, { field: 'color_by' }];

	test('every renamed key the design lists maps to its v2 name', () => {
		assert.deepEqual(RENAMED_OPTIONS, {
			color_by_field: 'color_by',
			group_rows_by_field: 'group_by',
			group_columns_by_field: 'lanes_by',
			start_field: 'start',
			end_field: 'end',
			date_field: 'start',
			lat_field: 'lat',
			lng_field: 'lng',
			template: 'card_title',
			group_template: 'group_title',
			group_summary_template: 'group_summary',
			folder_field: 'folder',
			text_field: 'text',
			image_field: 'image',
			bar_label_field: 'bar_label',
			group_icon_field: 'group_icon',
		});
	});

	// The five that were left behind: the carousel, the cards and the gantt kept their `_field`
	// spellings after the design's table was applied, so a descriptor written to §3.5.1 — `folder:
	// screenshots_folder` — was told to check its spelling. Each old name is offered its new one.
	test('the carousel\'s folder and text', () => {
		const carousel = [{ field: 'folder' }, { field: 'text' }];
		assert.deepEqual(unknownOptions({ folder_field: 'frames', text_field: 'summary' }, carousel), [
			{ key: 'folder_field', renamedTo: 'folder' },
			{ key: 'text_field', renamedTo: 'text' },
		]);
		assert.deepEqual(unknownOptions({ folder: 'frames', text: 'summary' }, carousel), [], 'the v2 spelling is simply known');
	});
	test('the cards\' image', () => {
		const cards = [{ field: 'card_title' }, { field: 'image' }, { field: 'image_fit' }];
		assert.deepEqual(unknownOptions({ image_field: 'cover' }, cards), [{ key: 'image_field', renamedTo: 'image' }]);
		assert.deepEqual(unknownOptions({ image: 'cover' }, cards), []);
	});
	test('the gantt\'s bar_label and group_icon', () => {
		const gantt = [{ field: 'start' }, { field: 'end' }, { field: 'bar_label' }, { field: 'template' }, { field: 'group_by' }, { field: 'group_icon' }];
		assert.deepEqual(unknownOptions({ bar_label_field: 'period', group_icon_field: 'avatar' }, gantt), [
			{ key: 'bar_label_field', renamedTo: 'bar_label' },
			{ key: 'group_icon_field', renamedTo: 'group_icon' },
		]);
		assert.deepEqual(unknownOptions({ bar_label: 'period', group_icon: 'avatar' }, gantt), []);
	});

	test('an old key is unknown, and carries the name to write instead', () => {
		assert.deepEqual(unknownOptions({ group_columns_by_field: 'status', template: '{{ name }}', color_by_field: 'kind' }, kanban), [
			{ key: 'group_columns_by_field', renamedTo: 'lanes_by' },
			{ key: 'template', renamedTo: 'card_title' },
			{ key: 'color_by_field', renamedTo: 'color_by' },
		]);
	});

	test('a rename is offered only where the layout declares the new name', () => {
		assert.deepEqual(unknownOptions({ lat_field: 'y' }, kanban), [{ key: 'lat_field' }], 'the kanban has no `lat`');
	});

	test('a key the layout still declares under its old spelling is not unknown at all', () => {
		assert.deepEqual(unknownOptions({ template: '{{ name }}' }, [{ field: 'template' }]), [], 'the gantt\'s bar label is still `template`');
	});
});
