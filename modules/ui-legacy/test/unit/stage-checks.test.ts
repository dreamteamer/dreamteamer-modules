// THE STAGE CHECKS — a field whose `viewer` is `stage-checks` draws each declared stage tag as a check:
// none when the stage is not tagged, one when it is, two when a matching review exists — green when the
// latest one approves with no open finding, orange when it left remarks, neutral while it has no verdict —
// and the review's description on hover. The declaration (`viewer_options`) is the collection's; nothing
// here knows a collection. Pure, so every row of the drawing table is a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	bareRef,
	candidateSubjects,
	freeTags,
	latestReview,
	reviewMatches,
	stageCheck,
	stageChecksSpec,
	type Review,
} from '../../src/lib/stage-checks';

// the declaration the rnd module ships on rnd/change-requests.tags
const OPTIONS = {
	reviews_from: 'rnd/reviews',
	findings_from: 'rnd/review-findings',
	stages: [
		{ tag: 'designed', title: 'Designed', reviews: [{ kind: ['design'], subject: 'design_docs', since: 'created' }, { kind: ['acceptance'], subject: 'self', before: 'deployed_on' }] },
		{ tag: 'implemented', title: 'Implemented', reviews: [{ kind: ['code', 'security'], subject: 'implementation_plans' }, { kind: ['code', 'security'], subject: 'self' }] },
		{ tag: 'tested', title: 'Tested', reviews: [{ kind: ['test'], subject: 'self' }, { kind: ['test'], subject: 'implementation_plans' }] },
		{ tag: 'deployed', title: 'Deployed', reviews: [{ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }] },
	],
};
const SPEC = stageChecksSpec(OPTIONS)!;
const SELF = 'rnd/change-requests/cr-7';
const stage = (tag: string) => SPEC.stages.find((s) => s.tag === tag)!;
const RECORD = {
	id: 'cr-7',
	created: '2026-03-01T09:00:00+02:00',
	tags: ['designed', 'implemented', 'tested', 'client:northwind'],
	design_docs: ['/rnd/design-docs/2026-03-01--portal'],
	implementation_plans: ['rnd/implementation-plans/2026-03-02--portal'],
	deployed_on: null,
};
const review = (id: string, over: Partial<Review>): Review => ({ id, kind: 'design', subject: 'rnd/design-docs/2026-03-01--portal', created: '2026-03-01T12:00:00+02:00', ...over });
const none = new Map<string, number>();

test('the declaration: stages in order, matchers kept, a malformed one degrades and never throws', () => {
	assert.deepEqual(SPEC.stages.map((s) => s.tag), ['designed', 'implemented', 'tested', 'deployed']);
	assert.equal(SPEC.reviewsFrom, 'rnd/reviews');
	assert.equal(SPEC.findingsFrom, 'rnd/review-findings');
	assert.deepEqual(stage('deployed').reviews, [{ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }]);
	assert.equal(stageChecksSpec(undefined), null);
	assert.equal(stageChecksSpec({ stages: 'nope' }), null);
	assert.deepEqual(stageChecksSpec({ stages: [{ title: 'no tag' }, { tag: 'x', reviews: [null, 3, { kind: 'code' }] }] })!.stages, [{ tag: 'x', title: 'x', reviews: [{}] }]);
	assert.equal(stageChecksSpec({ stages: [{ tag: 'x' }] })!.reviewsFrom, null, 'no reviews_from: tag-only');
});

test('references in either spelling, ids with slashes', () => {
	assert.equal(bareRef('/rnd/tests/portal/t1'), 'rnd/tests/portal/t1');
	assert.deepEqual(candidateSubjects(SPEC, RECORD, SELF), ['rnd/design-docs/2026-03-01--portal', 'rnd/change-requests/cr-7', 'rnd/implementation-plans/2026-03-02--portal']);
});

test('since / before: an empty since field matches nothing, an empty before field restricts nothing; offsets compare as instants', () => {
	const acc = review('acc', { kind: 'acceptance', subject: SELF, created: '2026-03-04T10:00:00+02:00' });
	assert.equal(reviewMatches({ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }, acc, RECORD, SELF), false, 'not deployed: no live review');
	assert.equal(reviewMatches({ kind: ['acceptance'], subject: 'self', before: 'deployed_on' }, acc, RECORD, SELF), true, 'not deployed: the acceptance review is before');
	const deployed = { ...RECORD, deployed_on: '2026-03-04T09:00:00Z' }; // 11:00 at +02:00
	assert.equal(reviewMatches({ kind: ['acceptance'], subject: 'self', before: 'deployed_on' }, acc, deployed, SELF), true, '10:00+02 is before 09:00Z');
	assert.equal(reviewMatches({ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }, acc, deployed, SELF), false);
	const old = review('old', { created: '2026-02-01T00:00:00Z' });
	assert.equal(reviewMatches({ kind: ['design'], subject: 'design_docs', since: 'created' }, old, RECORD, SELF), false, 'a review an amended design got before the request existed');
});

test('the latest matching review is by created, never by round; round only breaks a tie', () => {
	const r2 = review('a', { kind: 'test', round: 2, verdict: 'approve', created: '2026-03-05T10:00:00+02:00' });
	const r1 = review('b', { kind: 'test', round: 1, verdict: 'changes-requested', created: '2026-03-09T10:00:00+02:00' });
	assert.equal(latestReview([r2, r1])!.id, 'b', 'a retest restarts at round 1');
	const tieA = review('c', { round: 1, created: '2026-03-05T08:00:00Z' });
	const tieB = review('d', { round: 2, created: '2026-03-05T10:00:00+02:00' });
	assert.equal(latestReview([tieA, tieB])!.id, 'd');
	assert.equal(latestReview([review('e', { created: undefined }), review('f', {})])!.id, 'f');
	assert.equal(latestReview([]), null);
});

test('the drawing table: none · one · two neutral · two green · two orange', () => {
	// not tagged
	const dep = stageCheck(stage('deployed'), RECORD.tags, RECORD, SELF, [], none);
	assert.equal(dep.state, 'none');
	// tagged, no review
	const one = stageCheck(stage('implemented'), RECORD.tags, RECORD, SELF, [], none);
	assert.equal(one.state, 'done');
	assert.equal(one.label, 'Implemented — no review yet');
	// approve, no open finding
	const ok = review('ok', { verdict: 'approve', round: 2, description: 'design holds; two minors accepted' });
	const green = stageCheck(stage('designed'), RECORD.tags, RECORD, SELF, [ok], none);
	assert.equal(green.state, 'approved');
	assert.equal(green.label, 'Designed — reviewed, approve (round 2): design holds; two minors accepted');
	// changes requested
	const cr = review('cr', { kind: 'code', subject: 'rnd/implementation-plans/2026-03-02--portal', verdict: 'changes-requested', name: 'branch review' });
	const orange = stageCheck(stage('implemented'), RECORD.tags, RECORD, SELF, [cr], new Map([['cr', 2]]));
	assert.equal(orange.state, 'remarks');
	assert.equal(orange.label, 'Implemented — reviewed, changes-requested (round 1), 2 open findings: branch review');
	// approve with an open finding is orange; a reject is orange; an approve whose findings are all closed is green
	assert.equal(stageCheck(stage('designed'), RECORD.tags, RECORD, SELF, [ok], new Map([['ok', 1]])).state, 'remarks');
	assert.equal(stageCheck(stage('designed'), RECORD.tags, RECORD, SELF, [review('rj', { verdict: 'reject' })], none).state, 'remarks');
	// no verdict, no open finding
	const pending = stageCheck(stage('tested'), RECORD.tags, RECORD, SELF, [review('p', { kind: 'test', subject: SELF, name: 'test stage' })], none);
	assert.equal(pending.state, 'pending');
	assert.equal(pending.label, 'Tested — reviewed, no verdict yet: test stage');
	// a review on an untagged stage draws nothing
	const live = review('live', { kind: 'acceptance', subject: SELF, verdict: 'approve', created: '2026-03-10T00:00:00Z' });
	assert.equal(stageCheck(stage('deployed'), RECORD.tags, { ...RECORD, deployed_on: '2026-03-09T00:00:00Z' }, SELF, [live], none).state, 'none');
});

test('a security review counts for implemented; a plan review (kind design, subject the plan) counts for no stage', () => {
	const sec = review('sec', { kind: 'security', subject: SELF, verdict: 'approve' });
	assert.equal(stageCheck(stage('implemented'), RECORD.tags, RECORD, SELF, [sec], none).state, 'approved');
	const planReview = review('pr', { kind: 'design', subject: 'rnd/implementation-plans/2026-03-02--portal', verdict: 'approve' });
	assert.equal(stageCheck(stage('designed'), RECORD.tags, RECORD, SELF, [planReview], none).state, 'done');
});

test('without the row the reviews cannot be placed: tag-only, and the hover says so', () => {
	const c = stageCheck(stage('designed'), RECORD.tags, null, null, [], none);
	assert.equal(c.state, 'done');
	assert.equal(c.label, 'Designed — tagged (reviews are not read here)');
});

test('free tags are every tag that is not a declared stage, look-alikes included', () => {
	assert.deepEqual(freeTags(['deployed-staging', 'designed', 'designed:v2', 'client:northwind'], SPEC), ['deployed-staging', 'designed:v2', 'client:northwind']);
});
