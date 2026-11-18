// Tier 1 — the order the app tab drops and re-reads its schema caches.
//
// ⚠ THE BUG THIS GUARDS is invisible at runtime: `/collections`, `/fields/:c` and `/relations` are
// all served out of the adapter's cached `/presentation` contract, so a re-read issued BEFORE that
// contract is dropped re-reads the same stale object — and reports success. The screen keeps saying
// "Unknown collection" while every log line says the refresh ran.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refreshSchema, type SchemaCaches } from '../../src/lib/schema-refresh';

function spy() {
	const calls: string[] = [];
	const caches: SchemaCaches = {
		invalidateContract: () => void calls.push('invalidateContract'),
		invalidateServerInfo: () => void calls.push('invalidateServerInfo'),
		invalidateRelations: () => void calls.push('invalidateRelations'),
		refreshCollections: async () => void calls.push('refreshCollections'),
		reloadCachedFields: async () => void calls.push('reloadCachedFields'),
	};
	return { calls, caches };
}

describe('every schema cache is reached', () => {
	test('all five, once each', async () => {
		const { calls, caches } = spy();
		await refreshSchema(caches);
		assert.deepEqual([...calls].sort(), [
			'invalidateContract',
			'invalidateRelations',
			'invalidateServerInfo',
			'refreshCollections',
			'reloadCachedFields',
		]);
	});
});

describe('⚠ drop everything BEFORE re-reading anything', () => {
	test('the contract is dropped before the collections overview is re-read', async () => {
		const { calls, caches } = spy();
		await refreshSchema(caches);
		assert.ok(
			calls.indexOf('invalidateContract') < calls.indexOf('refreshCollections'),
			`contract must be dropped first, got: ${calls.join(' → ')}`,
		);
	});

	test('the contract is dropped before the mounted field states are re-read', async () => {
		const { calls, caches } = spy();
		await refreshSchema(caches);
		assert.ok(
			calls.indexOf('invalidateContract') < calls.indexOf('reloadCachedFields'),
			`contract must be dropped first, got: ${calls.join(' → ')}`,
		);
	});

	test('the relations list is dropped before the field states that read it', async () => {
		// createFieldsState.load() awaits loadRelations() — a reload that runs while the old
		// relations promise is still cached rebuilds relationTargets from the pre-compile targets.
		const { calls, caches } = spy();
		await refreshSchema(caches);
		assert.ok(calls.indexOf('invalidateRelations') < calls.indexOf('reloadCachedFields'));
	});
});

describe('the caller can await the whole refresh', () => {
	test('the promise does not settle until both re-reads have', async () => {
		let done = 0;
		const settle = async () => {
			await new Promise((r) => setTimeout(r, 5));
			done++;
		};
		await refreshSchema({
			invalidateContract: () => {},
			invalidateServerInfo: () => {},
			invalidateRelations: () => {},
			refreshCollections: settle,
			reloadCachedFields: settle,
		});
		assert.equal(done, 2);
	});
});
