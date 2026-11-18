/**
 * Tier 1 — the stage map's reading (`webview/src/lib/stage-map.ts`): the declaration a collection's
 * `display.record.options.stages` carries, which review lands in which stage, and what a gate's
 * binding states say. Fixtures are the synthetic Northwind change request; nothing here is a real
 * workspace's.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gateEntries, isEmptyValue, reviewMatches, stageReviews, stageReviewsField, stageSpecs, stageState } from '../../src/lib/stage-map';
import type { CommandRow } from '../../src/lib/command-rows';

const OPTIONS = {
	stage_reviews: 'reviews',
	stages: [
		{ title: 'design', fields: ['design_docs'], reviews: [{ subject: 'design_docs' }, { subject: 'self', kind: ['acceptance'], before: 'deployed_on' }], gate: ['rnd--design--change-requests', 'rnd--review--change-requests--design', 'rnd--review--change-requests'] },
		{ title: 'plan', fields: ['implementation_plans'], reviews: [{ subject: 'implementation_plans', kind: ['design'] }], gate: ['rnd--plan--change-requests', 'rnd--review--change-requests--plan'] },
		{ title: 'implement', fields: ['implementation_plans'], reviews: [{ kind: ['code'] }], gate: ['rnd--implement--change-requests', 'rnd--review--change-requests--code'] },
		{ title: 'test', fields: ['tests', 'tested_on', 'verified_on'], reviews: [{ kind: ['test'] }], gate: ['rnd--test--change-requests', 'rnd--review--change-requests--test'] },
		{ title: 'deploy', fields: ['deployed_on'], reviews: [{ subject: 'self', kind: ['acceptance'], since: 'deployed_on' }], gate: ['rnd--deploy--change-requests', 'rnd--review--change-requests--deploy'] },
	],
};
const SELF = 'rnd/change-requests/otp-expiry';
// the app spells a reference `/collection/id`; the engine `collection/id` — the reading takes both
const RECORD = {
	id: 'otp-expiry',
	design_docs: ['/rnd/design-docs/2026-01-10--otp-expiry'],
	implementation_plans: ['/rnd/implementation-plans/2026-01-12--otp-expiry'],
	deployed_on: '2026-01-16T10:00:00+02:00',
};
const review = (id: string, kind: string, subject: string, created: string, verdict = 'approve') => ({ id, kind, subject, created, verdict });
const REVIEWS = [
	review('r-design', 'design', '/rnd/design-docs/2026-01-10--otp-expiry', '2026-01-11T09:00:00+02:00'),
	review('r-accept', 'acceptance', SELF, '2026-01-11T12:00:00+02:00'),
	review('r-plan', 'design', 'rnd/implementation-plans/2026-01-12--otp-expiry', '2026-01-12T12:00:00+02:00'),
	review('r-code-1', 'code', 'rnd/implementation-plans/2026-01-12--otp-expiry', '2026-01-13T12:00:00+02:00', 'changes-requested'),
	review('r-code-2', 'code', 'rnd/implementation-plans/2026-01-12--otp-expiry', '2026-01-14T12:00:00+02:00'),
	review('r-test', 'test', SELF, '2026-01-15T12:00:00+02:00'),
	review('r-live', 'acceptance', SELF, '2026-01-16T12:00:00+02:00'),
];

describe('stageSpecs — the declaration', () => {
	test('the five stages come back in their declared order, with their fields, matchers and gate', () => {
		const specs = stageSpecs(OPTIONS)!;
		assert.deepEqual(specs.map((s) => s.title), ['design', 'plan', 'implement', 'test', 'deploy']);
		assert.deepEqual(specs[3]!.fields, ['tests', 'tested_on', 'verified_on']);
		assert.deepEqual(specs[0]!.reviews[1], { subject: 'self', kind: ['acceptance'], before: 'deployed_on' });
		assert.equal(stageReviewsField(OPTIONS), 'reviews');
	});
	test('no stages declared is null — the record page draws no map at all', () => {
		assert.equal(stageSpecs(undefined), null);
		assert.equal(stageSpecs({ relation_views: {} }), null);
		assert.equal(stageSpecs({ stages: 'design' }), null);
	});
	test('a malformed stage degrades: an untitled one is dropped, a bad key reads as empty, nothing throws', () => {
		const specs = stageSpecs({ stages: [{ fields: ['x'] }, { title: 'plan', fields: 'x', reviews: [null, { kind: 'code' }], gate: [1, 'b'] }] })!;
		assert.deepEqual(specs, [{ title: 'plan', fields: [], reviews: [{}], gate: ['b'] }]);
	});
});

describe('which review belongs to which stage', () => {
	const specs = stageSpecs(OPTIONS)!;
	const at = (title: string) => stageReviews(specs.find((s) => s.title === title)!, REVIEWS, RECORD, SELF).map((r) => r.id);
	test('each review lands in its stage: the design doc and the request\'s acceptance in design, the plan\'s in plan, code, test, the live check in deploy', () => {
		assert.deepEqual(at('design'), ['r-design', 'r-accept']);
		assert.deepEqual(at('plan'), ['r-plan']);
		assert.deepEqual(at('implement'), ['r-code-1', 'r-code-2']);
		assert.deepEqual(at('test'), ['r-test']);
		assert.deepEqual(at('deploy'), ['r-live']);
	});
	test('before deploy, an acceptance review is the request\'s own; `since` an empty field claims nothing', () => {
		const undeployed = { ...RECORD, deployed_on: undefined };
		assert.deepEqual(stageReviews(specs[0]!, REVIEWS, undeployed, SELF).map((r) => r.id), ['r-design', 'r-accept', 'r-live']);
		assert.deepEqual(stageReviews(specs[4]!, REVIEWS, undeployed, SELF), []);
	});
	test('a subject matcher compares references in either spelling, and refuses another record\'s', () => {
		assert.equal(reviewMatches({ subject: 'self' }, { subject: `/${SELF}` }, RECORD, SELF), true);
		assert.equal(reviewMatches({ subject: 'design_docs' }, { subject: 'rnd/design-docs/other' }, RECORD, SELF), false);
		assert.equal(reviewMatches({ subject: 'design_docs' }, {}, RECORD, SELF), false);
	});
});

describe('the gate — read off the engine\'s binding states', () => {
	const specs = stageSpecs(OPTIONS)!;
	const row = (binding: string, state: string): CommandRow => ({ binding: `command-bindings/${binding}`, command: 'commands/rnd/x', name: binding.startsWith('rnd--review') ? 'rnd/review' : 'rnd/x', description: '', 'argument-hint': null, scope: 'record', states: { 'otp-expiry': state }, invocation: null });
	const implement = specs[2]!;
	test('the work available is ready; the work done and its review available is awaiting review; both done is passed', () => {
		assert.equal(stageState(gateEntries(implement, [row('rnd--implement--change-requests', 'available'), row('rnd--review--change-requests--code', 'not-applicable')], 'otp-expiry')), 'ready');
		assert.equal(stageState(gateEntries(implement, [row('rnd--implement--change-requests', 'done'), row('rnd--review--change-requests--code', 'available')], 'otp-expiry')), 'review');
		assert.equal(stageState(gateEntries(implement, [row('rnd--implement--change-requests', 'done'), row('rnd--review--change-requests--code', 'done')], 'otp-expiry')), 'passed');
	});
	test('nothing available and not all done is not started — and a binding the engine never answered for is not-applicable', () => {
		const entries = gateEntries(implement, [], 'otp-expiry');
		assert.deepEqual(entries.map((e) => e.state), ['not-applicable', 'not-applicable']);
		assert.equal(stageState(entries), 'not-started');
		assert.equal(stageState([]), 'not-started');
	});
	test('a stage passes only when EVERY binding is done — an accepted request whose design was never made is not a passed design stage', () => {
		const design = specs[0]!;
		const entries = gateEntries(design, [row('rnd--design--change-requests', 'available'), row('rnd--review--change-requests--design', 'not-applicable'), row('rnd--review--change-requests', 'done')], 'otp-expiry');
		assert.equal(stageState(entries), 'ready');
	});
});

test('empty is absent, blank, or an empty list — false and 0 are values', () => {
	for (const v of [undefined, null, '', []]) assert.equal(isEmptyValue(v), true);
	for (const v of [0, false, ['x'], 'x']) assert.equal(isEmptyValue(v), false);
});

// cr-vscode-015 — the one-line map's readings. Gate shapes are rnd 0.8.0's real gates, letters per
// binding in declared order: d done · a available · n not-applicable.
import { CARD_CLOSED, cardLeft, cardState, currentStage, stageMark, type CardEvent, type CardState, type GateEntry } from '../../src/lib/stage-map';

const g = (letters: string): GateEntry[] =>
	[...letters].map((l, i) => ({ binding: `b${i}`, name: i === 0 ? 'rnd/work' : 'rnd/review', state: l === 'd' ? 'done' : l === 'a' ? 'available' : 'not-applicable' }));
const shape = (...stages: string[]) => stages.map(g);

describe('cr-vscode-015 — stageState reads work vs review structurally', () => {
	test('an available binding after only not-applicable ones is the work (deploy waiting on /rnd:release reads ready)', () => {
		assert.equal(stageState(g('nan')), 'ready');
		assert.equal(stageState(g('da')), 'review');
		assert.equal(stageState(g('ddda')), 'review');
		assert.equal(stageState(g('and')), 'ready');
	});
});

describe('cr-vscode-015 — currentStage follows the first available binding', () => {
	test('a review open on implement', () => assert.equal(currentStage(shape('ddd', 'dd', 'da', 'nn', 'nnn')), 2));
	test('cr-rnd-001: implement and test skipped, deploy waiting on the release', () => assert.equal(currentStage(shape('ddd', 'dd', 'dn', 'nd', 'nan')), 4));
	test('cr-core-001: shipped with two stages skipped — none current', () => assert.equal(currentStage(shape('ddd', 'dd', 'dn', 'nd', 'ddd')), -1));
	test('a design stage passed over, deploy available', () => assert.equal(currentStage(shape('nnd', 'dd', 'dd', 'dd', 'nan')), 4));
	test('nothing available: the stage after the last passed one', () => assert.equal(currentStage(shape('ddd', 'nn', 'nn', 'nn', 'nnn')), 1));
	test('nothing available and nothing passed: none', () => assert.equal(currentStage(shape('nnn', 'nn', 'nn', 'nn', 'nnn')), -1));
});

describe('cr-vscode-015 — stageMark', () => {
	test('passed wins, then current, then skipped before it, ahead after it', () => {
		assert.equal(stageMark(3, 1, 'passed'), 'passed');
		assert.equal(stageMark(1, 1, 'ready'), 'current');
		assert.equal(stageMark(0, 2, 'not-started'), 'skipped');
		assert.equal(stageMark(3, 2, 'not-started'), 'ahead');
		assert.equal(stageMark(2, -1, 'not-started'), 'skipped', 'with none current, a stage not passed was passed over');
	});
});

describe('cr-vscode-015 — cardLeft keeps the card inside the map', () => {
	test('left edge, middle, right edge, wider than the map', () => {
		assert.equal(cardLeft(0, 360, 800), 0);
		assert.equal(cardLeft(200, 360, 800), 200);
		assert.equal(cardLeft(700, 360, 800), 440);
		assert.equal(cardLeft(100, 360, 300), 0);
	});
});

describe('cr-vscode-015 — cardState: the most recent intent picks the card', () => {
	const run = (events: CardEvent[], from: CardState = CARD_CLOSED): Array<number | null> => {
		const opens: Array<number | null> = [];
		let s = from;
		for (const e of events) { s = cardState(s, e); opens.push(s.open); }
		return opens;
	};
	const enter = (i: number, cardHasFocus = false): CardEvent => ({ type: 'enter', i, cardHasFocus });
	const leave = (i: number): CardEvent => ({ type: 'leave', i });
	const grace = (cardHasFocus = false): CardEvent => ({ type: 'grace', cardHasFocus });
	const focus = (i: number, keyboard: boolean, inCard = false): CardEvent => ({ type: 'focus', i, keyboard, inCard });
	test('A: a clicked (mouse-focused) chip never pins its card', () => {
		assert.deepEqual(run([enter(2), focus(2, false), leave(2), enter(4), leave(4), grace()]), [2, 2, 2, 4, 4, null]);
	});
	test('B: keyboard focus, Escape, pointer into another stage', () => {
		assert.deepEqual(run([focus(2, true), { type: 'escape', i: 2 }, focus(2, true), enter(4), leave(4), grace()]), [2, null, null, 4, 4, null]);
	});
	test('C: a mouse-focused link in a card does not hold it', () => {
		assert.deepEqual(run([enter(2), focus(2, false, true), enter(4, true), leave(4), grace(true)]), [2, 2, 4, 4, null]);
	});
	test('a keyboard user inside a card keeps it whatever the pointer does', () => {
		assert.deepEqual(run([focus(2, true), focus(2, true, true), enter(4, true), leave(4), grace(true)]), [2, 2, 2, 2, 2]);
	});
	test('keyboard focus on the chip only: the pointer takes the card, the grace gives it back', () => {
		assert.deepEqual(run([focus(2, true), enter(4), leave(4), grace()]), [2, 4, 4, 2]);
	});
	test('a stale keyboard mark: tab in, then a mouse click inside the card clears it', () => {
		assert.deepEqual(run([focus(2, true), focus(2, false, true), enter(4, true), leave(4), grace(true)]), [2, 2, 4, 4, null]);
	});
	test('focus leaving the stage closes its card unless the pointer is on it', () => {
		assert.deepEqual(run([focus(2, true), { type: 'blur', i: 2 }]), [2, null]);
		assert.deepEqual(run([enter(2), focus(2, true), { type: 'blur', i: 2 }]), [2, 2, 2]);
	});
});
