// HELD-OUT (prototype-harness-heldout-replay-determinism): stateAt(i) equals forward application at every step,
// with a mid-journey setup, expectRefusal, function args, a throwing args and actArgs. Pure Node over the
// package's own playback.js. Written by the test stage against the built code.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { applyStep, baseOf, stateAt } from '../../lib/prototype/browser/playback.js';

const FIXTURES = {
	default: { grants: [], seq: 0 },
	'two-grants': { grants: [{ id: 'G-1', status: 'draft' }, { id: 'G-2', status: 'submitted' }], seq: 2 },
};
function fakeStore() {
	let state = structuredClone(FIXTURES.default);
	const log = [];
	return {
		log,
		loadFixture(n) { if (!FIXTURES[n]) return false; state = structuredClone(FIXTURES[n]); return true; },
		list: (kind) => (kind === 'grants' ? state.grants.map((g) => ({ ...g })) : []),
		act(name, args) {
			log.push([name, args]);
			if (name === 'create') { state.grants.push({ id: `G-${++state.seq}`, status: 'draft', owner: args.actor }); return { ok: true }; }
			const g = state.grants.find((x) => x.id === args.id);
			if (name === 'submit') { if (g?.status === 'draft') { g.status = 'submitted'; return { ok: true }; } return { ok: false, rule: 'NW-R-001', reason: 'not a draft' }; }
			if (name === 'approve') { if (g?.status === 'submitted') { g.status = 'approved'; return { ok: true }; } return { ok: false, rule: 'NW-R-002', reason: 'not submitted' }; }
			return { ok: false, reason: `unknown ${name}` };
		},
		snapshot: () => JSON.stringify(state),
		restore(s) { state = JSON.parse(s); },
	};
}
const MOD = {
	key: 'np-grant-flow',
	steps: [
		{ user: 'U-dana', action: { name: 'create', args: {} } },
		{ user: 'U-dana', action: { name: 'submit', args: (s) => ({ id: s.list('grants').at(-1).id }) } },
		{ setup: 'two-grants' },
		{ action: { name: 'submit', args: { id: 'G-2' } }, expectRefusal: true },
		{ action: [{ name: 'approve', args: () => ({ id: 'G-2' }) }, { name: 'create', args: {} }] },
		{ action: { name: 'submit', args: () => { throw new Error('boom'); } } },
	],
};

describe('held-out: replay is deterministic', () => {
	test('case 1: forward application and stateAt agree at every index', () => {
		for (let i = 0; i < MOD.steps.length; i++) {
			const A = fakeStore(); A.loadFixture('default');
			for (let k = 0; k <= i; k++) applyStep(A, MOD.steps[k], { mod: MOD });
			const B = fakeStore(); stateAt(B, MOD, i);
			assert.equal(B.snapshot(), A.snapshot(), `step index ${i}`);
		}
	});

	test('case 2: baseOf names the journey fixture before a setup and the setup after it', () => {
		assert.equal(baseOf(MOD, 1).fixture, 'default');
		assert.equal(baseOf(MOD, 4).fixture, 'two-grants');
	});

	test('case 3: expectRefusal turns the store\'s refusal into a pass; without it the step fails', () => {
		const s = fakeStore(); s.loadFixture('two-grants');
		const [r] = applyStep(s, MOD.steps[3]);
		assert.equal(r.refused, true); assert.equal(r.rule, 'NW-R-001');
		assert.equal(r.ok, true); assert.equal(r.expected, true);
		const t = fakeStore(); t.loadFixture('two-grants');
		const { expectRefusal, ...plain } = MOD.steps[3];
		assert.equal(applyStep(t, plain)[0].ok, false);
	});

	test('case 4: a throwing args is one refused result naming the throw, never an exception', () => {
		const s = fakeStore(); s.loadFixture('default');
		let res;
		assert.doesNotThrow(() => { res = applyStep(s, MOD.steps[5]); });
		assert.equal(res.length, 1);
		assert.equal(res[0].ok, false); assert.equal(res[0].refused, true);
		assert.match(String(res[0].reason), /boom/);
		assert.doesNotThrow(() => stateAt(fakeStore(), MOD, 5));
	});

	test('case 5a: actArgs is spread after { actor: step.user }', () => {
		const s = fakeStore(); s.loadFixture('default');
		applyStep(s, MOD.steps[0], { actArgs: () => ({ org: 'northwind', actor: 'U-other' }) });
		const create = s.log.find(([n]) => n === 'create');
		assert.equal(create[1].org, 'northwind'); assert.equal(create[1].actor, 'U-other');
	});

	test('case 5b: the step\'s own args win over actArgs', () => {
		const s = fakeStore(); s.loadFixture('two-grants');
		applyStep(s, MOD.steps[4], { actArgs: () => ({ id: 'G-X' }) });
		const approve = s.log.find(([n]) => n === 'approve');
		assert.equal(approve[1].id, 'G-2', `logged approve args: ${JSON.stringify(approve[1])}`);
	});

	test('case 6: stateAt twice on the same store rebuilds, never accumulates', () => {
		const B = fakeStore();
		stateAt(B, MOD, 3); const first = B.snapshot();
		stateAt(B, MOD, 3); assert.equal(B.snapshot(), first);
	});
});
