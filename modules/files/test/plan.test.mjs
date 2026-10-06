import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDrive, derivedOf, diffDerived } from '../src/sync.js';

const file = (p, over = {}) => ({ path: p, name: p.split('/').pop(), kind: 'file', ext: 'txt', mime: 'text/plain', bytes: 10, modified: '2026-01-01T10:00:00+00:00', local: true, abs: `/Users/someone/d/${p}`, ...over });
const folder = (p) => ({ path: p, name: p.split('/').pop(), kind: 'folder', abs: `/Users/someone/d/${p}` });
const rec = (p, over = {}) => ({ drive: 'file-drives/drive', path: p, name: p.split('/').pop(), kind: 'file', ext: 'txt', mime: 'text/plain', bytes: 10, modified: '2026-01-01T10:00:00+00:00', local: true, status: 'present', ...over });

test('first sight: everything is an add; a folder carries only the folder fields', () => {
	const plan = planDrive({ driveId: 'drive', existing: new Map(), walked: [folder('docs'), file('docs/a.txt')] });
	assert.deepEqual(plan.adds.map((a) => a.id), ['drive/docs', 'drive/docs/a.txt']);
	assert.deepEqual(plan.adds[0].next, { drive: 'file-drives/drive', path: 'docs', name: 'docs', kind: 'folder', status: 'present' });
	assert.deepEqual(plan.updates, []); assert.deepEqual(plan.missing, []); assert.deepEqual(plan.moves, []);
});

test('unchanged bytes and date: an update whose derived fields equal the record — nothing to write', () => {
	const existing = new Map([['drive/docs/a.txt', rec('docs/a.txt', { hash: 'h1', preview: '````text\nx\n````' })]]);
	const plan = planDrive({ driveId: 'drive', existing, walked: [file('docs/a.txt')] });
	assert.equal(plan.updates.length, 1);
	assert.equal(plan.updates[0].changed, false);
	assert.equal(diffDerived(existing.get('drive/docs/a.txt'), plan.updates[0].next), null);
});

test('changed bytes: hash and preview are cleared for apply to refill', () => {
	const existing = new Map([['drive/docs/a.txt', rec('docs/a.txt', { hash: 'h1', preview: 'old' })]]);
	const plan = planDrive({ driveId: 'drive', existing, walked: [file('docs/a.txt', { bytes: 11 })], hashes: new Map([['docs/a.txt', 'h2']]) });
	assert.equal(plan.updates[0].changed, true);
	assert.equal(plan.updates[0].next.hash, 'h2');
	assert.equal(plan.updates[0].next.preview, undefined);
	assert.deepEqual(diffDerived(existing.get('drive/docs/a.txt'), plan.updates[0].next), { bytes: 11, hash: 'h2', preview: '' });
});

test('a vanished path is missing; a vanished path whose hash a new file carries is a move', () => {
	const existing = new Map([
		['drive/docs/a.txt', rec('docs/a.txt', { hash: 'same' })],
		['drive/docs/b.txt', rec('docs/b.txt')],
	]);
	const plan = planDrive({ driveId: 'drive', existing, walked: [file('docs/renamed.txt')], hashes: new Map([['docs/renamed.txt', 'same']]) });
	assert.deepEqual(plan.moves.map((m) => [m.from, m.to]), [['drive/docs/a.txt', 'drive/docs/renamed.txt']]);
	assert.deepEqual(plan.adds, []);
	assert.deepEqual(plan.missing.map((m) => m.id), ['drive/docs/b.txt']);
});

test('an entry already missing is not reported missing again', () => {
	const existing = new Map([['drive/docs/gone.txt', rec('docs/gone.txt', { status: 'missing' })]]);
	assert.deepEqual(planDrive({ driveId: 'drive', existing, walked: [] }).missing, []);
});

test('diffDerived treats empty, null and absent as the same value', () => {
	assert.equal(diffDerived({ hash: '' }, { hash: undefined }), null);
	assert.equal(diffDerived({ referenced_by: [] }, {}), null);
	assert.deepEqual(diffDerived({ status: 'present' }, { status: 'missing' }), { status: 'missing' });
	assert.deepEqual(diffDerived({ referenced_by: ['a/1'] }, { referenced_by: ['a/1', 'b/2'] }), { referenced_by: ['a/1', 'b/2'] });
});

test('derivedOf a file carries exactly the file fields', () => {
	assert.deepEqual(derivedOf('drive', file('docs/a.txt')), rec('docs/a.txt'));
});
