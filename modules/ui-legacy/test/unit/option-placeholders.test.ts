/**
 * Tier 1 — A BLANK GROUP-BY MEANS TWO DIFFERENT THINGS, AND THE CONTROL MUST SAY WHICH.
 *
 * `EditFieldSelect` used to derive its empty-state text from whether the field carried a note at
 * all — `note ? 'Auto' : '—'`. That is a heuristic standing in for a declaration, and it
 * was wrong the moment both grouping options had notes:
 *
 *   · blank `lanes_by` really IS automatic — the kanban falls back to the first field
 *     declaring choices, so a board draws columns whether or not anyone chose the axis.
 *   · blank `group_by` is NOT automatic and never was. It means no bands. The option's
 *     own note says "blank leaves the list ungrouped" — so the control read "Auto" directly above a
 *     sentence saying it was nothing of the kind.
 *
 * The fix is to declare the empty state instead of inferring it, which is what this pins: the two
 * axes must not claim the same thing, and the one that does nothing must not say "Auto".
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import '../../src/registry/register-defaults';
import { lists } from '../../src/registry/index';

const optionOf = (listId: string, field: string) => lists.get(listId)?.options?.find((o) => o.field === field);

describe('the group-by dropdowns declare what blank means', () => {
	test('the fixture is real — both axes are declared on the kanban', () => {
		assert.ok(optionOf('kanban', 'lanes_by'), 'kanban declares a column axis');
		assert.ok(optionOf('kanban', 'group_by'), 'kanban declares a row axis');
	});

	test('a blank COLUMN axis is automatic, and says so', () => {
		const placeholder = String(optionOf('kanban', 'lanes_by')?.editor_options?.['placeholder'] ?? '');
		assert.match(placeholder, /auto/i, 'blank really does fall back to the first enum field');
	});

	test('a blank ROW axis is NOT automatic and must never claim to be', () => {
		const placeholder = String(optionOf('kanban', 'group_by')?.editor_options?.['placeholder'] ?? '');
		assert.ok(placeholder, 'the row axis declares its empty state rather than inheriting a guess');
		assert.doesNotMatch(placeholder, /auto/i, 'blank means NO bands — saying "Auto" contradicts the note beneath it');
	});

	test('and the two axes do not read identically', () => {
		const cols = String(optionOf('kanban', 'lanes_by')?.editor_options?.['placeholder'] ?? '');
		const rows = String(optionOf('kanban', 'group_by')?.editor_options?.['placeholder'] ?? '');
		assert.notEqual(cols, rows, 'two different behaviours cannot share one empty state');
	});

	test('the table declares the row axis too, with the same honest empty state', () => {
		const rows = String(optionOf('table', 'group_by')?.editor_options?.['placeholder'] ?? '');
		assert.doesNotMatch(rows, /auto/i);
	});
});

/**
 * The gantt adds FOUR field-selects of its own, and the rule is not a count — it is that a blank may
 * only say "Auto" when something real happens on blank. `start` falls back to the first date
 * field (exactly as the calendar's `start` does) and `bar_label` falls back to the
 * record's title, so both are automatic and both say so. `end` and `color_by` infer
 * nothing, and a placeholder claiming otherwise would promise a behaviour that does not exist.
 *
 * ⚠ Was "only `start` may say Auto" until 2026-09-08, when `bar_label` was added with a
 * genuine fallback. The count was never the rule; it just happened to be one at the time.
 */
describe('the gantt declares what each of its blanks means', () => {
	test('the fixture is real — the gantt is registered with its three field-selects', () => {
		assert.ok(lists.get('gantt'), 'a gantt layout is registered');
		for (const field of ['start', 'end', 'color_by', 'bar_label']) {
			assert.ok(optionOf('gantt', field), `gantt declares ${field}`);
		}
	});

	test('a blank START is automatic, and says so', () => {
		const placeholder = String(optionOf('gantt', 'start')?.editor_options?.['placeholder'] ?? '');
		assert.match(placeholder, /auto/i, 'blank really does fall back to the first date field');
	});

	test('a blank END is a point, not an inferred bar', () => {
		const placeholder = String(optionOf('gantt', 'end')?.editor_options?.['placeholder'] ?? '');
		assert.ok(placeholder, 'declared rather than inherited from whether the option has a note');
		assert.doesNotMatch(placeholder, /auto/i, 'nothing is inferred — a record with no end renders as a point');
	});

	// It said "None — one colour" until the collection's display grew `record.color_by` (descriptor
	// v2 §3.5): a blank option now really does fall back — to the collection's own field — so the
	// placeholder must say so on every layout that tints, or it hides the tint it is drawing.
	test('a blank COLOUR BY is the collection’s own color_by, on every layout that tints', () => {
		for (const layout of ['table', 'cards', 'kanban', 'gantt']) {
			const placeholder = String(optionOf(layout, 'color_by')?.editor_options?.['placeholder'] ?? '');
			assert.match(placeholder, /collection’s color_by/, `${layout}: ${placeholder}`);
		}
	});

	test('a blank BAR LABEL is the record title, which IS automatic — so it may say so', () => {
		// The one option added to this layout that earns the word: blank draws `titleOf(record)`, the
		// same title the gutter shows, so the bar is never silently unlabelled.
		const placeholder = String(optionOf('gantt', 'bar_label')?.editor_options?.['placeholder'] ?? '');
		assert.ok(placeholder, 'declared rather than inherited');
		assert.match(placeholder, /auto/i, 'blank really does fall back to the record title');
	});

	test('the gantt inherits the shared row axis, honest empty state and all', () => {
		const rows = String(optionOf('gantt', 'group_by')?.editor_options?.['placeholder'] ?? '');
		assert.ok(rows);
		assert.doesNotMatch(rows, /auto/i, 'blank means NO bands here too');
	});

	test('the gantt declares a page size, so a grouped gantt defaults to All', () => {
		// `lib/page-size.ts` keys the grouped-defaults-to-All rule on the literal option names, and
		// `UnknownOptionsHint` flags any option a layout does not declare — so a gantt that grouped
		// without declaring `page_size` would name a correct view as broken.
		assert.ok(optionOf('gantt', 'page_size'), 'page_size is declared');
		assert.ok(optionOf('gantt', 'show_ungrouped_rows'));
		assert.ok(optionOf('gantt', 'show_empty_rows'));
	});
});
