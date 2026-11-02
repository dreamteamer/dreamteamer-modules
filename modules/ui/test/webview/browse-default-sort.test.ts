/**
 * A list's built-in order is Last modified, newest first — and it is SPELLED the engine's way
 * (cr-vscode-011). The browse seeded every list with no authored sort with the host's v1 row key
 * `-last-modified`; the Sort control could not name it (it drew the raw key), the Last modified
 * column carried no indicator, and Save / Save as… wrote it into the view, which compile refuses:
 * "display.list.sort: … has no field last-modified — declare it first".
 *
 * Rendered, because Save is a gesture: the drawer's real `LayoutOptionsSection` over a real
 * `useBrowseState`, the host stubbed. The Save buttons are TELEPORTED into the drawer's title bar, so
 * they are found through the Teleport's own target (`teleportTarget` below) — the harness is not
 * changed. The collection is invented (`gadgets`); nothing is copied from any workspace.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, h, type VNode } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { find, flush, render, text, unmountAll, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { useBrowseState, type BrowseViewConfig } from '../../src/composables/browse-state';
import LayoutOptionsSection from '../../src/components/browse/LayoutOptionsSection.vue';
import { fieldRow } from '../unit/field-rows';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

afterEach(() => unmountAll());

/**
 * One invented collection per test: the browse keeps unsaved tweaks in a module-level scratch pad
 * keyed by collection, so a column added in one test would otherwise reappear in the next.
 * The engine injects `last_modified` into every collection's fields (virtual, a datetime).
 */
function fixture(collection: string) {
	const fields = [
		fieldRow('name', { collection }),
		fieldRow('status', { collection, editor_options: { choices: [{ text: 'on', value: 'on' }] } }),
		fieldRow('last_modified', { collection, type: 'datetime', kind: 'virtual', title: 'Last modified', editable: false, hidden: ['form'] }),
	];
	/** Authored columns and NO authored sort — the shape of a module-shipped collection the operator saved. */
	const row = { collection, title: collection, nav: {}, list: { layout: 'table', columns: ['name', 'status'] }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'gadget', runtime: false, internal: false };
	return { fields, row };
}

/** Every collection the tests below open — one presentation carries them all (the overview is cached). */
const COLLECTIONS = ['gadgets', 'widgets', 'sprockets', 'cogs-desc', 'cogs-asc'];

function host(): void {
	const all = COLLECTIONS.map(fixture);
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: all.map((f) => f.row), fields: Object.fromEntries(COLLECTIONS.map((c, i) => [c, all[i]!.fields])), relations: [] };
		if (path === '/info') return { modules: [], workspace_module: 'default' };
		if (method === 'GET' && path.startsWith('/collections/')) return { records: [], total: 0 };
		if (method === 'GET' && path.startsWith('/items/')) return [];
		return {};
	});
}

async function mount(collection: string, config?: BrowseViewConfig) {
	host();
	await refreshCollections();
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push(`/content/${collection}`);
	await router.isReady();
	let state: ReturnType<typeof useBrowseState> | undefined;
	const Probe = defineComponent({
		setup() {
			state = useBrowseState(collection, undefined, config);
			return () => h(LayoutOptionsSection, { state: state!, collection });
		},
	});
	const root = await render(Probe, {}, [router]);
	for (let i = 0; i < 6; i++) await flush();
	return { root, state: state! };
}

/** The node a `<Teleport>` rendered into — walked from the app's vnode tree, never from the harness. */
function teleportTarget(root: TestNode): TestNode {
	const app = (root as unknown as { __vue_app__?: { _instance?: { subTree?: VNode } } }).__vue_app__;
	const seen = new Set<unknown>();
	const walk = (v: unknown): TestNode | null => {
		if (!v || typeof v !== 'object' || seen.has(v)) return null;
		seen.add(v);
		const vnode = v as VNode & { component?: { subTree?: VNode } };
		if ((vnode.type as { __isTeleport?: boolean })?.__isTeleport && vnode.target) return vnode.target as unknown as TestNode;
		if (vnode.component?.subTree) {
			const hit = walk(vnode.component.subTree);
			if (hit) return hit;
		}
		if (Array.isArray(vnode.children)) for (const c of vnode.children) {
			const hit = walk(c);
			if (hit) return hit;
		}
		return null;
	};
	const target = walk(app?._instance?.subTree);
	assert.ok(target, 'the drawer actions were teleported somewhere this test can reach');
	return target!;
}

const byAttr = (root: TestNode, attr: string, value?: string) => find(root, (n) => attr in n.props && (value === undefined || n.props[attr] === value));
const sortControl = (root: TestNode) => find(root, (n) => n.props['aria-label'] === 'Sort');
const press = async (n: TestNode | null, what: string) => {
	assert.ok(n, `${what} is drawn`);
	(n!.props['onClick'] as () => void)();
	for (let i = 0; i < 6; i++) await flush();
};
const bodyOf = (method: string, path: string) => requests.filter((r) => r.method === method && r.path.startsWith(path)).at(-1)?.body as Record<string, any> | undefined;

test('an untouched list is sorted by Last modified, newest first — under the engine\'s name, and the panel says so', async () => {
	const { root, state } = await mount('gadgets');
	assert.equal(state.sortField.value, 'last_modified');
	assert.equal(state.sortDesc.value, true);
	assert.equal(state.sortIndicator('last_modified'), 'desc');
	assert.equal(state.snapshot().sort, '-last_modified');
	assert.match(text(sortControl(root)!), /Last modified/, 'the Sort control names the field, not a raw key');
});

test('adding the Last modified column and pressing Save writes -last_modified to the collection\'s display', async () => {
	const { root, state } = await mount('widgets');
	state.toggleColumn('last_modified'); // what the panel's "add column" picker calls
	for (let i = 0; i < 3; i++) await flush();
	const bar = teleportTarget(root);
	const save = byAttr(bar, 'data-action', 'save');
	assert.ok(save, 'Save is drawn in the drawer\'s title bar');
	assert.notEqual(save!.props['disabled'], true, 'the list is dirty, so Save is offered');
	await press(save, 'Save');
	const body = bodyOf('PATCH', '/collections/collections/records/widgets');
	assert.ok(body, 'Save wrote the collection\'s own display');
	assert.equal(body!['display.list.sort'], '-last_modified');
	assert.deepEqual(body!['display.list.columns'], ['name', 'status', 'last_modified']);
});

test('a plain Save as… on the untouched list writes a view sorted -last_modified', async () => {
	const { root } = await mount('sprockets');
	const bar = teleportTarget(root);
	await press(byAttr(bar, 'data-action', 'save-as'), 'Save as…');
	const input = find(bar, (n) => n.props['aria-label'] === 'View name');
	assert.ok(input, 'the Save as… form is open');
	(input!.props['onInput'] as (e: unknown) => void)({ target: { value: 'Recent gadgets' } });
	await flush();
	const form = byAttr(bar, 'data-save-as-form');
	(form!.props['onSubmit'] as (e: unknown) => void)({ preventDefault() {} });
	for (let i = 0; i < 6; i++) await flush();
	const body = bodyOf('POST', '/collections/ui-views/records');
	assert.ok(body, 'Save as… posted a view');
	assert.equal(body!.display.list.sort, '-last_modified');
	assert.deepEqual(body!.display.list.columns, ['name', 'status']);
});

for (const [sort, dir] of [['-last_modified', 'desc'], ['last_modified', 'asc']] as const) {
	test(`a view saying columns [name, last_modified] and sort ${sort} reopens with that column and its ${dir} indicator`, async () => {
		const { root, state } = await mount(`cogs-${dir}`, { viewId: `cogs-${dir}-recent`, columns: ['name', 'last_modified'], sort });
		assert.deepEqual(state.columns.value.map((f) => f.field), ['name', 'last_modified']);
		assert.equal(state.sortIndicator('last_modified'), dir);
		assert.equal(state.sortDesc.value, dir === 'desc');
		assert.match(text(sortControl(root)!), /Last modified/);
	});
}
