import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointersOf, referencedBy } from '../src/references.js';

test('pointersOf: the typed reference, and the ${env} string for a one-line drive', () => {
	assert.deepEqual(pointersOf({ path: '${env:DRIVE}' }, 'drive', 'docs/a.pdf'),
		['files/drive/docs/a.pdf', '${env:DRIVE}/docs/a.pdf', '${env:DRIVE}/docs/a.pdf/']);
	assert.deepEqual(pointersOf({ path: '${env:INBOXES}', index: 0 }, 'inbox', 'x.m4a'),
		['files/inbox/x.m4a'], 'a list variable is ambiguous across its lines — typed references only');
});

test('referencedBy finds pointers anywhere in a record — scalar, list, nested object', () => {
	const entries = new Map([
		['drive/docs/a.pdf', { pointers: pointersOf({ path: '${env:DRIVE}' }, 'drive', 'docs/a.pdf') }],
		['drive/docs', { pointers: pointersOf({ path: '${env:DRIVE}' }, 'drive', 'docs') }],
		['drive/docs/b.txt', { pointers: pointersOf({ path: '${env:DRIVE}' }, 'drive', 'docs/b.txt') }],
	]);
	const records = [
		{ collection: 'notes', id: 'one', fields: { attachment: '${env:DRIVE}/docs/a.pdf', folder: '${env:DRIVE}/docs/' } },
		{ collection: 'notes', id: 'two', fields: { files: ['files/drive/docs/a.pdf'], meta: { deep: { ref: 'files/drive/docs/b.txt' } } } },
		{ collection: 'notes', id: 'three', fields: { text: 'mentions ${env:DRIVE}/docs/a.pdf in prose' } },
	];
	const got = referencedBy(records, entries);
	assert.deepEqual(got.get('drive/docs/a.pdf'), ['notes/one', 'notes/two']);
	assert.deepEqual(got.get('drive/docs'), ['notes/one']);
	assert.deepEqual(got.get('drive/docs/b.txt'), ['notes/two']);
});
