/**
 * The SOURCE PICKER (replacing 0.24.0's facet strip, operator 2026-10-29): closed it shows only the
 * selection; open it lists every source with its count under an "All sources" row. A pick writes the
 * ordinary filter — one `$source` rule — so it is proved by performing it and reading the group.
 * Rendered, because the gesture is the control and a gesture is proved by performing it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ref, type Ref } from 'vue';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { SourceEntry } from '../../webview/src/api/types';
import type { FilterGroup } from '../../webview/src/lib/filter-query';
import SourcePicker from '../../webview/src/components/browse/SourcePicker.vue';

const FACETS: SourceEntry[] = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2 },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1 },
	{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3 },
	{ name: 'project-c', kind: 'layer', repo: 'git_modules/project-c', path: 'git_modules/project-c/data/tasks', installed: false, count: 0 },
];

function fakeState(facets: SourceEntry[], group: FilterGroup = { logic: '_and', rules: [] }) {
	const filterGroup = ref(group) as Ref<FilterGroup>;
	return { state: { sourceFacets: ref(facets), filterGroup }, filterGroup };
}

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/tasks');
	await r.isReady();
	return r;
}

const trigger = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!;
const rows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-source-picker__row'));
const press = async (n: TestNode) => {
	(n.props['onClick'] as () => void)();
	await flush();
};
const marks = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-source-mark__name')).map((x) => text(x).trim());

test('closed it shows only the selection — "All sources", or the picked sources — and no list', async () => {
	const { state } = fakeState(FACETS);
	const root = await render(SourcePicker, { state }, [await router()]);
	assert.match(text(trigger(root)), /All sources/);
	assert.equal(rows(root).length, 0, 'the sources are listed only while it is open');

	const picked = fakeState(FACETS, { logic: '_and', rules: [{ id: 'r', field: '$source', operator: '_eq', value: 'project-a' }] });
	const root2 = await render(SourcePicker, { state: picked.state }, [await router()]);
	assert.deepEqual(marks(trigger(root2)), ['project-a']);
	assert.doesNotMatch(text(trigger(root2)), /All sources/);
});

test('open: All first, then each source with its count; an absent layer is greyed, with no count and nothing to pick', async () => {
	const { state } = fakeState(FACETS);
	const root = await render(SourcePicker, { state }, [await router()]);
	await press(trigger(root));
	const list = rows(root);
	assert.match(text(list[0]!), /All sources/);
	assert.equal(list[0]!.props['aria-selected'], true);
	assert.deepEqual(list.slice(1).map((n) => n.props['data-source']), ['my-hq', 'project-a', 'project-b', 'project-c']);
	assert.deepEqual(list.slice(1, 4).map((n) => text(find(n, (x) => hasClass(x, 'dt-source-picker__count'))!).trim()), ['2', '1', '3']);
	const absent = list[4]!;
	assert.equal(absent.tag, 'span', 'not a button');
	assert.match(text(absent), /not installed/);
	assert.equal(find(absent, (x) => hasClass(x, 'dt-source-picker__count')), null, 'no count for records that are not read');
});

test('a pick narrows from all, a second pick adds (one is-one-of rule, never two ANDed is-rules), All clears it', async () => {
	const { state, filterGroup } = fakeState(FACETS, { logic: '_and', rules: [{ id: 'r1', field: 'status', operator: '_eq', value: 'open' }] });
	const root = await render(SourcePicker, { state }, [await router()]);
	await press(trigger(root));
	await press(rows(root).find((n) => n.props['data-source'] === 'project-a')!);
	assert.deepEqual(filterGroup.value.rules.map((r) => [r.field, r.operator, r.value]), [['status', '_eq', 'open'], ['$source', '_eq', 'project-a']]);
	await press(rows(root).find((n) => n.props['data-source'] === 'my-hq')!);
	assert.deepEqual(filterGroup.value.rules.map((r) => [r.field, r.operator, r.value]), [['status', '_eq', 'open'], ['$source', '_in', ['project-a', 'my-hq']]]);
	// operator 2026-10-29: several names side by side overran the button — their dots and a count
	assert.match(text(trigger(root)), /2 sources/, 'the trigger says how many');
	assert.deepEqual(marks(trigger(root)), [], 'and lays no names side by side');
	assert.equal(all(trigger(root), (x) => hasClass(x, 'dt-source-picker__dot')).length, 2, 'one dot each');
	await press(rows(root).find((n) => n.props['data-source'] === 'project-b')!);
	assert.deepEqual(filterGroup.value.rules.map((r) => r.field), ['status'], 'every installed source picked IS all — no rule');
	await press(rows(root).find((n) => n.props['data-source'] === 'project-b')!);
	await press(rows(root)[0]!);
	assert.deepEqual(filterGroup.value.rules.map((r) => r.field), ['status'], 'All drops the source rule and keeps the rest');
});

// operator 2026-10-29: a module-owned list (ONE shared source) still drew 0.24.0's "shared from …" line
// while a layered collection drew the picker — the picker is the one control for both now, and with one
// source it still says "All sources" while nothing is picked (operator, same day).
test('one source there is: the closed button says "All sources", like any other', async () => {
	const org: SourceEntry[] = [{ name: 'org', kind: 'module', repo: 'git_modules/org', path: 'git_modules/org/data/clients', installed: true, count: 4 }];
	const { state } = fakeState(org);
	const root = await render(SourcePicker, { state }, [await router()]);
	assert.match(text(trigger(root)), /All sources/);
	assert.deepEqual(marks(trigger(root)), []);
});

test('one source there is: its row is ticked with All, and a click on it changes nothing', async () => {
	const org: SourceEntry[] = [{ name: 'org', kind: 'module', repo: 'git_modules/org', path: 'git_modules/org/data/clients', installed: true, count: 4 }];
	const { state, filterGroup } = fakeState(org);
	const root = await render(SourcePicker, { state }, [await router()]);
	await press(trigger(root));
	const row = rows(root).find((n) => n.props['data-source'] === 'org')!;
	assert.equal(row.props['aria-selected'], true, 'all of them IS this one');
	await press(row);
	assert.deepEqual(filterGroup.value.rules, [], 'no rule written');
	assert.match(text(trigger(root)), /All sources/);
});
