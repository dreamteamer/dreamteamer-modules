// cr-modules-022: the toast store — a success leaves by itself, an error stays, at most four at once, and a reported
// write passes its own result or rejection through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_MAX, dismissToast, reported, toast, toasts } from '../../src/lib/toasts';

const clear = () => { for (const t of [...toasts.value]) dismissToast(t.id); };

test('a success leaves after its time and an error stays', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	clear();
	toast('success', 'Saved');
	toast('error', 'The change was not saved', 'a required field is empty');
	assert.equal(toasts.value.length, 2);
	t.mock.timers.tick(4001);
	assert.deepEqual(toasts.value.map((x) => x.kind), ['error']);
	assert.equal(toasts.value[0].detail, 'a required field is empty');
	clear();
});

test('at most four at once: the oldest success goes first, errors only when nothing else is left', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	clear();
	toast('error', 'e1');
	toast('success', 's1');
	toast('error', 'e2');
	toast('error', 'e3');
	toast('error', 'e4');
	assert.equal(toasts.value.length, TOAST_MAX);
	assert.deepEqual(toasts.value.map((x) => x.text), ['e1', 'e2', 'e3', 'e4']);
	toast('error', 'e5');
	assert.deepEqual(toasts.value.map((x) => x.text), ['e2', 'e3', 'e4', 'e5']);
	clear();
});

test('reported: the result passes through with a success, a rejection rethrows with a sticky error', async () => {
	clear();
	assert.equal(await reported(async () => 7, 'ok', 'fail'), 7);
	assert.equal(toasts.value.at(-1)?.kind, 'success');
	await assert.rejects(reported(async () => { throw new Error('refused'); }, 'ok', 'fail'), /refused/);
	assert.deepEqual({ kind: toasts.value.at(-1)?.kind, text: toasts.value.at(-1)?.text, detail: toasts.value.at(-1)?.detail }, { kind: 'error', text: 'fail', detail: 'refused' });
	clear();
});
