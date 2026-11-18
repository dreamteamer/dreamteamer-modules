/**
 * Render tier — the mirror of shell-flag-off.test.ts: the same App, with `window.__DT_HOST__ = { nav: 'app' }` (dt web),
 * draws the browser shell — so the flag-off test is a test that can tell the two hosts apart.
 */
import './shell-flag-on.setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { all, find, hasClass } from './render';
import { cmdK, has, mountApp } from './shell-host';

test('with __DT_HOST__ = { nav: "app" } App draws the browser shell', async () => {
	const root = await mountApp();
	const shell = find(root, (n) => hasClass(n, 'dt-shell'))!;
	assert.ok(hasClass(shell, 'dt-shell--app'), 'the shell class is off');
	assert.ok(hasClass(shell, 'dt-shell--tabs'));
	assert.ok(has(root, 'dt-tabs'), 'no tab strip');
	assert.ok(has(root, 'dt-nav'), 'no app nav');
	assert.equal(all(root, (n) => n.props['role'] === 'separator' && hasClass(n, 'dt-nav-resize')).length, 1, 'no nav width edge');
	assert.ok(has(root, 'dt-toasts'), 'no toast stack');
	assert.ok(has(root, 'dt-rsb--over'), 'the right panel is inline');
	assert.ok(has(root, 'dt-skeleton'), 'the first load does not draw the skeleton body');
	await cmdK();
	assert.ok(has(root, 'dt-search'), 'Cmd-K did not open the search');
});
