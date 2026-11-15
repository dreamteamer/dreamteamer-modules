// cr-modules-022: the browser host's pill tabs — a route opens or focuses its tab, a list's query rides on its tab,
// and closing the open tab selects its neighbour while the others keep their place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTab, fallbackTitle, tabPath, visit, type Tab } from '../../src/lib/tabs';

test('a route opens a tab once; its query rides on the same tab', () => {
	let tabs: Tab[] = [];
	tabs = visit(tabs, '/content/tasks');
	tabs = visit(tabs, '/content/tasks/2026-11-16--call-dana');
	tabs = visit(tabs, '/content/tasks?sort=-due');
	assert.deepEqual(tabs.map((t) => t.path), ['/content/tasks', '/content/tasks/2026-11-16--call-dana']);
	assert.equal(tabs[0].route, '/content/tasks?sort=-due');
	assert.equal(tabPath('/content/rnd%2Fissues/'), '/content/rnd/issues');
	assert.equal(fallbackTitle('/content/tasks/2026-11-16--call-dana'), '2026 11 16 call dana');
});

test('closing the open middle tab selects its right neighbour; the others are untouched', () => {
	const tabs = ['/a', '/b', '/c'].reduce<Tab[]>((list, r) => visit(list, r), []);
	const { tabs: rest, next } = closeTab(tabs, '/b', '/b');
	assert.deepEqual(rest.map((t) => t.path), ['/a', '/c']);
	assert.equal(next, '/c');
	assert.equal(closeTab(tabs, '/c', '/c').next, '/b', 'the last tab falls back to its left');
	assert.equal(closeTab(tabs, '/a', '/c').next, null, 'closing a tab that is not open stays where it is');
});
