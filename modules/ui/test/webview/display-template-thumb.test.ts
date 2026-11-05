/**
 * A display template draws a FILE-CODEC REFERENCE as the picture it is.
 *
 * `assets/avatars/ann` is a plain string and every surface rendered it as those characters — a
 * relation cell, a card, a tooltip — while the bytes sat one fetch away. The alternative route
 * (`meta.view: 'image'` on the field) is unreachable: the engine gives a descriptor no way to
 * declare a field's View, so `ViewImage` has never been selectable in this product.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { onHostRequest, resetHost } from './host-stub';
import { all, flush, hasClass, render, text, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { fieldRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import DisplayTemplate from '../../webview/src/components/render/DisplayTemplate.vue';

views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const plain = (field: string): FieldRow => fieldRow(field);
const FIELDS = [plain('name'), plain('avatar'), plain('paper')];

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		if (path.startsWith('/collections/pictures/records/avatars/')) return { id: 'avatars/ann', fields: { ext: 'png' } };
		if (path.startsWith('/collections/pictures/records/papers/')) return { id: 'papers/spec', fields: { ext: 'pdf' } };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const thumbs = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-file-thumb'));
const asText = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-file-thumb__text')).map((n) => text(n));

async function draw(template: string, record: ItemRecord, withBases = true) {
	const w = globalThis.window as { __DT_FILE_BASES__?: unknown[] };
	if (withBases) w.__DT_FILE_BASES__ = [{ collection: 'pictures', path: 'data/pictures', suffix: 'asset', uri: 'vscode-webview://x/pictures' }];
	try {
		const root = await render(DisplayTemplate, { template, record, fields: FIELDS });
		for (let i = 0; i < 10; i++) await flush();
		return root;
	} finally { delete w.__DT_FILE_BASES__; }
}

test('a token holding a file reference renders as a thumbnail, beside the prose around it', async () => {
	const root = await draw('{{ avatar }} {{ name }}', { id: '1', name: 'Ann Example', avatar: 'pictures/avatars/ann' });
	assert.equal(thumbs(root).length, 1);
	assert.equal(String(thumbs(root)[0]!.props['src']), 'vscode-webview://x/pictures/avatars/ann.asset.png');
	assert.match(text(root), /Ann Example/, 'the rest of the template is untouched');
});

test('a NON-image file record keeps its reference as text — a broken <img> is worse than a filename', async () => {
	const root = await draw('{{ paper }}', { id: '1', paper: 'pictures/papers/spec' });
	assert.equal(thumbs(root).length, 0);
	assert.deepEqual(asText(root), ['pictures/papers/spec']);
});

test('a string that resolves to no file collection is left completely alone', async () => {
	// ⚠ The decision is made against the HOST-INJECTED list, so a plain string can never be mistaken
	// for a file record. With no list injected, nothing is a file record.
	const root = await draw('{{ avatar }}', { id: '1', avatar: 'pictures/avatars/ann' }, false);
	assert.equal(thumbs(root).length, 0);
	assert.match(text(root), /pictures\/avatars\/ann/, 'it renders through its field’s own View, as before');
});
