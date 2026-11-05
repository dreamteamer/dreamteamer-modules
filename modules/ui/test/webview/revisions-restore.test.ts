/**
 * Spec §3.4: "Revert is refused, and says so before the click. … The history panel instead disables
 * Revert and shows the engine's own explanation, read from the presentation projection rather than
 * restated here."
 *
 * ⚠ THE REASON THIS FILE EXISTS. Tier 3's own revert test (`test/ui/suite/index.js`) once asserted
 * that `api.handle` answers ≥400 and that `/presentation` carried the refusal. Both were true while
 * the rendered Restore button was ENABLED, opened a confirm, and swallowed the engine's refusal
 * whole — no toast, no error, nothing written. A projection being CARRIED is not a projection being
 * CONSUMED, and only a rendered control can be asked which it is.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { all, hasClass, render, text, type TestNode } from './render';
import { onHostRequest } from './host-stub';
import ItemHistory from '../../webview/src/components/ItemHistory.vue';

// `revert` is refused for every RUNTIME kind, for a structural reason: a compiled record's bytes
// live in the gitignored runtime, so there is no revision of the RECORD to restore. The stub serves
// what the engine's display contract (descriptor v2, §4.3) really carries — `runtime: true`, and no
// collection-level read-only of any kind — and the assertion is that the gate keys on `runtime`.
const row = (collection: string, runtime: boolean) => ({
	collection,
	title: collection,
	nav: {},
	list: { layout: 'table' },
	record: { layout: 'page' },
	form: { sections: [] },
	record_title: '{{ id }}',
	record_type: collection,
	runtime,
	internal: runtime,
});

const SHA = 'abc1234def5678901234567890123456789abcde';

onHostRequest((method, path) => {
	if (path === '/presentation') {
		return {
			collections: [row('ui-views', true), row('people', false)],
			fields: { 'ui-views': [], people: [] },
			relations: [],
		};
	}
	if (path === '/info') return { name: 'scratch' };
	if (path.startsWith('/history/')) {
		return [{ hash: SHA, author: 'a writer', date: '2026-01-01T00:00:00+00:00', subject: 'a commit' }];
	}
	throw new Error(`the render tier did not stub ${method} ${path}`);
});

function restoreButton(root: TestNode): TestNode | null {
	return all(root, (n) => n.tag === 'button' && hasClass(n, 'dt-history-revert-btn'))[0] ?? null;
}

test('a compiled record does not offer Restore — it is disabled and carries the engine sentence', async () => {
	const root = await render(ItemHistory, { collection: 'ui-views', id: 'roster' });

	// The row itself has to be there, or every assertion below passes on an empty panel.
	assert.equal(all(root, (n) => n.tag === 'li').length, 1, 'the revision row rendered');

	const button = restoreButton(root);
	assert.ok(button, 'the Restore control is drawn (disabled, not hidden — the operator asks why)');
	assert.equal(button.props['disabled'], true, 'Restore is DISABLED on a compiled record');
	assert.match(
		String(button.props['title'] ?? ''),
		/compiled/,
		'its tooltip explains the refusal rather than promising the action',
	);
	assert.match(
		String(button.props['title'] ?? ''),
		/no record revision to restore/,
		'and it gives the STRUCTURAL reason — a compiled record has no revision of its own — rather than claiming the collection is read-only, which it is not',
	);
	assert.doesNotMatch(
		String(button.props['title'] ?? ''),
		/read-only/,
		'a runtime kind is writable by set/rename/rm; calling it read-only here is the defect this test pins',
	);
});

test('a writable record still offers Restore', async () => {
	const root = await render(ItemHistory, { collection: 'people', id: 'dana-levi' });

	assert.equal(all(root, (n) => n.tag === 'li').length, 1, 'the revision row rendered');
	const button = restoreButton(root);
	assert.ok(button, 'the Restore control is drawn');
	assert.equal(button.props['disabled'], undefined, 'and it is enabled');
	assert.equal(button.props['title'], 'Restore this version');
	assert.match(text(button), /restore/);
});
