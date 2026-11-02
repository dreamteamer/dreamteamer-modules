/**
 * ONLY THE LIST ON SCREEN ASKS FOR NOTES (cr-vscode-005, code review round 1 `notes-on-every-list-read`).
 * A note costs one engine call per read (core builds a Store before it knows no binding names the
 * collection), and many readers share the records route — the Schema tab's counts, relation probes, the
 * stage map's reviews, a source filter. So the host stamps `$notes` only when a read asks (`notes=1`),
 * and only the browse list asks. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { flush, render } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { useBrowseState } from '../../src/composables/browse-state';
import { useItems } from '../../src/composables/items';
import { fieldRow } from '../unit/field-rows';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: [] };

function host() {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { modules: [] };
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return { records: [], total: 0, sources: [] };
		return {};
	});
}
const recordReads = () => requests.filter((r) => r.method === 'GET' && r.path.startsWith('/collections/tasks/records?'));
const asks = (path: string) => new URLSearchParams(path.split('?')[1]).get('notes') === '1';

test('the browse list asks the host for notes on every read of its page', async () => {
	host();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/tasks');
	await r.isReady();
	const Harness = defineComponent({ setup() { useBrowseState('tasks'); return () => null; } });
	await render(Harness, {}, [r]);
	await flush();
	const reads = recordReads();
	assert.ok(reads.length > 0, 'the list read its page');
	assert.ok(reads.every((x) => asks(x.path)), `every list read asks: ${reads.map((x) => x.path).join(' · ')}`);
});

test('a records read that did not ask for notes does not ask the host (the template picker, a count, a probe)', async () => {
	host();
	const items = useItems('tasks');
	await items.reload();
	const reads = recordReads();
	assert.ok(reads.length > 0, 'it read');
	assert.ok(reads.every((x) => !asks(x.path)), reads.map((x) => x.path).join(' · '));
});
