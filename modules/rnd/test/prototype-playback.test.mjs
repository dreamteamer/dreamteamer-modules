// playback.js — the store side of the player, with no DOM. What a fixture pins with a fake store: forward
// application lands where a rebuild does at every index, a mid-journey setup rebases, expectRefusal inverts,
// actArgs returns the args actually used, function args see the store, a throwing
// args is a refused result, and the session's view is cleared before a fixture loads.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { actionsOf, setupOf, applyStep, baseOf, stateAt } from '../lib/prototype/browser/playback.js';

/** A store with three named mutations, two fixtures, and a refusal: `approve` before `submit` is refused. */
function fakeStore() {
	const FIX = { default: { apps: [], log: [] }, late: { apps: [{ id: 'A-9', status: 'submitted' }], log: ['late'] } };
	let w = structuredClone(FIX.default);
	return {
		calls: [],
		act(name, args) {
			this.calls.push([name, args]);
			if (name === 'submit') { w.apps.push({ id: `A-${w.apps.length + 1}`, status: 'submitted', by: args.actor }); w.log.push(`submit ${args.actor}`); return { ok: true }; }
			if (name === 'approve') { const a = w.apps.find((x) => x.id === args.id); if (!a || a.status !== 'submitted') return { ok: false, rule: 'GRT-R-010', reason: 'nothing to approve' }; a.status = 'approved'; w.log.push(`approve ${a.id}`); return { ok: true }; }
			if (name === 'note') { w.log.push(`note ${args.org ?? '-'} ${args.text}`); return { ok: true }; }
			return { ok: false, reason: `unknown ${name}` };
		},
		loadFixture(n) { if (!FIX[n]) return false; w = structuredClone(FIX[n]); return true; },
		snapshot: () => JSON.stringify(w),
		restore(s) { w = JSON.parse(s); },
		world: () => w,
	};
}
const MOD = {
	key: 'apply-and-approve',
	steps: [
		{ user: 'U-applicant', action: { name: 'submit', args: {} } },
		{ user: 'U-officer', action: { name: 'approve', args: (s) => ({ id: s.world().apps.at(-1).id }) } },
		{ user: 'U-officer', action: { name: 'approve', args: { id: 'A-1' } }, expectRefusal: true },
		{ user: 'U-officer', setup: 'late', action: [{ name: 'approve', args: { id: 'A-9' } }, { name: 'note', args: { text: 'done' } }] },
		{ user: 'U-officer', action: { name: 'note', args: { text: 'closed' } } },
	],
};

describe('the step helpers', () => {
	test('actionsOf takes one object or a list; setupOf a name or { fixture }', () => {
		assert.deepEqual(actionsOf({ action: { name: 'a' } }), [{ name: 'a' }]);
		assert.deepEqual(actionsOf({ action: [{ name: 'a' }, null, { name: 'b' }] }), [{ name: 'a' }, { name: 'b' }]);
		assert.deepEqual(actionsOf({}), []);
		assert.equal(setupOf({ setup: 'late' }), 'late'); assert.equal(setupOf({ setup: { fixture: 'late' } }), 'late'); assert.equal(setupOf({}), null);
	});
	test('baseOf is the latest setup at or before the step, else the module fixture, else default', () => {
		assert.deepEqual(baseOf(MOD, 2), { from: 0, fixture: 'default' });
		assert.deepEqual(baseOf(MOD, 4), { from: 3, fixture: 'late' });
		assert.deepEqual(baseOf({ fixture: 'late', steps: [{}] }, 0), { from: 0, fixture: 'late' });
	});
});

describe('applyStep', () => {
	test('acts as the step user; actArgs(step, action, args, store) returns the args used; results named', () => {
		const st = fakeStore();
		const seen = [];
		const actArgs = (step, action, args, store) => { seen.push([step.user, action.name, store === st]); return { org: step.org ?? 'north', ...args, text: args.text === '$last' ? 'resolved' : args.text }; };
		const r = applyStep(st, { user: 'U-x', action: { name: 'note', args: { text: '$last' } } }, { actArgs });
		assert.deepEqual(st.calls[0], ['note', { actor: 'U-x', org: 'north', text: 'resolved' }]);
		assert.deepEqual(seen, [['U-x', 'note', true]]);
		assert.deepEqual(r, [{ name: 'note', ok: true, refused: false, rule: null, reason: null, expected: false }]);
	});
	test('expectRefusal passes when the store refuses, and fails when it accepts', () => {
		const st = fakeStore();
		assert.equal(applyStep(st, { user: 'U', action: { name: 'approve', args: { id: 'none' } }, expectRefusal: true })[0].ok, true);
		applyStep(st, { user: 'U', action: { name: 'submit' } });
		const r = applyStep(st, { user: 'U', action: { name: 'approve', args: { id: 'A-1' } }, expectRefusal: true })[0];
		assert.deepEqual([r.ok, r.refused, r.expected], [false, false, true]);
	});
	test('a throwing args is a refused result naming the error, never an exception', () => {
		const r = applyStep(fakeStore(), { user: 'U', action: { name: 'approve', args: () => { throw new Error('no application'); } } });
		assert.equal(r[0].ok, false); assert.match(String(r[0].reason), /no application/);
	});
	test('a setup clears the session view and loads its fixture; a fixture that does not load is a failed result', () => {
		const st = fakeStore(); const cleared = [];
		const session = { clearView: () => cleared.push(1) };
		applyStep(st, { user: 'U', setup: 'late' }, { session });
		assert.equal(cleared.length, 1); assert.equal(st.world().apps[0].id, 'A-9');
		const r = applyStep(st, { user: 'U', setup: 'missing' });
		assert.deepEqual([r[0].name, r[0].ok], ['setup:missing', false]);
	});
});

describe('stateAt', () => {
	test('step-by-step forward application equals a rebuild, at every index', () => {
		const fwd = fakeStore(); fwd.loadFixture('default');
		for (let i = 0; i < MOD.steps.length; i++) {
			const res = applyStep(fwd, MOD.steps[i]);
			assert.ok(res.every((x) => x.ok), `step ${i + 1}: ${JSON.stringify(res)}`);
			const re = fakeStore(); const s = stateAt(re, MOD, i);
			assert.deepEqual(s.failures, []);
			assert.equal(re.snapshot(), fwd.snapshot(), `step ${i + 1}`);
		}
	});
	test('results carry their step number; the fixture loaded is reported', () => {
		const s = stateAt(fakeStore(), MOD, 4);
		assert.equal(s.fixture, 'late');
		assert.deepEqual(s.results.map((r) => r.step), [4, 4, 5]);
	});
	test('a session without clearView is fine', () => {
		assert.doesNotThrow(() => stateAt(fakeStore(), MOD, 3, { session: {} }));
	});
});
