// Tier 1 — file-codec records in the app: which reference points at one, and where its bytes are.
//
// ⚠ THE TRAP THIS PINS: a collection name can contain a slash and so can an id, so
// `family/health/documents/2026/mri` splits ONLY against the declared list of file collections —
// never at the first slash, and never at the last. Same rule as `parseRef` (see CLAUDE.md), applied
// to a list the host injects rather than to the namespace list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileRecordRef, isImageExt, srcForRecord } from '../../src/lib/file-record';

const BASES = [
	// longest path first, as the host sorts them
	{ collection: 'family/health/documents', path: 'data/family/health/documents', suffix: 'doc', uri: 'https://wv/h' },
	{ collection: 'assets', path: 'data/assets', suffix: 'asset', uri: 'https://wv/a' },
];

describe('fileRecordRef', () => {
	test('splits a reference at the end of a declared file collection', () => {
		assert.deepEqual(fileRecordRef('assets/logos/monday', BASES), { collection: 'assets', id: 'logos/monday' });
	});

	test('a namespaced collection splits at its full name, not the first slash', () => {
		assert.deepEqual(fileRecordRef('family/health/documents/2026/mri', BASES),
			{ collection: 'family/health/documents', id: '2026/mri' });
	});

	test('a reference to a NON-file collection is not one of ours', () => {
		assert.equal(fileRecordRef('companies/monday', BASES), null);
		assert.equal(fileRecordRef('assetsx/logos/monday', BASES), null, 'prefix must end at a slash');
		assert.equal(fileRecordRef('assets', BASES), null, 'a bare collection name is not a record');
	});

	test('the wire slash the adapter adds is tolerated, and non-strings are not refs', () => {
		assert.deepEqual(fileRecordRef('/assets/logos/monday', BASES), { collection: 'assets', id: 'logos/monday' });
		assert.equal(fileRecordRef(42, BASES), null);
		assert.equal(fileRecordRef(null, BASES), null);
		assert.equal(fileRecordRef('', BASES), null);
	});

	test('with no file collections declared, nothing is a file reference', () => {
		assert.equal(fileRecordRef('assets/logos/monday', []), null);
	});
});

describe('isImageExt', () => {
	test('what an <img> can draw, and what falls back to a link', () => {
		for (const e of ['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'SVG']) assert.equal(isImageExt(e), true, e);
		for (const e of ['pdf', 'csv', 'md', '', undefined]) assert.equal(isImageExt(e), false, String(e));
	});
});

// ⚠ The src is built from id + suffix + the record's DERIVED ext — never from the item response's
// `$path`, which is the synthetic `collection/id` the adapter stamps on every record. Building on
// that silently produced null and left every logo a text label.
describe('srcForRecord', () => {
	test('a record becomes <root>/<id>.<suffix>.<ext>', () => {
		assert.equal(srcForRecord('assets', 'logos/monday', 'svg', BASES), 'https://wv/a/logos/monday.asset.svg');
		assert.equal(srcForRecord('family/health/documents', '2026/mri', 'png', BASES), 'https://wv/h/2026/mri.doc.png');
	});

	test('no ext, an unknown collection, or a base without a URI yields nothing to draw', () => {
		assert.equal(srcForRecord('assets', 'logos/monday', undefined, BASES), null);
		assert.equal(srcForRecord('assets', 'logos/monday', '', BASES), null);
		assert.equal(srcForRecord('companies', 'monday', 'svg', BASES), null);
		assert.equal(srcForRecord('assets', 'logos/monday', 'svg', [{ collection: 'assets', path: 'data/assets', suffix: 'asset' }]), null);
	});

	test('segments are encoded, and the slashes between them survive', () => {
		assert.equal(srcForRecord('assets', 'images/my photo', 'png', BASES), 'https://wv/a/images/my%20photo.asset.png');
	});
});
