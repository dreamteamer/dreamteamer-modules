/**
 * Render tier — THE CAROUSEL SAYS WHY WHEN IT CANNOT DRAW, and reads its v2 option names.
 *
 * The component's own rule: a folder that cannot be shown says WHY under the card, because an empty
 * carousel with no reason is indistinguishable from "no screenshots". Two things sat outside that
 * rule until 0.24.18. The layout declared `folder_field` / `text_field` while descriptor v2 (§3.5.1)
 * spells them `folder` / `text` — so a descriptor written to the design was told to check its spelling
 * and the layout fell back to its default field. And a folder the host listed but no injected root
 * contained (`window.__DT_VAR_ROOTS__` is computed when the panel is created; a variable set in `.env`
 * since then renders on the host and maps to no webview uri) drew an `<img>` with no `src` and said
 * nothing at all — the one silent path left.
 *
 * The host is stubbed at `GET /folder/…`; the roots are the injected list. No DOM, no VS Code.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, hasClass, render, text, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { fieldRow } from '../unit/field-rows';
import ListCarousel from '../../webview/src/lists/ListCarousel.vue';

const ROOT = '/mnt/shared';
const w = ((globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} }) as {
	__DT_VAR_ROOTS__?: Array<{ name: string; path: string; uri: string }>;
};

/** The host's answer per record id — what `GET /folder/:collection/:id?field=…` returns. */
type FolderAnswer = { path: string | null; files: string[]; reason: string | null };

beforeEach(() => {
	resetHost();
	w.__DT_VAR_ROOTS__ = [{ name: 'SHARED', path: ROOT, uri: 'vscode-webview://x/shared' }];
});

function stubFolder(answers: Record<string, FolderAnswer>) {
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		const m = /^\/folder\/demo\/([^?]+)\?field=(.+)$/.exec(path);
		if (m) return answers[decodeURIComponent(m[1]!)] ?? { path: null, files: [], reason: 'not stubbed' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}

const RECORDS: ItemRecord[] = [{ id: '1', name: 'one', description: 'the first', summary: 'short' }];
function fakeState(options?: Record<string, unknown>, records: ItemRecord[] = RECORDS) {
	const fields = ref([fieldRow('name'), fieldRow('description'), fieldRow('summary'), fieldRow('frames'), fieldRow('screenshots_folder')]) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		columns: fields,
		fields: { visibleFields: fields, fields },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {} },
		listOptions: ref({ carousel: options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		imageField: computed(() => null),
		subtitleFields: computed(() => [] as FieldRow[]),
		selectedIds: computed(() => [] as string[]),
		hasActiveQuery: computed(() => false),
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id'] ?? ''),
		tintOf: () => undefined,
		openRecord: () => {},
		createRecord: () => {},
	};
}

const img = (root: TestNode) => find(root, (n) => hasClass(n, 'dt-carousel-img'));
const reason = (root: TestNode) => {
	const empty = find(root, (n) => hasClass(n, 'dt-carousel-empty'));
	return empty ? text(empty) : null;
};
const folderRequests = () => requests.filter((r) => r.path.startsWith('/folder/')).map((r) => r.path);

test('a folder under an injected root draws its first image through that root’s uri', async () => {
	stubFolder({ '1': { path: `${ROOT}/refs/one/screens`, files: ['00-login.png', '01-home.png'], reason: null } });
	const root = await render(ListCarousel, { state: fakeState() });
	assert.equal(img(root)?.props['src'], 'vscode-webview://x/shared/refs/one/screens/00-login.png');
	assert.equal(reason(root), null, 'nothing to explain');
	assert.match(text(root), /1 \/ 2 · 00-login\.png/);
});

test('a folder under NO injected root says so and says the fix, instead of an image with no src', async () => {
	stubFolder({ '1': { path: '/elsewhere/refs/one/screens', files: ['00-login.png'], reason: null } });
	const root = await render(ListCarousel, { state: fakeState() });
	assert.equal(img(root), null, 'no silent empty <img>');
	const why = reason(root);
	assert.ok(why, 'the card says why');
	assert.match(why!, /\/elsewhere\/refs\/one\/screens/, 'names the folder');
	assert.match(why!, /reload the window/, 'names the fix');
});

test('the host’s own reason is shown as-is', async () => {
	stubFolder({ '1': { path: null, files: [], reason: 'screenshots_folder is empty on this record' } });
	const root = await render(ListCarousel, { state: fakeState() });
	assert.equal(reason(root), 'screenshots_folder is empty on this record');
});

test('the v2 `folder` option names the field the host is asked for; blank defaults to screenshots_folder', async () => {
	stubFolder({ '1': { path: null, files: [], reason: null } });
	await render(ListCarousel, { state: fakeState({ folder: 'frames' }) });
	assert.deepEqual(folderRequests(), ['/folder/demo/1?field=frames']);
	resetHost();
	stubFolder({ '1': { path: null, files: [], reason: null } });
	await render(ListCarousel, { state: fakeState() });
	assert.deepEqual(folderRequests(), ['/folder/demo/1?field=screenshots_folder']);
});

test('the old `folder_field` spelling is NOT read — the hint names it, this layout does not honour it', async () => {
	stubFolder({ '1': { path: null, files: [], reason: null } });
	await render(ListCarousel, { state: fakeState({ folder_field: 'frames' }) });
	assert.deepEqual(folderRequests(), ['/folder/demo/1?field=screenshots_folder']);
});

test('the v2 `text` option picks the line under the title; blank is description', async () => {
	stubFolder({ '1': { path: null, files: [], reason: null } });
	const named = await render(ListCarousel, { state: fakeState({ text: 'summary' }) });
	assert.equal(text(find(named, (n) => hasClass(n, 'dt-carousel-text'))!), 'short');
	const blank = await render(ListCarousel, { state: fakeState() });
	assert.equal(text(find(blank, (n) => hasClass(n, 'dt-carousel-text'))!), 'the first');
});
