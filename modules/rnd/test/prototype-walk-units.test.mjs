// walk and shoot choose the screens they visit — pure, so pinned here without a browser.
import { test } from 'node:test';
import assert from 'node:assert';
import { visitable, portalsOf } from '../lib/prototype/node/walk.mjs';

const ALL = [{ key: 'home', portal: null, route: '/' }, { key: 'gp-home', portal: 'gp', route: '/gp/home' }, { key: 'bo-item', portal: 'bo', route: '/bo/item/:id' }, { key: 'bo-list', portal: 'bo', route: '/bo/list' }];
test('the product form visits its portals\' screens with parameterless routes', () => {
	const c = { portal: { from: 'product' }, products: { 'rnd/products/a': { key: 'gp' }, 'rnd/products/b': { key: 'bo' } } };
	assert.deepEqual(visitable(ALL, c).map((s) => s.key), ['gp-home', 'bo-list']);
	assert.deepEqual(visitable(ALL, c, ['bo-list']).map((s) => s.key), ['bo-list']);
});
test('a field or tag source with no map visits every screen that has a portal — never none', () => {
	const c = { portal: { from: 'tag', prefix: 'portal:' }, products: {} };
	assert.equal(portalsOf(c), null);
	assert.deepEqual(visitable(ALL, c).map((s) => s.key), ['gp-home', 'bo-list']);
	assert.deepEqual(visitable(ALL, { portal: { from: 'field', field: 'portal', map: { office: 'bo' } } }).map((s) => s.key), ['bo-list']);
});

test('the favicon a full Chromium requests unasked is browser noise, never a page error — any other failed load still is', async () => {
	const { browserNoise } = await import('../lib/prototype/node/devdep.mjs');
	const msg = (url) => ({ type: () => 'error', text: () => 'Failed to load resource: the server responded with a status of 404 (File not found)', location: () => ({ url }) });
	assert.equal(browserNoise(msg('http://127.0.0.1:64480/favicon.ico')), true);
	assert.equal(browserNoise(msg('http://127.0.0.1:64480/app/favicon.ico?v=2')), true);
	assert.equal(browserNoise(msg('http://127.0.0.1:64480/app/main.js')), false);
	assert.equal(browserNoise({ type: () => 'error', text: () => 'boom', location: () => ({}) }), false);
});
