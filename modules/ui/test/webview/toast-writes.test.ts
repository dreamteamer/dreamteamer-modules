/**
 * Render tier — TOASTS FROM A REAL WRITE (cr-modules-022 follow-up; the store alone was unit-tested). The record page
 * (ContentDetail) and the toast stack (ToastHost) are mounted together over the host stub; a Save goes through the
 * real item composable, client and adapter to the host. A save the host takes shows a success toast that leaves by
 * itself; a save the host refuses shows an error toast, with the host's sentence, that stays until it is dismissed.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, h } from 'vue';
import { HostError, onHostRequest, resetHost } from './host-stub';
import { all, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { edits, views } from '../../src/registry/index';
import { fieldRow } from '../unit/field-rows';
import { TOAST_MS, dismissToast, toasts } from '../../src/lib/toasts';
import ContentDetail from '../../src/pages/ContentDetail.vue';
import ToastHost from '../../src/components/ToastHost.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, confirm: () => true };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as Record<string, unknown>)['Element'] ??= class {};
(globalThis as Record<string, unknown>)['HTMLElement'] ??= class {};
// the toast stack is a <TransitionGroup>: no durations, so a toast enters and leaves at once (render.ts holds the rest)
((globalThis as { window?: Record<string, unknown> }).window!)['getComputedStyle'] ??= () => ({});
(globalThis as Record<string, unknown>)['requestAnimationFrame'] ??= (cb: () => void) => setImmediate(cb);

let item: { setField(f: string, v: unknown): void } | null = null;
const Form = defineComponent({ props: ['item'], setup(p) { item = p.item as never; return () => null; } });
for (const r of [edits, views]) r.register({ id: 'properties', name: 'Properties', scope: 'record', types: [], component: Form } as never);

const REFUSAL = "validation failed: must have required property 'name' — nothing was written.";
const SOURCES = [{ name: 'northwind', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 1, via: 'own', access: 'write' }];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };

beforeEach(() => { unmountAll(); for (const t of [...toasts.value]) dismissToast(t.id); });

async function page(refuse: boolean): Promise<TestNode> {
	resetHost();
	invalidateContract();
	onHostRequest((method, path, body) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks', required: true })] }, relations: [] };
		if (path === '/info') return { name: 'northwind', modules: [] };
		if (path.startsWith('/collections/tasks/records/brief-dana')) {
			if (method === 'PATCH') {
				if (refuse) throw new HostError(REFUSAL, 400);
				return { id: 'brief-dana', fields: { ...(body as Record<string, unknown>), $source: 'northwind', '$source-kind': 'own' }, path: 'data/tasks/brief-dana.task.md' };
			}
			return { id: 'brief-dana', fields: { name: 'Brief Dana', $source: 'northwind', '$source-kind': 'own' }, path: 'data/tasks/brief-dana.task.md' };
		}
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/tasks/brief-dana');
	await r.isReady();
	const Shell = defineComponent({ setup: () => () => h('div', [h(ContentDetail, { collection: 'tasks', id: 'brief-dana', create: false }), h(ToastHost)]) });
	const root = await render(Shell, {}, [r]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}
const button = (root: TestNode, title: string) => all(root, (n) => n.tag === 'button' && n.props['title'] === title)[0];
const drawn = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-toast')).map((n) => ({ kind: String(n.props['class']).match(/dt-toast--(\w+)/)?.[1], role: n.props['role'], text: text(n).replace(/\s+/g, ' ').trim() }));
async function save(root: TestNode, name: string): Promise<void> {
	(button(root, 'Edit')!.props['onClick'] as () => void)();
	for (let i = 0; i < 5; i++) await flush();
	item!.setField('name', name);
	await flush();
	await (button(root, 'Save')!.props['onClick'] as () => Promise<void>)();
	for (let i = 0; i < 5; i++) await flush();
}

test('a write the host takes shows a success toast on the page, and it leaves by itself', async (t) => {
	const root = await page(false);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	await save(root, 'Brief Dana on the rollout');
	assert.deepEqual(drawn(root), [{ kind: 'success', role: 'status', text: 'Saved' }]);
	t.mock.timers.tick(TOAST_MS - 1);
	await flush();
	assert.equal(drawn(root).length, 1, 'the success toast left early');
	t.mock.timers.tick(2);
	for (let i = 0; i < 3; i++) await flush();
	assert.deepEqual(drawn(root), [], 'the success toast did not leave by itself');
});

test('a write the host refuses shows an error toast with the host\'s sentence, and it stays until dismissed', async (t) => {
	const root = await page(true);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	await save(root, '');
	const [error] = drawn(root);
	assert.equal(error?.kind, 'error');
	assert.equal(error?.role, 'alert');
	assert.match(error!.text, /The change was not saved/);
	assert.match(error!.text, /must have required property 'name'/);
	t.mock.timers.tick(TOAST_MS * 10);
	for (let i = 0; i < 3; i++) await flush();
	assert.equal(drawn(root).length, 1, 'the error toast left by itself');
	const close = all(root, (n) => hasClass(n, 'dt-toast__close'))[0]!;
	(close.props['onClick'] as () => void)();
	for (let i = 0; i < 3; i++) await flush();
	assert.deepEqual(drawn(root), [], 'dismiss did not remove the error toast');
});
