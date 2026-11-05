// HELD-OUT h3, render tier (cr-vscode-015) — Escape twice on a keyboard-opened card: focus goes to the
// chip each time (never to the body), the card stays closed, Tab onward opens the next stage.
// Reviewer-written; the builder never reads it.
import assert from 'node:assert/strict';
import test, { beforeEach, mock } from 'node:test';
import { flush } from './render';
import { PLAN_READY, answers, chip, draw, fire, focusTarget, openStage, setup, stage } from './cr015-heldout-fixture';

beforeEach(setup);

test('h3: Escape twice focuses the chip twice and leaves no card; the chip\'s own focus does not reopen it; Tab to the next stage opens that one', async () => {
	answers.set('otp-expiry', () => PLAN_READY);
	const { root } = await draw('otp-expiry');
	const plan = stage(root, 'plan');
	const planChip = chip(plan);
	const focus = mock.method(planChip as unknown as { focus: () => void }, 'focus');
	fire(plan, 'onFocusin', { target: Object.assign(planChip, focusTarget(true)) });
	await flush();
	assert.equal(openStage(root), 'plan');
	fire(plan, 'onKeydown', { key: 'Escape', code: 'Escape' });
	await flush();
	assert.equal(openStage(root), null);
	fire(plan, 'onKeydown', { key: 'Escape', code: 'Escape' });
	await flush();
	assert.equal(openStage(root), null);
	assert.ok(focus.mock.callCount() >= 1, 'Escape sends focus to the chip, never the body');
	fire(plan, 'onFocusin', { target: Object.assign(planChip, focusTarget(true)) });
	await flush();
	assert.equal(openStage(root), null, 'the chip Escape focused does not reopen the card');
	// Tab onward: focus leaves the plan li for the implement chip
	const implement = stage(root, 'implement');
	fire(plan, 'onFocusout', { relatedTarget: chip(implement) });
	fire(implement, 'onFocusin', { target: Object.assign(chip(implement), focusTarget(true)) });
	await flush();
	assert.equal(openStage(root), 'implement');
});
