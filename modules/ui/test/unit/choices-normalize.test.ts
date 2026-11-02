/**
 * Tier 1 — `normalizeChoices` turns an enum's choice rows (the display contract's `{label, value,
 * description, icon, color, background}`, descriptor v2 §4.3) into the dropdown's `{text, value}`.
 *
 * The same choice rows that decorate a group header also feed every enum's select, so an enum reads
 * the same wherever it is met. Only `icon` and `color` travel: a dropdown row is not worth a fetch
 * per option (so a file-record reference falls back to a glyph), and a description belongs in a band
 * header rather than in a list of options being scanned quickly.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeChoices } from '../../src/lib/choices';

describe('normalizeChoices', () => {
	test('the contract\'s `label` is what the dropdown shows', () => {
		assert.deepEqual(normalizeChoices([{ label: 'Alpha', value: 'alpha' }, { label: 'bravo', value: 'bravo' }]), [
			{ text: 'Alpha', value: 'alpha' },
			{ text: 'bravo', value: 'bravo' },
		]);
	});

	test('a v1 `text` key is not read — a row without `label` is not a choice row', () => {
		const [choice] = normalizeChoices([{ text: 'Alpha', value: 'alpha' } as never]);
		assert.notEqual(choice?.text, 'Alpha');
	});

	test('icon and colour are carried when declared', () => {
		assert.deepEqual(normalizeChoices([{ label: 'Alpha', value: 'alpha', icon: 'rocket', color: 'charts.blue' }]), [
			{ text: 'Alpha', value: 'alpha', icon: 'rocket', color: 'charts.blue' },
		]);
	});

	test('and only those two — a description does not follow the value into a dropdown', () => {
		const [choice] = normalizeChoices([{ label: 'Alpha', value: 'alpha', description: 'the one that ships', background: 'charts.blue' }]);
		assert.deepEqual(choice, { text: 'Alpha', value: 'alpha' });
	});

	test('no choice rows is no choices at all', () => {
		for (const none of [undefined, null, []]) assert.deepEqual(normalizeChoices(none), []);
	});
});
