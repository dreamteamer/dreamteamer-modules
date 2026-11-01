// A REVIEW AFTER EVERY STAGE (0.5.2) — the lifecycle walked on a real engine, `dt next` read at every step.
//
// What the descriptors and the bindings promise, measured rather than read: a change request names exactly
// ONE next verb at every stage — the review when a stage has just ended, the next stage once that review
// approved — and every review of its lifecycle is listed on the request's generated `reviews`, while the
// design doc and the plan list theirs by `subject`. The walk is the Northwind cast's, nothing else.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { rndWorkspace, run, cleanupAll, put } from './helpers/rnd-workspace.mjs';

after(cleanupAll);

const ok = (r, what) => { assert.equal(r.status, 0, `${what}:\n${r.stderr}${r.stdout}`); return r; };
const dt = (root, ...args) => ok(run(root, args), `dt ${args.join(' ')}`);
const json = (root, ...args) => JSON.parse(dt(root, ...args, '--json').stdout);
/** The bindings `dt next` lists as AVAILABLE for one record — the verbs a session may run on it now. */
const available = (root, ref) => {
	const out = json(root, 'next', ref);
	const id = ref.split('/').pop();
	return out.commands.filter((c) => c.states?.[id] === 'available').map((c) => c.binding.replace(/^command-bindings\//, ''));
};
const get = (root, ref) => json(root, 'get', ref);
const CR = 'rnd/change-requests/otp-expiry';

/** One review written the way a reviewer writes it, through the CLI so the mirrors move with the write. */
function review(root, name, kind, subject, verdict, round = 1) {
	const { id } = json(root, 'add', 'rnd/reviews', '--name', name, '--kind', kind, '--subject', subject,
		'--change_request', CR, '--reviewer', 'agents/claude-code', '--verdict', verdict, '--round', String(round));
	return `rnd/reviews/${id}`;
}

describe('a change request walked from suggested to implemented — one next verb, every stage reviewed', () => {
	const root = rndWorkspace();
	put(root, 'data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
	const steps = [];
	const expectNext = (label, binding) => {
		const got = available(root, CR);
		steps.push([label, got]);
		assert.deepEqual(got, binding ? [binding] : [], `${label}: dt next ${CR} named ${JSON.stringify(got)}`);
	};
	let dd, plan;
	const reviews = [];

	test('suggested, no design: the design comes first, and the acceptance review waits for it', () => {
		dt(root, 'add', 'rnd/change-requests', '--key', 'otp-expiry', '--name', 'OTP expiry', '--products', 'rnd/products/grantee-portal',
			'--description', 'A one-time code older than five minutes is refused.', '--acceptance', 'a code older than five minutes is refused');
		expectNext('suggested', 'rnd--design--change-requests');
	});
	test('after DESIGN: the design doc\'s review is the one verb', () => {
		dd = `rnd/design-docs/${json(root, 'add', 'rnd/design-docs', '--name', 'OTP expiry', '--product', 'rnd/products/grantee-portal', '--status', 'draft').id}`;
		dt(root, 'set', CR, `design_docs=${dd}`);
		expectNext('design draft', 'rnd--review--change-requests--design');
	});
	test('design approved: the request\'s own acceptance review', () => {
		reviews.push(review(root, 'OTP expiry design — design', 'design', dd, 'approve'));
		dt(root, 'set', dd, 'status=active');
		expectNext('design active', 'rnd--review--change-requests');
	});
	test('accepted: plan', () => {
		reviews.push(review(root, 'OTP expiry — acceptance', 'acceptance', CR, 'approve'));
		dt(root, 'set', CR, 'status=accepted', 'accepted_by=users/dana-oren', 'accepted_on=2026-01-12T10:00:00+02:00');
		expectNext('accepted', 'rnd--plan--change-requests');
	});
	test('after PLAN: the plan\'s review', () => {
		plan = `rnd/implementation-plans/${json(root, 'add', 'rnd/implementation-plans', '--name', 'OTP expiry', '--spec', dd, '--change_request', CR, '--status', 'draft').id}`;
		expectNext('plan draft', 'rnd--review--change-requests--plan');
	});
	test('plan approved, then in progress: implement', () => {
		reviews.push(review(root, 'OTP expiry plan — design', 'design', plan, 'approve'));
		dt(root, 'set', plan, 'status=approved', 'execution=native');
		expectNext('plan approved', 'rnd--implement--change-requests');
		dt(root, 'set', plan, 'status=in-progress');
		expectNext('plan in progress', 'rnd--implement--change-requests');
	});
	test('after IMPLEMENT: the code review, on the request and on the plan — and changes-requested keeps it open', () => {
		dt(root, 'set', plan, 'status=done');
		expectNext('plan done', 'rnd--review--change-requests--code');
		assert.deepEqual(available(root, plan), ['rnd--review--implementation-plans--code']);
		reviews.push(review(root, 'OTP expiry branch — code', 'code', plan, 'changes-requested'));
		// THE REASON FOR `code_approved_on`: a condition over a many-valued reference matches each KEY on any
		// target, not all keys on one. The plan now has an approving review (its draft review) and a code review
		// (changes-requested), so "a review of kind code with verdict approve" holds per key and is false per
		// review. Were the gate written that way it would open here; the stamp is what keeps it shut.
		const naive = json(root, 'list', 'rnd/implementation-plans', '--where', '{"reviews":{"kind":{"_eq":"code"},"verdict":{"_eq":"approve"}}}');
		assert.equal((naive.rows ?? naive).length, 1, 'the engine matches a two-key condition across two different reviews — the stamp is still needed');
		expectNext('code review round 1 changes-requested', 'rnd--review--change-requests--code');
		assert.deepEqual(available(root, plan), ['rnd--review--implementation-plans--code']);
	});
	test('code approved: test — and the plan has nothing more of its own, its proof lives on the request', () => {
		reviews.push(review(root, 'OTP expiry branch — code, round 2', 'code', plan, 'approve', 2));
		dt(root, 'set', plan, 'code_approved_on=2026-01-14T10:00:00+02:00');
		expectNext('code approved', 'rnd--test--change-requests');
		assert.deepEqual(available(root, plan), []);
	});
	test('after TEST: the test review — its approve, not the stage, stamps verified_on', () => {
		dt(root, 'add', 'rnd/tests', '--key', 'otp-expired-refused', '--name', 'An expired code is refused', '--covers', CR, '--kind', 'acceptance', '--status', 'passing', '--last_run', '2026-01-15T10:00:00+02:00');
		dt(root, 'set', CR, 'tested_on=2026-01-15T10:00:00+02:00');
		expectNext('tested', 'rnd--review--change-requests--test');
		reviews.push(review(root, 'OTP expiry proof — test', 'test', CR, 'approve'));
		dt(root, 'set', CR, 'verified_on=2026-01-15T11:00:00+02:00');
		expectNext('verified', 'rnd--deploy--change-requests');
	});
	test('after DEPLOY: the live acceptance review; its approve sets implemented, and then nothing is open', () => {
		dt(root, 'set', CR, 'deployed_on=2026-01-16T10:00:00+02:00');
		expectNext('deployed', 'rnd--review--change-requests--deploy');
		reviews.push(review(root, 'OTP expiry live — acceptance', 'acceptance', CR, 'approve'));
		dt(root, 'set', CR, 'status=implemented');
		expectNext('implemented', null);
	});
	test('all change request reviews are referenced from cr.reviews; the design doc and the plan list theirs by subject', () => {
		assert.equal(reviews.length, 7);
		assert.deepEqual([...get(root, CR).reviews].sort(), [...reviews].sort());
		assert.deepEqual(get(root, dd).reviews, [reviews[0]]);
		assert.deepEqual([...get(root, plan).reviews].sort(), [reviews[2], reviews[3], reviews[4]].sort());
		dt(root, 'check');
	});
	test('a rejected request opens nothing', () => {
		dt(root, 'add', 'rnd/change-requests', '--key', 'dark-mode', '--name', 'Dark mode', '--products', 'rnd/products/grantee-portal', '--status', 'rejected');
		assert.deepEqual(available(root, 'rnd/change-requests/dark-mode'), []);
	});
});

describe('a plan with no change request — its own code review, test and test review', () => {
	const root = rndWorkspace();
	test('done → code review → test → test review → nothing', () => {
		const plan = `rnd/implementation-plans/${json(root, 'add', 'rnd/implementation-plans', '--name', 'Roster export', '--status', 'done').id}`;
		assert.deepEqual(available(root, plan), ['rnd--review--implementation-plans--code']);
		json(root, 'add', 'rnd/reviews', '--name', 'Roster export branch — code', '--kind', 'code', '--subject', plan, '--verdict', 'approve');
		dt(root, 'set', plan, 'code_approved_on=2026-01-14T10:00:00+02:00');
		assert.deepEqual(available(root, plan), ['rnd--test--implementation-plans']);
		dt(root, 'set', plan, 'tested_on=2026-01-15T10:00:00+02:00');
		assert.deepEqual(available(root, plan), ['rnd--review--implementation-plans--test']);
		dt(root, 'set', plan, 'verified_on=2026-01-15T11:00:00+02:00');
		assert.deepEqual(available(root, plan), []);
	});
});

describe('relations rebuild fills the new mirrors on reviews written before them', () => {
	const root = rndWorkspace();
	test('a review file that names a change request and a design doc appears in both mirrors after a rebuild', () => {
		put(root, 'data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
		put(root, 'data/rnd/change-requests/otp-expiry.change-request.md', '---\nkey: otp-expiry\nname: OTP expiry\nproducts:\n  - rnd/products/grantee-portal\n---\n');
		put(root, 'data/rnd/design-docs/2026-01-10--otp-expiry.design-doc.md', '---\nname: OTP expiry\n---\n');
		put(root, 'data/rnd/reviews/2026-01-11--otp-expiry-design.review.md', `---\nname: OTP expiry design — design\nkind: design\nsubject: rnd/design-docs/2026-01-10--otp-expiry\nchange_request: ${CR}\nverdict: approve\n---\n`);
		assert.equal(get(root, CR).reviews, undefined, 'a hand-written review moves no mirror until a rebuild');
		for (const c of ['rnd/change-requests', 'rnd/design-docs', 'rnd/products']) dt(root, 'relations', 'rebuild', c);
		assert.deepEqual(get(root, CR).reviews, ['rnd/reviews/2026-01-11--otp-expiry-design']);
		assert.deepEqual(get(root, 'rnd/design-docs/2026-01-10--otp-expiry').reviews, ['rnd/reviews/2026-01-11--otp-expiry-design']);
		dt(root, 'check');
	});
});

describe('requests in flight before 0.5.2, and a dead second plan or design — still one verb, never none while work is open', () => {
	const root = rndWorkspace();
	put(root, 'data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
	const cr = (key, ...flags) => {
		dt(root, 'add', 'rnd/change-requests', '--key', key, '--name', key, '--products', 'rnd/products/grantee-portal', ...flags);
		return `rnd/change-requests/${key}`;
	};
	const plan = (ref, status, ...flags) => `rnd/implementation-plans/${json(root, 'add', 'rnd/implementation-plans', '--name', `${ref.split('/').pop()} ${status}`, '--change_request', ref, '--status', status, ...flags).id}`;
	const design = (name, status) => `rnd/design-docs/${json(root, 'add', 'rnd/design-docs', '--name', name, '--product', 'rnd/products/grantee-portal', '--status', status).id}`;

	test('verified before 0.5.2, no design: deploy, and neither the design nor the code review (r1-01)', () => {
		const ref = cr('roster-export', '--status', 'accepted', '--verified_on', '2026-01-15T11:00:00+02:00');
		plan(ref, 'done');
		assert.deepEqual(available(root, ref), ['rnd--deploy--change-requests']);
	});
	test('a plan in progress and no design: implement, not design (r1-01)', () => {
		const ref = cr('csv-import', '--status', 'accepted');
		plan(ref, 'in-progress');
		assert.deepEqual(available(root, ref), ['rnd--implement--change-requests']);
	});
	test('a draft design beside a plan in progress: implement on the request, the design review on the doc (r1-01)', () => {
		const ref = cr('audit-log', '--status', 'accepted');
		const dd = design('Audit log', 'draft');
		dt(root, 'set', ref, `design_docs=${dd}`);
		plan(ref, 'in-progress');
		assert.deepEqual(available(root, ref), ['rnd--implement--change-requests']);
		assert.deepEqual(available(root, dd), ['rnd--review--design-docs']);
	});
	test('an abandoned plan beside a new draft: the draft\'s review, not nothing (r1-02)', () => {
		const ref = cr('bulk-close', '--status', 'accepted');
		const dd = design('Bulk close', 'active');
		dt(root, 'set', ref, `design_docs=${dd}`);
		plan(ref, 'abandoned');
		plan(ref, 'draft', '--spec', dd);
		assert.deepEqual(available(root, ref), ['rnd--review--change-requests--plan']);
	});
	test('a superseded design beside a new draft: the draft\'s review, not nothing (r1-02)', () => {
		const ref = cr('sso-login', '--status', 'suggested');
		const old = design('SSO login v1', 'superseded');
		const dd = design('SSO login v2', 'draft');
		dt(root, 'set', ref, `design_docs=${old}`, `design_docs=${dd}`);
		assert.deepEqual(available(root, ref), ['rnd--review--change-requests--design']);
	});
	test('verified by hand with neither plan nor design: deploy alone, never design again (r2-01)', () => {
		const ref = cr('legacy-fix', '--status', 'accepted', '--verified_on', '2026-01-15T11:00:00+02:00');
		assert.deepEqual(available(root, ref), ['rnd--deploy--change-requests']);
	});
	test('a rejected request that was deployed is offered nothing (r1-05)', () => {
		const ref = cr('dark-mode-2', '--status', 'rejected', '--deployed_on', '2026-01-16T10:00:00+02:00');
		assert.deepEqual(available(root, ref), []);
	});
	test('and the clean walk\'s records still check clean', () => { dt(root, 'check'); });
});

