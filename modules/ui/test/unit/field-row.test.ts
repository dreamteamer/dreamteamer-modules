/**
 * Tier 1 — the questions every surface asks of one field row of the display contract (descriptor v2
 * §3.4.2, §3.5, §4.3), answered once in `webview/src/lib/field-row.ts`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computedReason, drawnOn, editsAnything, formSections, hasControl, isRelationList } from '../../src/lib/field-row';
import { bodyRow, fieldRow, injected, mirrorRow, referenceRow } from './field-rows';
import { sourceFieldRow } from '../../src/lib/sources';
import { computedFieldRows } from '../../src/lib/computed-fields';

describe('hasControl — where the form offers a control', () => {
	test('`editable: create` is a control on the create form and a value everywhere else', () => {
		const code = fieldRow('code', { editable: 'create' });
		assert.equal(hasControl(code, { create: true }), true);
		assert.equal(hasControl(code, { create: false }), false);
	});

	test('`editable: false` and every `kind` are never a control, on any form', () => {
		for (const row of [fieldRow('locked', { editable: false }), injected.id(), injected.created(), injected.last_modified(), mirrorRow('visits', 'patient')]) {
			assert.equal(hasControl(row, { create: true }), false, row.field);
			assert.equal(hasControl(row, { create: false }), false, row.field);
		}
	});

	test('an ordinary field is a control on both forms', () => {
		assert.equal(hasControl(fieldRow('name'), { create: true }), true);
		assert.equal(hasControl(fieldRow('name'), { create: false }), true);
	});
});

describe('computedReason — THE rule for a value drawn dimmed and read-only', () => {
	test('a mirror says where it is set, naming the owning collection when known', () => {
		assert.equal(computedReason(mirrorRow('visits', 'patient'), { create: false, target: 'clinic/visits' }), 'Generated from clinic/visits.patient — set that field.');
		assert.equal(computedReason(mirrorRow('visits', 'patient'), { create: false }), 'Generated from patient — set that field.');
	});

	test('every engine-owned field is computed, with its own description as the reason', () => {
		const rows = [injected.created(), injected.last_modified(), fieldRow('bytes', { type: 'integer', kind: 'virtual', editable: false }), ...computedFieldRows('tasks')];
		const src = sourceFieldRow('tasks', [{ name: 'hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 1 }, { name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1 }]);
		for (const row of [...rows, src]) assert.ok(computedReason(row, { create: false }), `${row.field} is computed`);
		assert.match(computedReason(src, { create: false })!, /read from/i, '$source explains itself in its own words');
	});

	test('an authored editable: false is read-only; editable: create only after creation', () => {
		assert.match(computedReason(fieldRow('locked', { editable: false }), { create: false })!, /read-only/i);
		assert.equal(computedReason(fieldRow('code', { editable: 'create' }), { create: true }), null);
		assert.match(computedReason(fieldRow('code', { editable: 'create' }), { create: false })!, /created/);
	});

	test('a field with a control is never computed — including an authored field that happens to be called source', () => {
		assert.equal(computedReason(fieldRow('name'), { create: false }), null);
		assert.equal(computedReason(fieldRow('source', { title: 'Source', description: 'Where the information came from.' }), { create: false }), null);
		assert.equal(computedReason(bodyRow('notes'), { create: false }), null);
	});
});

describe('editsAnything — whether a record page offers Edit at all', () => {
	test("a binary record's derived ext and bytes offer nothing to edit, so the page offers no Edit", () => {
		const ext = fieldRow('ext', { kind: 'virtual', editable: false });
		const bytes = fieldRow('bytes', { type: 'integer', kind: 'virtual', editable: false });
		assert.equal(editsAnything([injected.created(), injected.last_modified(), ext, bytes]), false);
	});

	test('one ordinary field, or only the body, is enough; a create-only field is not', () => {
		assert.equal(editsAnything([injected.created(), fieldRow('name')]), true);
		assert.equal(editsAnything([bodyRow('notes')]), true);
		assert.equal(editsAnything([fieldRow('code', { editable: 'create' })]), false);
	});
});

describe('drawnOn — hidden per surface', () => {
	test('a field hidden from the form is still drawn on the record read and the list', () => {
		const created = injected.created();
		assert.equal(drawnOn(created, 'form'), false);
		assert.equal(drawnOn(created, 'record'), true);
		assert.equal(drawnOn(created, 'list'), true);
		assert.equal(drawnOn(fieldRow('name'), 'form'), true);
	});
});

describe('isRelationList', () => {
	test('a `many` key and a `many` mirror are lists; a single key and a plain list are not', () => {
		assert.equal(isRelationList(referenceRow('parts', true)), true);
		assert.equal(isRelationList(mirrorRow('visits', 'patient')), true);
		assert.equal(isRelationList(referenceRow('owner')), false);
		assert.equal(isRelationList(fieldRow('tags', { many: true })), false);
	});
});

describe('formSections — the form\'s sections', () => {
	const rows = [fieldRow('name'), fieldRow('fee'), fieldRow('date'), fieldRow('notes_short'), fieldRow('currency'), bodyRow('notes')];

	test('authored sections in order, each in its OWN field order; the rest last and unnamed; never the body', () => {
		const out = formSections(rows, [
			{ title: 'Billing', fields: ['currency', 'fee'] },
			{ title: 'Visit', fields: ['date', 'name'] },
		]);
		assert.deepEqual(out.map((s) => [s.title, s.fields.map((f) => f.field)]), [
			['Billing', ['currency', 'fee']],
			['Visit', ['date', 'name']],
			['', ['notes_short']],
		]);
	});

	test('no sections is one unnamed section of every field but the body, in field order', () => {
		assert.deepEqual(formSections(rows, []).map((s) => [s.title, s.fields.map((f) => f.field)]), [['', ['name', 'fee', 'date', 'notes_short', 'currency']]]);
	});

	test('a section whose fields are all absent here (hidden on this surface) is not drawn as an empty heading', () => {
		const out = formSections([fieldRow('name')], [{ title: 'Billing', fields: ['fee'] }]);
		assert.deepEqual(out.map((s) => s.title), ['']);
	});
});
