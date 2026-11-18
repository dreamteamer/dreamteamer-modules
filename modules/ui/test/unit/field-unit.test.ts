/**
 * Tier 1 — a field's UNIT (descriptor v2 §3.4.2 `display.unit` / `display.unit_field`): how a number
 * reads on the record page, and what sits beside its control on the form.
 *
 * The locale is pinned to `en-US` so the expected strings are this test's, not the machine's.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { currencyCodeOf, formatWithUnit, unitSuffix } from '../../src/lib/field-unit';

const fee = { unit: 'currency', unit_field: 'currency' };
const L = 'en-US';

describe('formatWithUnit', () => {
	test('currency takes its ISO code from the SIBLING field on the same record', () => {
		assert.equal(formatWithUnit(fee, 120, { currency: 'USD' }, L), '$120.00');
		assert.equal(formatWithUnit(fee, 120, { currency: 'eur' }, L), '€120.00', 'the code is upper-cased');
		assert.equal(formatWithUnit(fee, '7.5', { currency: 'USD' }, L), '$7.50', 'a numeric string is a number');
	});

	test('currency with no code on the record is the amount alone, never a guessed currency', () => {
		assert.equal(formatWithUnit(fee, 120, {}, L), '120.00');
		assert.equal(formatWithUnit(fee, 120, { currency: 'dollars' }, L), '120.00', 'not an ISO code');
		assert.equal(formatWithUnit({ unit: 'currency' }, 120, { currency: 'USD' }, L), '120.00', 'no unit_field names none');
	});

	test('percent is the number itself, bytes are binary units, anything else is a literal suffix', () => {
		assert.equal(formatWithUnit({ unit: 'percent' }, 12.5, null, L), '12.5%');
		assert.equal(formatWithUnit({ unit: 'bytes' }, 1536, null, L), '1.50 KB');
		assert.equal(formatWithUnit({ unit: 'min' }, 45, null, L), '45 min');
		assert.equal(formatWithUnit({ unit: 'kg' }, 1200, null, L), '1,200 kg');
	});

	test('no unit, or a value that is not a number, is not formatted at all', () => {
		assert.equal(formatWithUnit({}, 120, null, L), null);
		assert.equal(formatWithUnit({ unit: 'min' }, 'soon', null, L), null);
		assert.equal(formatWithUnit({ unit: 'min' }, null, null, L), null);
		assert.equal(formatWithUnit({ unit: 'min' }, '', null, L), null);
	});
});

describe('unitSuffix — what sits beside the control', () => {
	test('the currency code while one is set, the word while it is not', () => {
		assert.equal(unitSuffix(fee, { currency: 'USD' }), 'USD');
		assert.equal(unitSuffix(fee, {}), 'currency');
		assert.equal(currencyCodeOf(fee, { currency: ' gbp ' }), 'GBP');
	});

	test('percent, bytes, a literal, and nothing for a field with no unit', () => {
		assert.equal(unitSuffix({ unit: 'percent' }, null), '%');
		assert.equal(unitSuffix({ unit: 'bytes' }, null), 'bytes');
		assert.equal(unitSuffix({ unit: 'kg' }, null), 'kg');
		assert.equal(unitSuffix({}, null), '');
	});
});
