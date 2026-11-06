// Fixtures for the change-request stage tests: one request per lifecycle state, and the mirrors settled.
import assert from 'node:assert';
import { put, run } from './rnd-workspace.mjs';

export const T = '2026-03-02T10:00:00+02:00';
export const STATES = ['design', 'design-review', 'acceptance', 'plan', 'plan-review', 'implement', 'code-review', 'test', 'test-review', 'deploy', 'live-check', 'done', 'rejected'];

/** One request per lifecycle state, `<prefix>-<state>`, each carrying `stageOf(state)` (undefined: none). */
export function seedStates(root, { prefix = 's', stageOf = (s) => s, states = STATES } = {}) {
	put(root, 'data/rnd/products/p.product.md', '---\nname: P\n---\n');
	put(root, 'data/rnd/design-docs/2026-01-01--dd-draft.design-doc.md', '---\nname: d\nstatus: draft\n---\n');
	put(root, 'data/rnd/design-docs/2026-01-01--dd-active.design-doc.md', '---\nname: d\nstatus: active\n---\n');
	const plan = (id, cr, extra) => put(root, `data/rnd/implementation-plans/2026-01-01--${id}.implementation-plan.md`, `---\nname: ${id}\nchange_request: rnd/change-requests/${cr}\n${extra}---\n`);
	const facts = {
		design: 'status: suggested\n',
		'design-review': 'status: suggested\ndesign_docs:\n  - rnd/design-docs/2026-01-01--dd-draft\n',
		acceptance: 'status: suggested\ndesign_docs:\n  - rnd/design-docs/2026-01-01--dd-active\n',
		plan: `status: accepted\naccepted_on: '${T}'\ndesign_docs:\n  - rnd/design-docs/2026-01-01--dd-active\n`,
		rejected: 'status: rejected\ndesign_docs:\n  - rnd/design-docs/2026-01-01--dd-active\n',
	};
	for (const s of ['plan-review', 'implement', 'code-review', 'test', 'test-review', 'deploy', 'live-check', 'done']) facts[s] = facts.plan;
	const planOf = { 'plan-review': 'status: draft\n', implement: 'status: approved\n', 'code-review': 'status: done\n' };
	for (const s of ['test', 'test-review', 'deploy', 'live-check', 'done']) planOf[s] = `status: done\ncode_approved_on: '${T}'\n`;
	const dates = { 'test-review': `tested_on: '${T}'\n`, deploy: `tested_on: '${T}'\nverified_on: '${T}'\n` };
	dates['live-check'] = dates.deploy + `deployed_on: '${T}'\ntags:\n  - deployed\n`;
	dates.done = dates['live-check'];
	for (const s of states) {
		const id = `${prefix}-${s}`;
		let f = facts[s] + (dates[s] ?? '');
		if (s === 'done') f = f.replace('status: accepted', 'status: implemented');
		const stage = stageOf(s);
		put(root, `data/rnd/change-requests/${id}.change-request.md`, `---\nkey: ${id}\nname: ${id}\nproducts:\n  - rnd/products/p\n${f}${stage ? `stage: ${stage}\n` : ''}---\n`);
		if (planOf[s]) plan(`plan-${id}`, id, planOf[s]);
		if (s === 'test-review') put(root, `data/rnd/tests/t-${id}.test.md`, `---\nkey: t-${id}\nname: t\nstatus: passing\ncovers:\n  - rnd/change-requests/${id}\n---\n`);
	}
}
/** Regenerate the mirrors the seeded records feed, so `dt check` judges only what a test wrote. */
export function settleAll(root, runner = run) {
	for (const c of ['rnd/products', 'rnd/change-requests', 'rnd/design-docs', 'rnd/implementation-plans', 'rnd/tests']) {
		const r = runner(root, ['relations', 'rebuild', c]);
		assert.equal(r.status, 0, `relations rebuild ${c}: ${r.stderr}${r.stdout}`);
	}
}
