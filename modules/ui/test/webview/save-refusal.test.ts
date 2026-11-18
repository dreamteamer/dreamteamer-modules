/**
 * A SAVE THE ENGINE REFUSES SAYS SO ON THE PAGE. Edit a record, clear a required field, Save: the host
 * answers 400 with the engine's own sentence, and the record page draws that sentence in its error line,
 * stays in edit mode with the edit kept, and Save is usable again. Before, the error was thrown out of the
 * click handler and the page showed nothing. The real ContentDetail over the host stub; synthetic names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
import { HostError, onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { edits, views } from '../../src/registry/index';
import { fieldRow } from '../unit/field-rows';
import ContentDetail from '../../src/pages/ContentDetail.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, confirm: () => true };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as Record<string, unknown>)['Element'] ??= class {};
(globalThis as Record<string, unknown>)['HTMLElement'] ??= class {};

// the form stands in as a component that hands the test the `item` ContentDetail drives
let item: { setField(f: string, v: unknown): void; dirty: { value: boolean }; edits: { value: Record<string, unknown> } } | null = null;
const Form = defineComponent({ props: ['item'], setup(p) { item = p.item as never; return () => null; } });
for (const r of [edits, views]) r.register({ id: 'properties', name: 'Properties', scope: 'record', types: [], component: Form } as never);

const REFUSAL = "validation failed:\n  field (root):  must have required property 'name'\nnothing was written.";
const SOURCES = [{ name: 'northwind', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 1, via: 'own', access: 'write' }];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };

async function page(): Promise<TestNode> {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks', required: true })] }, relations: [] };
		if (path === '/info') return { name: 'northwind', modules: [] };
		if (path.startsWith('/collections/tasks/records/brief-dana')) {
			if (method === 'PATCH') throw new HostError(REFUSAL, 400);
			return { id: 'brief-dana', fields: { name: 'Brief Dana', $source: 'northwind', '$source-kind': 'own' }, path: 'data/tasks/brief-dana.task.md' };
		}
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/tasks/brief-dana');
	await r.isReady();
	const root = await render(ContentDetail, { collection: 'tasks', id: 'brief-dana', create: false }, [r]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}
const button = (root: TestNode, title: string) => all(root, (n) => n.tag === 'button' && n.props['title'] === title)[0];

test('a refused save draws the engine\'s sentence on the page, keeps the edit and stays in edit mode', async () => {
	const root = await page();
	(button(root, 'Edit')!.props['onClick'] as () => void)();
	for (let i = 0; i < 5; i++) await flush();
	assert.ok(item, 'the form received the item');
	item!.setField('name', '');
	await flush();
	await (button(root, 'Save')!.props['onClick'] as () => Promise<void>)();
	for (let i = 0; i < 5; i++) await flush();
	const line = find(root, (n) => hasClass(n, 'dt-detail-error'));
	assert.ok(line, 'no error line on the page');
	assert.match(text(line!), /must have required property 'name'/);
	assert.match(text(line!), /nothing was written/);
	assert.ok(button(root, 'Save'), 'still in edit mode');
	assert.equal(item!.edits.value['name'], '', 'the edit is kept');
	assert.ok(!button(root, 'Save')!.props['disabled'], 'Save is usable again');
});
