/**
 * Render tier — THE SHELL STAYS OFF WITHOUT THE HOST FLAG. The VS Code extension never sets `window.__DT_HOST__`, so
 * App mounted with it undefined must draw none of the browser host's shell: no tab strip, no search (and Cmd/Ctrl-K does
 * nothing), no toasts, no nav (so no nav-width edge), no `dt-shell--app` class, the right panel inline rather than
 * sliding over the page, and a list's first load as the old "Loading…" body rather than skeleton rows.
 * shell-flag-on.test.ts mounts the same App with `{ nav: 'app' }` and sees each of them, so this test can tell.
 */
import './shell-flag-off.setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { all, find, hasClass, text } from './render';
import { cmdK, has, mountApp } from './shell-host';

test('with no __DT_HOST__ App draws none of the browser shell', async () => {
	assert.equal((globalThis as { window: { __DT_HOST__?: unknown } }).window.__DT_HOST__, undefined);
	const root = await mountApp();
	const shell = find(root, (n) => hasClass(n, 'dt-shell'))!;
	assert.ok(shell, 'App did not mount');
	assert.ok(!hasClass(shell, 'dt-shell--app'), 'the shell class is on');
	assert.ok(!hasClass(shell, 'dt-shell--tabs'));
	assert.ok(!has(root, 'dt-tabs'), 'a tab strip is drawn');
	assert.ok(!has(root, 'dt-nav'), 'the app nav is drawn');
	assert.equal(all(root, (n) => n.props['role'] === 'separator' && hasClass(n, 'dt-nav-resize')).length, 0, 'the nav width edge is drawn');
	assert.ok(!has(root, 'dt-toasts'), 'the toast stack is drawn');
	assert.ok(has(root, 'dt-rsb'), 'the right panel is not drawn at all');
	assert.ok(!has(root, 'dt-rsb--over'), 'the right panel slides over the page');
	await cmdK();
	assert.ok(!has(root, 'dt-search') && !has(root, 'dt-search-backdrop'), 'Cmd-K opened a search');
	assert.ok(!has(root, 'dt-skeleton'), 'the first load draws skeleton rows');
	const loading = all(root, (n) => hasClass(n, 'dt-empty__line')).map(text);
	assert.ok(loading.includes('Loading…'), `the first load does not draw the old loading body (${JSON.stringify(loading)})`);
});
