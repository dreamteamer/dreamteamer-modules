/**
 * Acceptance line 6, through the LIVE wiring: when the app tab's schema re-read fails, refresh still
 * re-fetches the page AND writes the failure to the webview console. The live re-reads
 * (`refreshCollections`, the cached field states) catch their own errors into reactive `error` refs
 * and resolve — so a handler that only logs REJECTIONS logged nothing. A stub `refreshSchema` that
 * rejects (tier 1's `host-invalidate.test.ts`) cannot see that; only the real caches can.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { HostError, onHostRequest, resetHost } from './host-stub';
import { flush } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { useCollections } from '../../src/composables/collections';
import { useFields } from '../../src/composables/fields';
import { liveSchemaCaches } from '../../src/composables/schema-caches';
import { refreshSchema } from '../../src/lib/schema-refresh';
import { handleInvalidate } from '../../src/lib/host-invalidate';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const PRESENTATION = {
	collections: [{ collection: 'gadgets', title: 'gadgets', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'gadgets', runtime: false, internal: false }],
	fields: { gadgets: [] },
	relations: [],
};

test('a failed schema re-read is written to the console, and the page still re-fetches', async () => {
	resetHost();
	invalidateContract();
	let broken = false;
	onHostRequest((method, path) => {
		if (broken && (path === '/presentation' || path.startsWith('/fields'))) throw new HostError('descriptor mid-compile', 500);
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	// the tab booted: the overview and one collection's fields were read once, cleanly
	const collections = useCollections();
	const fields = useFields('gadgets');
	for (let i = 0; i < 4; i++) await flush();
	assert.equal(collections.error.value, null);
	assert.equal(fields.error.value, null);

	broken = true;
	const warnings: unknown[][] = [];
	let pages = 0;
	await handleInvalidate({ scope: 'schema', pages: true }, {
		loadUiViews: async () => {},
		refreshSchema: () => refreshSchema(liveSchemaCaches),
		refreshPages: () => void pages++,
		warn: (...a) => void warnings.push(a),
	});
	assert.equal(pages, 1, 'the page re-fetch still ran');
	assert.ok(warnings.length >= 1, 'the failure reached the console');
	assert.match(warnings.map((w) => w.map(String).join(' ')).join('\n'), /descriptor mid-compile/, 'with the host’s own words');
});
