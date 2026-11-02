/**
 * What an app tab does with `dt:invalidate` (lib/host-invalidate.ts), and the page-refresh signal the
 * record composables listen to (lib/page-refresh.ts). The order is the point: the ui-view table and
 * the schema re-read SETTLE first, then the page re-fetches — and a schema re-read that fails must not
 * cancel the re-fetch the operator clicked for, only be logged.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInvalidate } from '../../src/lib/host-invalidate';
import { onPageRefresh, requestPageRefresh } from '../../src/lib/page-refresh';

function deps(opts: { schemaFails?: boolean } = {}) {
	const log: string[] = [];
	const warnings: unknown[][] = [];
	const later = (name: string, fail = false) => () =>
		new Promise<void>((resolve, reject) =>
			setTimeout(() => {
				log.push(`${name}:done`);
				if (fail) reject(new Error(`${name} failed`));
				else resolve();
			}, 5),
		);
	return {
		log,
		warnings,
		deps: {
			loadUiViews: later('ui'),
			refreshSchema: later('schema', opts.schemaFails),
			refreshPages: () => void log.push('pages'),
			warn: (...a: unknown[]) => void warnings.push(a),
		},
	};
}

test('pages: true re-fetches the page after the ui-views and the schema settle', async () => {
	const { log, deps: d } = deps();
	await handleInvalidate({ scope: 'schema', pages: true }, d);
	assert.deepEqual(log.slice(-1), ['pages']);
	assert.deepEqual([...log].sort(), ['pages', 'schema:done', 'ui:done']);
	assert.ok(log.indexOf('pages') > log.indexOf('schema:done') && log.indexOf('pages') > log.indexOf('ui:done'));
});

test('without pages, the page is never re-fetched — the watcher path costs what it did', async () => {
	for (const scope of ['schema', 'data', undefined]) {
		const { log, deps: d } = deps();
		await handleInvalidate({ scope }, d);
		assert.equal(log.includes('pages'), false, `scope ${scope}`);
	}
});

test('scope data skips the schema re-read, and pages still runs when asked', async () => {
	const { log, deps: d } = deps();
	await handleInvalidate({ scope: 'data', pages: true }, d);
	assert.deepEqual(log, ['ui:done', 'pages']);
});

test('a failed schema re-read still re-fetches the page, resolves, and writes the failure to the console', async () => {
	const { log, warnings, deps: d } = deps({ schemaFails: true });
	await handleInvalidate({ scope: 'schema', pages: true }, d);
	assert.equal(log.at(-1), 'pages');
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0]!.some((a) => a instanceof Error && a.message === 'schema failed'), 'the error itself is logged');
});

test('page-refresh: every subscriber runs, an unsubscribed one does not, a throwing one is skipped', () => {
	const ran: string[] = [];
	const offA = onPageRefresh(() => void ran.push('a'));
	const offBad = onPageRefresh(() => {
		throw new Error('boom');
	});
	const offB = onPageRefresh(() => void ran.push('b'));
	const quiet = console.warn;
	console.warn = () => {};
	try {
		assert.equal(requestPageRefresh(), 2, 'two subscribers ran to completion');
		assert.deepEqual(ran, ['a', 'b']);
		offA();
		ran.length = 0;
		assert.equal(requestPageRefresh(), 1);
		assert.deepEqual(ran, ['b']);
	} finally {
		console.warn = quiet;
		offBad();
		offB();
	}
	assert.equal(requestPageRefresh(), 0, 'no subscriber left');
});
