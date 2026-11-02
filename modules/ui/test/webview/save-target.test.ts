/**
 * A NEW RECORD SAYS WHERE IT SAVES BEFORE THE SAVE (design 2026-10-30, Q3-B). Under a Sources selection
 * that leaves the write root out, the form says the record will not be in it and that the list will
 * widen to show it. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { find, flush, hasClass, render, text } from './render';
import SaveTarget from '../../src/components/SaveTarget.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/tasks/+');
	await r.isReady();
	return r;
}
// the render tier's text() joins sibling nodes with no space, so compare with whitespace removed
const squash = (s: string) => s.replace(/\s+/g, '');

test('saves to the write root, by name', async () => {
	const root = await render(SaveTarget, { root: 'my-hq', excluded: [] }, [await router()]);
	await flush();
	const p = find(root, (n) => 'data-save-target' in n.props)!;
	assert.equal(squash(text(p)), 'Savestomy-hq');
	assert.equal(hasClass(p, 'is-warning'), false);
});

test('under a selection that leaves the root out: says so before the save, and that the list will show it', async () => {
	const root = await render(SaveTarget, { root: 'my-hq', excluded: ['project-a'] }, [await router()]);
	await flush();
	const p = find(root, (n) => 'data-save-target' in n.props)!;
	assert.ok(hasClass(p, 'is-warning'));
	assert.match(squash(text(p)), /^Savestomy-hq—nottoproject-a,whichtakesnonewrecordfromhere\.Thelistwillshowmy-hqtoo/);
});
