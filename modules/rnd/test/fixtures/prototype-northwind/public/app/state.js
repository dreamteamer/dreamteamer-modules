// The demo world: named mutations only. `approve` refuses an application that is not submitted.
const FIXTURES = { default: () => ({ apps: [], notes: [] }), late: () => ({ apps: [{ id: 'A-9', status: 'submitted', by: 'U-applicant' }], notes: [] }) };
const USERS = [{ id: 'U-applicant', name: 'Dana Oren', portal: 'gp' }, { id: 'U-officer', name: 'Sam Diaz', portal: 'bo' }];
let world = FIXTURES.default(); let fixture = 'default';
const listeners = new Set();
const emit = () => { for (const f of listeners) f(); };
const M = {
	submit: (a) => { world.apps.push({ id: `A-${world.apps.length + 1}`, status: 'submitted', by: a.actor }); return { ok: true }; },
	approve: (a) => { const x = world.apps.find((y) => y.id === a.id); if (!x || x.status !== 'submitted') return { ok: false, rule: 'GRT-R-010', reason: 'Nothing to approve' }; x.status = 'approved'; x.by = a.actor; return { ok: true }; },
	note: (a) => { world.notes.push(a.text); return { ok: true }; },
};
export const store = {
	act(name, args = {}) { const f = M[name]; if (!f) return { ok: false, reason: `unknown ${name}` }; const r = f(args); emit(); return r; },
	loadFixture(n) { if (!FIXTURES[n]) return false; world = FIXTURES[n](); fixture = n; emit(); return true; },
	snapshot: () => JSON.stringify({ world, fixture }),
	restore(s) { const o = JSON.parse(s); world = o.world; fixture = o.fixture; emit(); },
	user: (id) => USERS.find((u) => u.id === id) || null,
	get world() { return world; },
	onChange: (f) => listeners.add(f),
};
const signedIn = { gp: 'U-applicant', bo: 'U-officer' };
export const session = { set(portal, id) { if (portal) signedIn[portal] = id; }, user: (portal) => signedIn[portal] };
export const mutationNames = () => Object.keys(M);
export const fixtureNames = () => Object.keys(FIXTURES);
