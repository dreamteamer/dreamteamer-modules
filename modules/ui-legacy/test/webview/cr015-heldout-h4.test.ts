// HELD-OUT h4 (cr-vscode-015) — a commands answer that lands after the page moved on: the marks and the
// subtitle follow the NEWEST record's answer, never the stale one, never a mix; and no mark is claimed
// for the new record before its own answer lands. Reviewer-written; the builder never reads it.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { CR_RND_001, PLAN_READY, answers, currentTitles, draw, marks, setup, show, settle, subtitleText } from './cr015-heldout-fixture';

beforeEach(setup);

function held(): { promise: Promise<Record<string, string>>; resolve: (v: Record<string, string>) => void } {
	let resolve!: (v: Record<string, string>) => void;
	const promise = new Promise<Record<string, string>>((r) => (resolve = r));
	return { promise, resolve };
}

test('h4: A\'s answer arrives after B\'s — the map shows B (cr-rnd-001\'s shape) and stays on B', async () => {
	const a = held();
	const b = held();
	answers.set('req-a', () => a.promise);
	answers.set('req-b', () => b.promise);
	const { root, item } = await draw('req-a');
	assert.deepEqual(currentTitles(root), [], 'A unanswered: nothing current');
	await show(item, 'req-b');
	assert.ok(marks(root).every((m) => m !== 'current' && m !== 'skipped'), `B unanswered: no mark claimed (${marks(root).join(',')})`);
	assert.doesNotMatch(subtitleText(root), /available|skipped|passed/, 'B unanswered: no command state claimed');
	b.resolve(CR_RND_001);
	await settle();
	const expectMarks = ['passed', 'passed', 'skipped', 'skipped', 'current'];
	assert.deepEqual(marks(root), expectMarks);
	assert.equal(subtitleText(root), '/rnd:release available');
	a.resolve(PLAN_READY); // the stale answer for the record the page left
	await settle();
	assert.deepEqual(marks(root), expectMarks, 'the stale answer did not repaint the marks');
	assert.deepEqual(currentTitles(root), ['deploy']);
	assert.equal(subtitleText(root), '/rnd:release available', 'nor the subtitle');
});

test('h4: B answered first while A is still pending, then A lands late — same result', async () => {
	const a = held();
	answers.set('req-a', () => a.promise);
	answers.set('req-b', () => CR_RND_001);
	const { root, item } = await draw('req-a');
	await show(item, 'req-b');
	assert.equal(subtitleText(root), '/rnd:release available');
	a.resolve(PLAN_READY);
	await settle();
	assert.deepEqual(currentTitles(root), ['deploy']);
	assert.equal(subtitleText(root), '/rnd:release available');
});
