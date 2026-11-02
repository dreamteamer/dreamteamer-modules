/** cr-modules-008: the host's pure checks on what crosses a module frame (D5, D7, D13, D16, D17, the allow-lists). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeCellHtml, buildSnapshot, checkIntent, checkNavigate, forwardKey, createBounds, invalidationFor, deleteDialogTitles } from '../../src/modules/policy';

const scope = { module: 'lab', own: new Set(['lab/samples']), reads: new Set(['lab/samples', 'users', 'ui-views']), writes: new Map([['lab/samples', {}]]), ownViews: ['/lab/board'] };

test('cell markup keeps only the allow-listed tags and attributes', () => {
	assert.equal(sanitizeCellHtml('<span class="x" style="position:fixed" role="img" title="t" aria-label="a" onclick="x()">✓</span>'), '<span role="img" title="t" aria-label="a">✓</span>');
	assert.equal(sanitizeCellHtml('<img src=x onerror=alert(1)><a href="javascript:x">k</a><svg onload=1></svg><b>b</b>'), 'k<b>b</b>');
	assert.equal(sanitizeCellHtml('<time datetime="2026-11-02">d</time><script>x</script>'), '<time datetime="2026-11-02">d</time>');
});
test('a snapshot reshapes rows, resolves titles only inside reads, and carries no sources', () => {
	const rows = [{ id: 's1', name: 'A', owner: 'contacts/c1', $source: 'hq', '$last-commit-message': 'm' }];
	const snap = buildSnapshot({ scope, collection: 'users', rows, total: 1, pk: 'id', columns: [{ field: 'name' }], selected: new Set(), sort: { field: 'name', desc: false }, titleOf: (r: any) => r.name, titleRefs: { 'contacts/c1': 'Dana' }, sources: [{ name: 'hq' }] });
	assert.equal(snap.items[0]['$last-commit-message'], undefined);
	assert.equal((snap as any).sources, undefined);
	assert.deepEqual(snap.titles, { s1: 'A' });
	assert.deepEqual(snap.refTitles, {}, 'contacts is not in reads');
	assert.deepEqual(snap.ids, ['s1']);
});
test('intents carry ids the host posted; selection only where writes are granted; no write intent', () => {
	const posted = new Set(['s1', 's2']);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'openRecord', ['s1']).ok, true);
	assert.match(checkIntent(scope, 'lab/samples', posted, 'openRecord', ['+?prefill={}']).error!, /cannot openRecord/);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'toggleSelect', ['s2']).ok, true);
	assert.equal(checkIntent(scope, 'users', posted, 'toggleSelect', ['s2']).ok, false);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'deleteSelected', []).ok, false);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'createRecord', []).ok, false);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'setSort', ['name'], ['name']).ok, true);
	assert.equal(checkIntent(scope, 'lab/samples', posted, 'setSort', ['nope'], ['name']).ok, false);
});
test('navigate: own app and own views with query; read collections without query; nothing else', () => {
	assert.deepEqual(checkNavigate(scope, '/a/lab/board?x=1'), { ok: true, to: '/a/lab/board?x=1' });
	assert.deepEqual(checkNavigate(scope, '/lab/board?grantee=g1'), { ok: true, to: '/lab/board?grantee=g1' });
	assert.deepEqual(checkNavigate(scope, '/content/users/u1?prefill=x'), { ok: true, to: '/content/users/u1' });
	for (const bad of ['/content/tasks/t1', '/content/lab%2Fsamples/+', '/content/lab/samples/+?prefill=1', '/settings/data-model', 'javascript:alert(1)', 'https://x.example/', '/a/other/x']) assert.equal(checkNavigate(scope, bad).ok, false, bad);
});
test('keys: only the chrome shortcuts are forwarded', () => {
	assert.equal(forwardKey({ key: 'p', metaKey: true }), true);
	assert.equal(forwardKey({ key: 'P', ctrlKey: true, shiftKey: true }), true);
	assert.equal(forwardKey({ key: 'Escape' }), true);
	for (const k of [{ key: 's', metaKey: true }, { key: 'w', metaKey: true }, { key: 'a' }, { key: 'v', metaKey: true }]) assert.equal(forwardKey(k), false, k.key);
});
test('bounds: 4 in flight, 20 intents a second, 60 writes a minute', () => {
	let now = 0; const b = createBounds(() => now);
	for (let i = 0; i < 4; i++) assert.equal(b.start(), true);
	assert.equal(b.start(), false); b.end(); assert.equal(b.start(), true);
	for (let i = 0; i < 20; i++) assert.equal(b.intent(), true);
	assert.equal(b.intent(), false); now += 1001; assert.equal(b.intent(), true);
	for (let i = 0; i < 60; i++) assert.equal(b.write(), true);
	assert.equal(b.write(), false); now += 60_001; assert.equal(b.write(), true);
});
test('invalidation reaches a frame only for collections it reads', () => {
	assert.equal(invalidationFor(scope, { scope: 'data', collections: ['tasks'] }), null);
	assert.deepEqual(invalidationFor(scope, { scope: 'data', collections: ['tasks', 'users'] }), { scope: 'data', collections: ['users'] });
	assert.deepEqual(invalidationFor(scope, { scope: 'data' }), { scope: 'data', collections: ['lab/samples', 'users', 'ui-views'] });
	assert.deepEqual(invalidationFor(scope, { scope: 'schema' }), { scope: 'schema' });
});
test('the Delete dialog lists up to ten titles, then the rest as a count', () => {
	assert.equal(deleteDialogTitles(['a', 'b']), 'a, b');
	assert.equal(deleteDialogTitles(Array.from({ length: 13 }, (_, i) => `t${i}`)), 't0, t1, t2, t3, t4, t5, t6, t7, t8, t9 and 3 more');
});
