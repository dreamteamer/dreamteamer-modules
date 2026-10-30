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
		fs.writeFileSync(path.join(base, 'package-lock.json'), '{}\n'); // a real workspace has one; the harness finds the workspace by it
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

/** the two Northwind journeys the harness tests play, with the stories listing them */
export function seedJourneys(ws) {
	put(ws, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md', `---
key: apply-for-a-grant
name: Apply for a grant
products:
  - rnd/products/grantee-portal
  - rnd/products/back-office
personas:
  - rnd/personas/applicant
steps:
  - screen: rnd/screens/gp-home
    story: rnd/user-stories/2026-01-10--open-the-portal
    persona: rnd/personas/applicant
    caption: The applicant sees their grants
  - screen: rnd/screens/gp-apply
    story: rnd/user-stories/2026-01-10--submit-an-application
    persona: rnd/personas/applicant
    scope_rows:
      - GRT-R-001
  - screen: rnd/screens/bo-review
    story: rnd/user-stories/2026-01-10--review-the-application
    persona: rnd/personas/grant-officer
  - screen: rnd/screens/bo-review
    system: true
    caption: Approving twice is refused
failures:
  - The application is approved twice
---
`);
	put(ws, 'data/rnd/user-journeys/see-the-home.user-journey.md', `---
key: see-the-home
name: See both homes
products:
  - rnd/products/grantee-portal
  - rnd/products/back-office
steps:
  - screen: rnd/screens/gp-home
    story: rnd/user-stories/2026-01-10--open-the-portal
    persona: rnd/personas/applicant
  - screen: rnd/screens/bo-home
    system: true
    caption: The back office is not built yet
---
`);
	for (const k of ['open-the-portal', 'submit-an-application', 'review-the-application']) {
		const f = path.join(ws, `data/rnd/user-stories/2026-01-10--${k}.user-story.md`);
		const extra = k === 'open-the-portal' ? '  - rnd/user-journeys/see-the-home\n' : '';
		fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n---\n$/, `\njourneys:\n  - rnd/user-journeys/apply-for-a-grant\n${extra}---\n`));
	}
}
