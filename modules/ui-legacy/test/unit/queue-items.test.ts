// Tier 1 — cr-modules-017 task 17: a queued command's state in words, and when Ask in chat is offered at all — only
// where a hook ran for this workspace in the last 24 hours (`chat: true`) and the row has an invocation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAsk, itemLabel } from '../../src/lib/queue-items';
import type { CommandRow } from '../../src/lib/command-rows';

const item = (over: Record<string, unknown>) => ({ id: 'i1', command: 'commands/close-task', refs: ['tasks/a'], invocation: '/close-task tasks/a', state: 'waiting', queuedAt: '2026-11-14T10:00:00.000Z', ...over }) as any;
const row = (invocation: string | null) => ({ binding: 'b', command: 'commands/close-task', name: 'close-task', description: '', 'argument-hint': null, scope: 'record', invocation }) as CommandRow;

test('itemLabel: Waiting · Delivered <time> · Expired', () => {
	assert.equal(itemLabel(item({})), 'Waiting');
	const at = new Date(2026, 10, 14, 14, 2).toISOString();
	assert.equal(itemLabel(item({ state: 'delivered', deliveredAt: at }), 'en-GB'), 'Delivered 14:02');
	assert.equal(itemLabel(item({ state: 'delivered' })), 'Delivered');
	assert.equal(itemLabel(item({ state: 'expired' })), 'Expired');
});

test('canAsk: chat true and a runnable row — never in the editor, never with no hook', () => {
	assert.equal(canAsk({ chat: true }, row('/close-task tasks/a')), true);
	assert.equal(canAsk({ chat: false }, row('/close-task tasks/a')), false);
	assert.equal(canAsk(null, row('/close-task tasks/a')), false);
	assert.equal(canAsk({ chat: true }, row(null)), false);
});
