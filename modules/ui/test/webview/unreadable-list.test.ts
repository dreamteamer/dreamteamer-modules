/**
 * A list of a collection this machine cannot read (cr-vscode-019, acceptance line 1; test
 * cr-vscode-019-t1). The host answers `{ records: [], unavailable: <reason> }` (`src/record-dirs.ts`);
 * the list says so in one line, with the reason, never as an error, and offers no New record — a record
 * created there could not be written. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { find, flush, hasClass, render, text } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import { refreshCollections } from '../../webview/src/composables/collections';
import { lists } from '../../webview/src/registry/index';
import { fieldRow } from '../unit/field-rows';
import BrowseView from '../../webview/src/components/BrowseView.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
lists.register({ id: 'table', name: 'Table', component: { render: () => null } });

async function mount(collection: string, answer: Record<string, unknown>) {
	resetHost();
	invalidateContract();
	const ROW = { collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: collection, runtime: false, internal: false, sources: [] };
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { [collection]: [fieldRow('name', { collection })] }, relations: [] };
		if (path === '/info') return { name: 'my-hq', modules: [] };
		if (method === 'GET' && path.startsWith(`/collections/${collection}/records`)) return answer;
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push(`/content/${collection}`);
	await router.isReady();
	const root = await render(BrowseView, { collection }, [router]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}

test('an unreadable collection draws one line with the reason, no error and no Create', async () => {
	const root = await mount('pins', { records: [], total: 0, sources: [], unavailable: '${env:PINS_FOLDER} is declared but has no value in .env on this machine' });
	const line = find(root, (n) => hasClass(n, 'dt-browse-unavailable'));
	assert.ok(line, 'the unavailable line is drawn');
	assert.match(text(line!), /Not read on this machine/);
	assert.match(text(line!), /PINS_FOLDER/);
	assert.equal(find(root, (n) => hasClass(n, 'dt-browse-error')), null, 'no error frame');
	assert.equal(find(root, (n) => hasClass(n, 'dt-browse-create')), null, 'no Create offer');
});

test('a readable collection draws neither the line nor loses Create', async () => {
	const root = await mount('things', { records: [], total: 0, sources: [] });
	assert.equal(find(root, (n) => hasClass(n, 'dt-browse-unavailable')), null);
	assert.ok(find(root, (n) => hasClass(n, 'dt-browse-create')), 'Create is offered');
});

// Found on the live walk (2026-11-02): the header's Create was gone but the empty state of the table drew
// its own "Create record". Every list's empty-state Create must ask the same question.
test('every empty-state "Create record" is withheld while the collection is unreadable', async () => {
	const fs = await import('node:fs');
	const path = await import('node:path');
	const dir = path.join(process.cwd(), 'webview', 'src');
	const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.vue') ? [path.join(d, e.name)] : []));
	const offenders = files(dir).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => />Create record</.test(l) && !/items\.unavailable/.test(l)).map(() => path.relative(dir, f)));
	assert.deepEqual(offenders, []);
});

// Code review round 3 (c3-01): a kanban column's + is an icon button with no text, so the test above never
// saw it. Every BUTTON that starts a record — `createRecord(` or the kanban's `addTo(` — asks too.
test('every button that starts a record is withheld while the collection is unreadable', async () => {
	const fs = await import('node:fs');
	const path = await import('node:path');
	const dir = path.join(process.cwd(), 'webview', 'src');
	const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.vue') ? [path.join(d, e.name)] : []));
	const offenders: string[] = [];
	for (const f of files(dir)) {
		const src = fs.readFileSync(f, 'utf8');
		for (const m of src.matchAll(/<button\b[^>]*>/gs)) {
			const tag = m[0];
			if (!/createRecord\(|addTo\(/.test(tag)) continue;
			// the header's own + sits inside a wrapper that asks (BrowseView `dt-browse-create`)
			const before = src.slice(Math.max(0, m.index! - 400), m.index);
			if (/items\.unavailable/.test(tag) || /dt-browse-create/.test(before) && /items\.unavailable/.test(before)) continue;
			offenders.push(`${path.relative(dir, f)}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
		}
	}
	assert.deepEqual(offenders, []);
});
