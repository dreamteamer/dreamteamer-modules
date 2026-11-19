/**
 * Tier 1 — THE SETTINGS PANEL IS SECTIONS, AND THE SECTIONS HAVE TO HOLD.
 *
 * `OptionsForm` merges only CONSECUTIVE options sharing a `group`, deliberately: declaration order
 * is rendering order, so an option can never be teleported away from its neighbours by a group it
 * happens to share. The cost of that choice is a trap, and it is not hypothetical — it was hit
 * while adding these very headings, when the diagram's band axis sat in the middle of its node
 * options and drew the word "Nodes" twice with three controls in between.
 *
 * The operator's report was blunter (2026-09-10): "ui sucks for the layout — all group related
 * functionality and field names reuse". Three unheaded controls wedged between two headed sections
 * is the specific thing that reads as noise, so:
 *
 *   1. every group id used by any layout has a heading in the ONE shared map
 *   2. no group appears in two separate runs, so no heading is ever drawn twice
 *   3. no option floats unheaded between two headed ones
 *
 * ⚠ `page_size` is the ONE deliberate exception to 3: a lone trailing control whose own label says
 * everything, and a section heading over a single dropdown is the noise this file exists to stop.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import '../../src/registry/register-defaults';
import { lists, OPTION_GROUPS } from '../../src/registry/index';

const layouts = () => lists.all().filter((l) => (l.options?.length ?? 0) > 0);

describe('every layout renders its options as sections', () => {
	test('the fixture is real — several layouts declare options', () => {
		assert.ok(layouts().length >= 5, `got ${layouts().length} layouts with options`);
	});

	test('every group id used anywhere has a heading in the one shared map', () => {
		for (const layout of layouts()) {
			for (const option of layout.options ?? []) {
				if (!option.group) continue;
				assert.ok(
					OPTION_GROUPS[option.group],
					`${layout.id}.${option.field} is in group "${option.group}", which has no heading — add it to OPTION_GROUPS rather than giving the option its own label`,
				);
			}
		}
	});

	test('no group is split into two runs, so no heading is ever drawn twice', () => {
		for (const layout of layouts()) {
			const runs: Array<string | undefined> = [];
			for (const option of layout.options ?? []) {
				if (!runs.length || runs[runs.length - 1] !== option.group) runs.push(option.group);
			}
			const named = runs.filter((g): g is string => !!g);
			assert.equal(
				new Set(named).size,
				named.length,
				`${layout.id} declares a group in two separate runs (${named.join(' → ')}) — OptionsForm merges only CONSECUTIVE options, so move them together`,
			);
		}
	});

	test('nothing floats unheaded between two headed sections', () => {
		for (const layout of layouts()) {
			const options = layout.options ?? [];
			options.forEach((option, i) => {
				if (option.group || option.field === 'page_size') return;
				const before = options.slice(0, i).some((o) => o.group);
				const after = options.slice(i + 1).some((o) => o.group);
				assert.ok(
					!(before && after),
					`${layout.id}.${option.field} has no group but sits between headed sections — give it their group, or a new one with a heading`,
				);
			});
		}
	});
});

/**
 * ⚠ A TOGGLE MUST NOT LIE ABOUT THE LIVE STATE. `OptionsForm` renders
 * `modelValue[field] ?? def.default ?? null`, so a boolean option that declares NO default renders
 * as OFF until someone touches it — while the component behind it reads `options[x] !== false` and
 * behaves as ON. Both of the gantt's default-on toggles shipped that way, and it was caught in a
 * screenshot of the live panel: "Fold dead time" sat off above a chart that was visibly folded.
 *
 * Declaring the default is the whole fix, and it writes nothing to the record — `setValue` fires
 * only on a real change, so an untouched view stays untouched.
 */
describe('a boolean option declares the default it actually has', () => {
	test('every boolean option on every layout declares one', () => {
		for (const layout of layouts()) {
			for (const option of layout.options ?? []) {
				if (option.type !== 'boolean') continue;
				assert.notEqual(
					option.default,
					undefined,
					`${layout.id}.${option.field} is a boolean with no declared default — the toggle will render OFF whatever the component does with an absent value`,
				);
			}
		}
	});

	test('the two default-ON gantt toggles say so', () => {
		const of = (field: string) => lists.get('gantt')?.options?.find((o) => o.field === field);
		assert.equal(of('fold_gaps')?.default, true, 'folding is on until a view turns it off');
		assert.equal(of('start_collapsed')?.default, true, 'a grouped gantt opens with its lanes shut');
	});
});
