// HELD-OUT h3, tier 1 (cr-vscode-015) — interleavings beyond the plan's tier-1 list, against the pure
// reducer the plan fixes (cardState). The card shown is the stage last pointed at or tabbed to.
// Reviewer-written; the builder never reads it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_CLOSED, cardState, type CardEvent, type CardState } from '../../src/lib/stage-map';

const run = (events: CardEvent[], from: CardState = CARD_CLOSED): CardState => events.reduce(cardState, from);
const kbd = (i: number, inCard = false): CardEvent => ({ type: 'focus', i, keyboard: true, inCard });

test('h3: Tab from stage 2\'s card\'s last link to stage 3\'s chip shows stage 3', () => {
	const s = run([kbd(2), kbd(2, true), { type: 'blur', i: 2 }, kbd(3)]);
	assert.equal(s.open, 3);
	assert.equal(s.kbd, 3);
});

test('h3: Shift+Tab from stage 3\'s chip back to stage 2 shows stage 2, and into its card keeps it', () => {
	const s = run([kbd(3), { type: 'blur', i: 3 }, kbd(2)]);
	assert.equal(s.open, 2);
	assert.equal(run([kbd(2, true)], s).open, 2);
});

test('h3: Escape twice leaves no card, the refocused chip does not reopen it, and the pointer still opens another', () => {
	const s = run([kbd(2), { type: 'escape', i: 2 }, { type: 'escape', i: 2 }]);
	assert.equal(s.open, null);
	assert.equal(s.kbd, null);
	const refocused = run([kbd(2)], s);
	assert.equal(refocused.open, null, 'the chip Escape focused does not reopen its card');
	assert.equal(run([{ type: 'enter', i: 4, cardHasFocus: false }], refocused).open, 4);
});

test('h3: keyboard on 2, pointer onto 4, then Tab to 3 — the last intent (Tab) wins, and leaving 4 keeps 3', () => {
	const s = run([kbd(2), { type: 'enter', i: 4, cardHasFocus: false }, { type: 'blur', i: 2 }, kbd(3)]);
	assert.equal(s.open, 3);
	const after = run([{ type: 'leave', i: 4 }, { type: 'grace', cardHasFocus: false }], s);
	assert.equal(after.open, 3);
});

test('h3: pointer on 2, then down across the subtitle to click its command — the card closes after the grace, nothing else opens', () => {
	const s = run([{ type: 'enter', i: 2, cardHasFocus: false }, { type: 'leave', i: 2 }]);
	assert.equal(s.open, 2, 'still open during the grace');
	assert.equal(run([{ type: 'grace', cardHasFocus: false }], s).open, null);
});
