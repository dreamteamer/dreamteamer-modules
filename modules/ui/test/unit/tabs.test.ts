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

// ---- the follow-up: a cap, titles that never flicker, and the round trip a reload makes --------------------------

import { TAB_CAP, isTransit, knownTitle, restoreActive, restoreTabs, saveActive, saveTabs, seedTitle, tabs, titleTab } from '../../src/lib/tabs';

const memory = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test('at the cap, opening one more closes the least recently used tab that is not the one being opened', () => {
	let list: Tab[] = [];
	for (let i = 0; i < TAB_CAP; i++) list = visit(list, `/content/t${i}`, '', { now: 100 + i });
	assert.equal(list.length, TAB_CAP);
	list = visit(list, '/content/t0', '', { now: 500 }); // t0 used again: t1 is now the oldest
	list = visit(list, '/content/new', '', { now: 600 });
	assert.equal(list.length, TAB_CAP);
	assert.ok(!list.some((t) => t.path === '/content/t1'), 'the least recently used tab stayed');
	assert.ok(list.some((t) => t.path === '/content/t0'), 'a recently used tab was closed');
	assert.equal(list[list.length - 1]!.path, '/content/new', 'the opened tab was closed or moved');
	const tight = visit(visit([], '/a', '', { now: 1, cap: 1 }), '/b', '', { now: 2, cap: 1 });
	assert.deepEqual(tight.map((t) => t.path), ['/b'], 'a cap of one keeps the tab being opened');
});

test('a new tab takes the title it was opened with, else the last known one, else words from its path', () => {
	assert.equal(visit([], '/content/tasks/x', 'Call Dana')[0]!.title, 'Call Dana');
	assert.equal(visit([], '/content/tasks/x', '', { known: () => ({ title: 'Kept name' }) })[0]!.title, 'Kept name');
	const bare = visit([], '/content/tasks/2026-11-16--call-dana')[0]!;
	assert.equal(bare.title, '2026 11 16 call dana');
	assert.equal(bare.titled, false);
});

test('a provisional title never replaces a tab\'s name; the real one does and is remembered; a seed names an unnamed tab', () => {
	tabs.value = visit([], '/content/tasks/2026-11-16--call-dana', '', { now: 1 });
	titleTab('/content/tasks/2026-11-16--call-dana', '2026-11-16--call-dana', 'checklist', true);
	assert.equal(tabs.value[0]!.title, '2026 11 16 call dana', 'the id flashed in as the title');
	seedTitle('/content/tasks/2026-11-16--call-dana', 'Call Dana', 'checklist');
	assert.equal(tabs.value[0]!.title, 'Call Dana', 'the clicked row did not name the tab');
	titleTab('/content/tasks/2026-11-16--call-dana', '2026-11-16--call-dana', 'checklist', true);
	assert.equal(tabs.value[0]!.title, 'Call Dana', 'a provisional title replaced the name');
	titleTab('/content/tasks/2026-11-16--call-dana', 'Call Dana re: rollout', 'checklist');
	assert.equal(tabs.value[0]!.title, 'Call Dana re: rollout');
	assert.deepEqual(knownTitle('/content/tasks/2026-11-16--call-dana'), { title: 'Call Dana re: rollout', icon: 'checklist' });
	// closed and opened again: the last known title, at once
	const again = visit([], '/content/tasks/2026-11-16--call-dana', '', { known: knownTitle });
	assert.equal(again[0]!.title, 'Call Dana re: rollout');
	tabs.value = [];
});

test('the round trip a reload makes: the tabs, their titles and order, and the selected one; broken storage is none', () => {
	const s = memory();
	tabs.value = ['/content/tasks', '/content/contacts/sam-diaz', '/content/meetings'].reduce<Tab[]>((l, r, i) => visit(l, r, '', { now: i }), []);
	tabs.value = tabs.value.map((t) => (t.path === '/content/contacts/sam-diaz' ? { ...t, title: 'Sam Diaz', titled: true } : t));
	saveTabs(s);
	saveActive('/content/contacts/sam-diaz', s);
	const before = JSON.parse(JSON.stringify(tabs.value));
	tabs.value = [];
	restoreTabs(s);
	assert.deepEqual(JSON.parse(JSON.stringify(tabs.value)), before);
	assert.equal(restoreActive(s), '/content/contacts/sam-diaz');
	s.setItem('dt.tabs.v1', '{not json');
	tabs.value = [];
	restoreTabs(s);
	assert.deepEqual(tabs.value, []);
	assert.equal(restoreActive({ getItem() { throw new Error('denied'); } }), null);
	assert.equal(isTransit('/'), true);
	assert.equal(isTransit('/content/'), true);
	assert.equal(isTransit('/content/tasks'), false);
});
