/**
 * NEW RECORD ASKS WHERE IT GOES FIRST (cr-vscode-004, lines 5 and 6), rendered: the real BrowseView's +
 * opens the target choice when the list reads two or more roots a record can be added to; a pick opens
 * the create form with `?target=`; the real create page says where it saves (with the root's glyph) and
 * its save POSTs to `…/records?target=<root>` — the host half (the file landing in the layer's clone) is
 * tier 1's `layer-target.test.ts`. Narrowed to one writable root, the + skips the choice; narrowed to a
 * root that takes no new record, the choice offers the writable ones and says why. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import { refreshCollections } from '../../webview/src/composables/collections';
import { useBrowseState } from '../../webview/src/composables/browse-state';
import { edits, lists, views } from '../../webview/src/registry/index';
import { fieldRow } from '../unit/field-rows';
import BrowseView from '../../webview/src/components/BrowseView.vue';
import ContentDetail from '../../webview/src/pages/ContentDetail.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, confirm: () => true };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
// reka-ui's dropdown on the record page asks `instanceof Element`; this tier has no DOM
(globalThis as Record<string, unknown>)['Element'] ??= class {};
(globalThis as Record<string, unknown>)['HTMLElement'] ??= class {};
// The list stands in for every list's OWN create gesture — the empty state's "Create record", a kanban
// column's + — which calls `state.createRecord()` exactly as this button does.
lists.register({
	id: 'table',
	name: 'Table',
	component: defineComponent({
		props: ['state'],
		setup(props: { state: { createRecord: () => void } }) {
			return () => h('button', { type: 'button', 'data-list-create': '', onClick: () => props.state.createRecord() }, 'Create record');
		},
	}),
});
for (const r of [edits, views]) r.register({ id: 'properties', name: 'Properties', scope: 'record', types: [], component: { render: () => null } } as never);

const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit', note: 'project-b has no compiled tasks — run dt compile -w project-b' },
];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };

async function host() {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { name: 'my-hq', modules: [] };
		if (method === 'POST' && path.startsWith('/collections/tasks/records')) return { id: 'kickoff', path: 'git_modules/project-a/data/tasks/kickoff.task.md', source: 'project-a' };
		if (method === 'GET' && path.startsWith('/collections/tasks/records/kickoff')) return { id: 'kickoff', fields: { name: 'Kickoff', $source: 'project-a', '$source-kind': 'layer' }, path: 'git_modules/project-a/data/tasks/kickoff.task.md' };
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return { records: [], total: 0, sources: SOURCES };
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
}

async function at(url: string): Promise<Router> {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(url);
	await r.isReady();
	return r;
}
const settle = async () => {
	for (let i = 0; i < 10; i++) await flush();
};
const narrowed = (...names: string[]) =>
	`/content/tasks?filter=${encodeURIComponent(JSON.stringify({ logic: '_and', rules: [{ field: '$source', operator: names.length === 1 ? '_eq' : '_in', value: names.length === 1 ? names[0] : names }] }))}`;
const plus = (root: TestNode) => find(root, (n) => n.tag === 'button' && n.props['title'] === 'Create')!;
const press = async (n: TestNode) => {
	(n.props['onClick'] as () => void)();
	await settle();
};
const popover = (root: TestNode) => find(root, (n) => n.props['data-target-choice'] !== undefined);
const targetRows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-target-choice__row'));
const glyphOf = (n: TestNode) => String(find(n, (x) => hasClass(x, 'dt-source-mark__access'))?.props['class'] ?? '').match(/codicon-([a-z-]+)/)?.[1];

test('New on a list reading two writable sources opens the choice before the form — each option with its mark', async () => {
	await host();
	const router = await at('/content/tasks');
	const root = await render(BrowseView, { collection: 'tasks' }, [router]);
	await settle();
	await press(plus(root));
	assert.ok(popover(root), 'the target choice, under the +');
	assert.match(router.currentRoute.value.path, /^\/content\/tasks$/, 'and NOT the form yet');
	const rows = targetRows(root);
	assert.deepEqual(rows.map((r) => r.props['data-target']), ['my-hq', 'project-a']);
	assert.deepEqual(rows.map(glyphOf), ['edit', 'edit'], 'each with its mark and the pencil that says it writes');
	// cr-vscode-016: the paragraph is one muted '+N not offered' line, the reason on its card
	assert.equal(find(root, (n) => hasClass(n, 'dt-target-choice__hidden')), null);
	const more = find(root, (n) => hasClass(n, 'dt-target-choice__more'))!;
	assert.equal(text(more).trim(), '+1 not offered');
	(more.props['onMouseenter'] as () => void)();
	await settle();
	assert.match(text(find(root, (n) => n.props['role'] === 'tooltip')!), /project-b has no compiled tasks/);
	(more.props['onMouseleave'] as () => void)();
	await press(rows[1]!);
	assert.equal(popover(root), null, 'a pick closes it');
	assert.equal(router.currentRoute.value.path, '/content/tasks/+');
	assert.equal(router.currentRoute.value.query['target'], 'project-a');
});

test('narrowed to exactly one writable source: New skips the choice and opens the form saving there', async () => {
	await host();
	const router = await at(narrowed('project-a'));
	const root = await render(BrowseView, { collection: 'tasks' }, [router]);
	await settle();
	await press(plus(root));
	assert.equal(popover(root), null);
	assert.equal(router.currentRoute.value.path, '/content/tasks/+');
	assert.equal(router.currentRoute.value.query['target'], 'project-a');
});

test('narrowed to a source that takes no new record: the choice offers the writable roots and says why the narrowed one is not offered', async () => {
	await host();
	const router = await at(narrowed('project-b'));
	const root = await render(BrowseView, { collection: 'tasks' }, [router]);
	await settle();
	await press(plus(root));
	assert.deepEqual(targetRows(root).map((r) => r.props['data-target']), ['my-hq', 'project-a']);
	const excluded = find(root, (n) => n.props['data-excluded'] === 'project-b');
	assert.ok(excluded, 'project-b is listed as not offered');
	assert.match(text(excluded!), /dt compile -w project-b/, 'with its reason');
});

test('a kanban column\'s + (a prefill) goes through the same choice, and the prefill survives the pick', async () => {
	await host();
	const router = await at('/content/tasks');
	let state!: ReturnType<typeof useBrowseState>;
	await render(defineComponent({ setup() { state = useBrowseState('tasks'); return () => null; } }), {}, [router]);
	await settle();
	state.createRecord({ status: 'doing' });
	assert.ok(state.pendingCreate.value, 'the choice is pending');
	state.chooseTarget('my-hq');
	await settle();
	assert.equal(router.currentRoute.value.query['target'], 'my-hq');
	assert.equal(router.currentRoute.value.query['prefill'], JSON.stringify({ status: 'doing' }));
});

test('the create form says where it saves — the chosen root, with its glyph — and its save POSTs to that root', async () => {
	await host();
	const router = await at(`/content/tasks/+?target=project-a&prefill=${encodeURIComponent(JSON.stringify({ name: 'Kickoff' }))}`);
	const root = await render(ContentDetail, { collection: 'tasks', id: null, create: true }, [router]);
	await settle();
	const line = find(root, (n) => n.props['data-save-target'] !== undefined);
	assert.ok(line, 'the Saves-to line');
	assert.equal(line!.props['data-save-root'], 'project-a');
	assert.match(text(line!).replace(/\s+/g, ''), /^Savestoproject-a/);
	assert.equal(glyphOf(line!), 'edit');
	requests.length = 0;
	await press(find(root, (n) => n.tag === 'button' && n.props['title'] === 'Save')!);
	const posted = requests.find((r) => r.method === 'POST');
	assert.equal(posted?.path, '/collections/tasks/records?target=project-a', 'the save names the root');
	assert.equal(router.currentRoute.value.path, '/content/tasks/kickoff', 'and lands on the new record');
});

// review finding embedded-browse-create-goes-dead: a relation's embedded browse has no header and no +,
// but its lists' own create gestures still ask first — the choice must draw there, not be swallowed
test('an EMBEDDED browse (a relation on a record page): the list\'s own create gesture opens the choice there, and the save goes to the pick', async () => {
	await host();
	const router = await at('/content/widgets/w-01');
	const root = await render(BrowseView, { collection: 'tasks', embedded: true }, [router]);
	await settle();
	assert.equal(find(root, (n) => n.tag === 'button' && n.props['title'] === 'Create'), null, 'no header, no + — only the list\'s gesture');
	await press(find(root, (n) => n.props['data-list-create'] !== undefined)!);
	assert.ok(popover(root), 'the target choice draws inside the embedded browse');
	assert.ok(find(root, (n) => hasClass(n, 'dt-browse-target-anchor') && !!find(n, (x) => x.props['data-target-choice'] !== undefined)), 'hung from the embedded list\'s own anchor');
	assert.deepEqual(targetRows(root).map((r) => r.props['data-target']), ['my-hq', 'project-a']);
	await press(targetRows(root)[1]!);
	assert.equal(router.currentRoute.value.path, '/content/tasks/+');
	assert.equal(router.currentRoute.value.query['target'], 'project-a');
	// …and the form it opened saves there
	const form = await at(`/content/tasks/+?target=project-a&prefill=${encodeURIComponent(JSON.stringify({ name: 'Kickoff' }))}`);
	const page = await render(ContentDetail, { collection: 'tasks', id: null, create: true }, [form]);
	await settle();
	requests.length = 0;
	await press(find(page, (n) => n.tag === 'button' && n.props['title'] === 'Save')!);
	assert.equal(requests.find((r) => r.method === 'POST')?.path, '/collections/tasks/records?target=project-a');
});

// review finding target-query-naming-unknown-source: the Saves-to line and the POST must agree
for (const [asked, why] of [['project-z', /not project-z: project-z is not a source of this list/], ['project-b', /not project-b: project-b has no compiled tasks/]] as const) {
	test(`a create form opened with ?target=${asked} (${asked === 'project-z' ? 'no such source' : 'a source that takes no new record'}): dropped, said so, saved to the write root`, async () => {
		await host();
		const router = await at(`/content/tasks/+?target=${asked}&prefill=${encodeURIComponent(JSON.stringify({ name: 'Kickoff' }))}`);
		const root = await render(ContentDetail, { collection: 'tasks', id: null, create: true }, [router]);
		await settle();
		const line = find(root, (n) => n.props['data-save-target'] !== undefined)!;
		assert.equal(line.props['data-save-root'], 'my-hq', 'the line names the write root');
		assert.match(text(find(line, (n) => n.props['data-save-target-dropped'] !== undefined)!).replace(/\s+/g, ' '), why);
		requests.length = 0;
		await press(find(root, (n) => n.tag === 'button' && n.props['title'] === 'Save')!);
		assert.equal(requests.find((r) => r.method === 'POST')?.path, '/collections/tasks/records', 'and the save carries no target the host would refuse');
	});
}
