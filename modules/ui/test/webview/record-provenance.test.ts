/**
 * THE PROVENANCE BLOCK IS OUT OF THE WAY, AND "SOURCE" IS SAID ONCE (design 2026-10-30, Q1).
 *
 * Every official module ships `author · creation_context · source · confidence` — mostly agent-written
 * — and its `source` row ("where the INFORMATION came from") read as the same fact as the editor's own
 * mark of where the record's FILE comes from, a few rows above it. The modules now title it
 * "Information source" and file the four under a section authored `collapsed: true`, which the engine
 * after 0.39.1 carries on the display contract. Both record layouts draw it SHUT, AFTER every other
 * field (the unclaimed ones too), with its heading as the toggle; one click opens it.
 *
 * And the record page's header band carries the origin (`● project-a layer · …`), so the page has ONE
 * thing titled Source-ish rather than two — the header test is `page-header-origin.test.ts`.
 * Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { invalidateContract } from '../../webview/src/api/adapter';
import { useCollections } from '../../webview/src/composables/collections';
import { all, find, flush, render, text, unmountAll, type TestNode } from './render';
import type { FieldRow } from '../../webview/src/api/types';
import type { useItem } from '../../webview/src/composables/items';
import { fieldRow } from '../unit/field-rows';
import { edits, views } from '../../webview/src/registry/index';
import EditInput from '../../webview/src/edits/EditInput.vue';
import ViewText from '../../webview/src/views/ViewText.vue';
import ItemForm from '../../webview/src/components/ItemForm.vue';
import ItemProperties from '../../webview/src/components/ItemProperties.vue';

edits.register({ id: 'input', name: 'Input', types: ['string'], component: EditInput });
views.register({ id: 'text', name: 'Text', types: [], component: ViewText });
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const C = 'tasks';
const row = (name: string, over: Partial<FieldRow> = {}): FieldRow => fieldRow(name, { collection: C, ...over });
// field order puts the provenance quad in the MIDDLE, so "after every other field" is a real claim
const FIELDS: FieldRow[] = [
	row('name'),
	row('author'),
	row('creation_context'),
	row('source', { title: 'Information source' }),
	row('confidence'),
	row('status'),
];
const RECORD = { id: 'call-harbor', name: 'Call Harbor Mutual', author: 'agents/fixture', creation_context: 'seeded', source: 'url:https://harbor.example', confidence: 'normal', status: 'todo' };

let collapsed: boolean | undefined = true;
beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			const section = { title: 'Provenance', fields: ['author', 'creation_context', 'source', 'confidence'], ...(collapsed === undefined ? {} : { collapsed }) };
			return { collections: [{ collection: C, form: { sections: [section] } }], fields: { [C]: FIELDS }, relations: [] };
		}
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

/** Serve the contract with this `collapsed` — dropping the cached contract and the overview read off it. */
async function serve(value: boolean | undefined): Promise<void> {
	collapsed = value;
	invalidateContract();
	await useCollections().reload();
}

afterEach(unmountAll);

function fakeItem(record: Record<string, unknown>): ReturnType<typeof useItem> {
	const editsRef = ref<Record<string, unknown>>({});
	return { record: ref(record), edits: editsRef, setField() {} } as unknown as ReturnType<typeof useItem>;
}

const cls = (n: TestNode, name: string) => String(n.props['class'] ?? '').split(/\s+/).includes(name);
const drawnFields = (root: TestNode) => all(root, (n) => typeof n.props['data-field'] === 'string' && (cls(n, 'dt-prop') || cls(n, 'dt-form-field'))).map((n) => String(n.props['data-field']));
const sectionOrder = (root: TestNode) => all(root, (n) => n.tag === 'section' && 'data-section' in n.props).map((n) => String(n.props['data-section']));

for (const component of [ItemProperties, ItemForm]) {
	const name = component === ItemProperties ? 'ItemProperties' : 'ItemForm';

	test(`${name}: a collapsed Provenance section is drawn SHUT, after every other field, and opens on its heading`, async () => {
		await serve(true);
		const root = await render(component, { fields: FIELDS, item: fakeItem(RECORD), readonly: true, create: false });
		await flush();
		assert.deepEqual(sectionOrder(root), ['', 'Provenance'], 'the collapsed section comes after the unclaimed fields');
		assert.deepEqual(drawnFields(root), ['name', 'status'], 'shut: none of the four is drawn');
		const toggle = find(root, (n) => n.tag === 'button' && cls(n, 'dt-section-toggle'))!;
		assert.ok(toggle !== null, 'the heading is a toggle');
		const section = find(root, (n) => n.tag === 'section' && n.props['data-section'] === 'Provenance')!;
		assert.equal(section.props['data-collapsed'], 'shut');
		assert.ok(text(toggle).includes('Provenance'));

		(toggle.props['onClick'] as () => void)();
		await flush();
		assert.deepEqual(drawnFields(root), ['name', 'status', 'author', 'creation_context', 'source', 'confidence'], 'opened: the four, in the section\'s order');
		assert.equal(section.props['data-collapsed'], 'open');
		assert.ok(text(root).includes('Information source'), 'the provenance source row is titled "Information source"');
		assert.equal(all(root, (n) => /^Source$/.test(text(n).trim()) && (cls(n, 'dt-prop__label') || cls(n, 'dt-form-field-label'))).length, 0, 'no row is titled plain "Source"');
	});

	test(`${name}: an engine that does not carry collapsed (0.39.1 and older) draws the section open, as before`, async () => {
		await serve(undefined);
		const root = await render(component, { fields: FIELDS, item: fakeItem(RECORD), readonly: true, create: false });
		await flush();
		assert.equal(find(root, (n) => cls(n, 'dt-section-toggle')) === null, true, 'no toggle'); // never diff a node: its parent link is a cycle
		assert.ok(drawnFields(root).includes('source'), 'the four are drawn');
		assert.deepEqual(sectionOrder(root), ['Provenance', ''], 'an open named section keeps its place before the rest');
	});
}
