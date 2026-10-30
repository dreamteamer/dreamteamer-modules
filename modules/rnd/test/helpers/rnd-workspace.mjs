// A real engine workspace with rnd installed the copy way — shared by the prototype-harness tests that
// need `dt check` or `dt list --json` to run for real. Built once per process, copied per test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { virginWorkspace, installCopied, run, cleanup } from '../../../../tests/helpers/workspace.mjs';

export { run, cleanup };
let base = null;
const made = [];
export function rndWorkspace() {
	if (!base) {
		base = virginWorkspace();
		installCopied(base, ['rnd']);
		const c = run(base, ['compile']);
		if (c.status !== 0) throw new Error(`compile failed:\n${c.stderr}\n${c.stdout}`);
	}
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnd-ws-'));
	made.push(root);
	fs.cpSync(base, root, { recursive: true, verbatimSymlinks: true });
	return root;
}
export function cleanupAll() { for (const r of made.splice(0)) fs.rmSync(r, { recursive: true, force: true }); cleanup(); }
export function put(root, rel, text) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; }

/** The Northwind records every harness test starts from: two products, four screens, three stories, two roles. */
export function seedNorthwind(root) {
	put(root, 'data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
	put(root, 'data/rnd/products/back-office.product.md', '---\nname: Back office\n---\n');
	const screen = (key, product, route, extra = '') => put(root, `data/rnd/screens/${key}.screen.md`, `---\nkey: ${key}\nname: ${key}\nroute: ${route}\nsource: scope-required\nproduct: rnd/products/${product}\n${extra}---\n`);
	screen('gp-home', 'grantee-portal', '/gp/home');
	screen('gp-apply', 'grantee-portal', '/gp/apply', 'scope_rows:\n  - GRT-R-001\n  - GRT-R-002\n');
	screen('bo-review', 'back-office', '/bo/review', 'scope_rows:\n  - GRT-R-010\n');
	screen('bo-home', 'back-office', '/bo/home');
	put(root, 'data/rnd/personas/applicant.persona.md', '---\nname: Applicant\nkind: product-role\nkey: applicant\nproducts:\n  - rnd/products/grantee-portal\n---\n');
	put(root, 'data/rnd/personas/grant-officer.persona.md', '---\nname: Grant officer\nkind: product-role\nkey: grant-officer\nproducts:\n  - rnd/products/back-office\n---\n');
	const story = (key, screenKey, persona, extra = '') => put(root, `data/rnd/user-stories/2026-01-10--${key}.user-story.md`, `---\nkey: ${key}\nname: As a ${persona} I ${key.replace(/-/g, ' ')}\nscreen: rnd/screens/${screenKey}\npersonas:\n  - rnd/personas/${persona}\n${extra}---\n`);
	story('open-the-portal', 'gp-home', 'applicant');
	story('submit-an-application', 'gp-apply', 'applicant');
	story('review-the-application', 'bo-review', 'grant-officer');
}

/** Regenerate every generated mirror the seeded records feed, so `dt check` judges only what a test wrote. */
export function settle(root) {
	for (const c of ['rnd/products', 'rnd/screens', 'rnd/personas', 'rnd/user-journeys', 'rnd/user-stories', 'rnd/prototypes']) {
		const r = run(root, ['relations', 'rebuild', c]);
		if (r.status !== 0) throw new Error(`relations rebuild ${c}: ${r.stderr}${r.stdout}`);
	}
}
