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
