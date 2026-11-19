// HELD-OUT h2 (cr-vscode-015) — a stage with no gate, and a stage whose gate names a binding the
// workspace did not compile: the map draws, neither claims a command. Reviewer-written.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { flush, text } from './render';
import { PLAN_READY, RND_STAGES, answers, attr, cards, cmdButton, currentTitles, draw, fire, marks, setup, stage, stages, subtitleText } from './cr015-heldout-fixture';

const [design, plan, implement, testStage, deploy] = RND_STAGES.stages;
const ODD = {
	stage_reviews: 'reviews',
	stages: [design, { title: 'triage', fields: [], reviews: [], gate: [] }, plan, implement, { ...testStage, gate: ['rnd--ghost--change-requests'] }, deploy],
};

beforeEach(setup);

test('h2: with plan available, the gateless and the uncompiled stages draw, are not current, and claim no command', async () => {
	answers.set('odd', () => PLAN_READY);
	const { root } = await draw('odd', ODD);
	assert.deepEqual(stages(root).map((l) => attr(l, 'data-stage')), ['design', 'triage', 'plan', 'implement', 'test', 'deploy']);
	assert.deepEqual(currentTitles(root), ['plan']);
	assert.equal(marks(root).length, 6);
	assert.ok(marks(root).every((m) => m !== undefined), 'every stage carries a mark');
	assert.equal(subtitleText(root), '/rnd:plan available');
	assert.doesNotMatch(subtitleText(root), /ghost/);
	// their cards open and name no available command
	for (const t of ['triage', 'test']) {
		fire(stage(root, t), 'onMouseenter');
		await flush();
		assert.equal(cards(root).length, 1, `${t}'s card opens`);
		assert.doesNotMatch(text(cards(root)[0]!), /· available/, `${t}'s card claims no available command`);
		fire(stage(root, t), 'onMouseleave');
	}
});

test('h2: with nothing available anywhere, no command button is drawn and the ghost binding is never offered', async () => {
	answers.set('odd', () => ({ ...PLAN_READY, 'rnd--plan--change-requests': 'done', 'rnd--review--change-requests--plan': 'done', 'rnd--implement--change-requests': 'done', 'rnd--review--change-requests--code': 'done' }));
	const { root } = await draw('odd', ODD);
	assert.equal(stages(root).length, 6, 'the map still draws');
	assert.equal(cmdButton(root), null, 'no copy button when nothing is available');
	assert.equal(subtitleText(root), 'no command available');
	assert.ok(currentTitles(root).length <= 1);
});
