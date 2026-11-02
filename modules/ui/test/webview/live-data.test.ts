/**
 * AN OPEN LIST AND AN OPEN RECORD RE-READ WHEN THE WORKSPACE CHANGES — IN THE BROWSER HOST. dt web pushes
 * the extension's own `dt:invalidate` over server-sent events; a list (`useItems`) and a record (`useItem`)
 * mounted under a host that draws its own nav (`__DT_HOST__.nav === 'app'`) ask the host again on it, and a
 * record with unsaved edits is left alone. Under VS Code's host (no `__DT_HOST__`) nothing changes: no
 * second request. The real composables over the host stub; synthetic names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { flush } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { useItem, useItems } from '../../src/composables/items';

const bus = new EventTarget();
const win = globalThis as unknown as { window: Record<string, unknown> };
win.window ??= {};
Object.assign(win.window, { addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus) });
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
const invalidate = () => bus.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'dt:invalidate', scope: 'data' } }));

function host() {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (method === 'GET' && path.startsWith('/collections/tasks/records/brief-dana')) return { id: 'brief-dana', fields: { name: 'Brief Dana' } };
		if (method === 'GET' && path.startsWith('/collections/tasks/records')) return { records: [], total: 0 };
		return {};
	});
}
const reads = (prefix: string) => requests.filter((r) => r.method === 'GET' && r.path.startsWith(prefix)).length;
async function settle() { for (let i = 0; i < 6; i++) await flush(); }

for (const browserHost of [true, false]) {
	test(`${browserHost ? 'the browser host' : "VS Code's host"}: a dt:invalidate ${browserHost ? 're-reads' : 'does not re-read'} the open list and record`, async () => {
		win.window['__DT_HOST__'] = browserHost ? { nav: 'app' } : undefined;
		host();
		const scope = effectScope();
		const item = scope.run(() => { useItems('tasks'); const it = useItem('tasks', 'brief-dana'); void it.load(); return it; })!;
		await settle();
		const list0 = reads('/collections/tasks/records?') + reads('/collections/tasks/records/?');
		const rec0 = reads('/collections/tasks/records/brief-dana');
		assert.ok(list0 > 0 && rec0 > 0, `the first reads were seen: list ${list0}, record ${rec0} — ${JSON.stringify(requests.map((r) => r.path))}`);
		invalidate();
		await settle();
		const list1 = reads('/collections/tasks/records?') + reads('/collections/tasks/records/?');
		const rec1 = reads('/collections/tasks/records/brief-dana');
		assert.equal(list1 - list0, browserHost ? 1 : 0, 'list reads after the change');
		assert.equal(rec1 - rec0, browserHost ? 1 : 0, 'record reads after the change');
		if (browserHost) {
			item.setField('name', 'Brief Dana and Sam');
			invalidate();
			await settle();
			assert.equal(reads('/collections/tasks/records/brief-dana'), rec1, 'a record with unsaved edits is not re-read');
		}
		scope.stop();
		invalidate();
		await settle();
		assert.equal(reads('/collections/tasks/records/brief-dana'), rec1, 'after unmount, no listener is left');
	});
}
