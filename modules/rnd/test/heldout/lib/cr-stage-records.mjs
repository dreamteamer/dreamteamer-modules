// Records for the change-request stage's held-out tests — written by the test stage, independent of the
// builder's fixtures (test/helpers/cr-stage-fixtures.mjs and layeredWorkspace are not used here).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { put, run } from '../../helpers/rnd-workspace.mjs';

export const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const T = '2026-02-02T10:00:00+02:00';
export const product = (r) => put(r, 'data/rnd/products/p.product.md', '---\nname: P\n---\n');
export const doc = (r, slug, status) => put(r, `data/rnd/design-docs/2026-02-01--${slug}.design-doc.md`, `---\nname: ${slug}\nstatus: ${status}\n---\n`);
export const docRef = (slug) => `rnd/design-docs/2026-02-01--${slug}`;
export const plan = (r, slug, cr, status) => put(r, `data/rnd/implementation-plans/2026-02-01--${slug}.implementation-plan.md`, `---\nname: ${slug}\nchange_request: rnd/change-requests/${cr}\nstatus: ${status}\n---\n`);
export const req = (r, id, lines) => put(r, `data/rnd/change-requests/${id}.change-request.md`, `---\nkey: ${id}\nname: ${id}\nproducts:\n  - rnd/products/p\n${lines.filter(Boolean).join('\n')}\n---\n`);
export const reqFile = (r, id) => path.join(r, `data/rnd/change-requests/${id}.change-request.md`);
export function settle(r, extra = []) {
	for (const c of ['rnd/products', 'rnd/change-requests', 'rnd/design-docs', 'rnd/implementation-plans', 'rnd/tests']) {
		const x = run(r, ['relations', 'rebuild', c, ...extra]);
		assert.equal(x.status, 0, `relations rebuild ${c}: ${x.stderr}${x.stdout}`);
	}
}
export const stageLines = (out) => out.split('\n').filter((l) => /— stage /.test(l));
export const linesFor = (out, id) => stageLines(out).filter((l) => l.includes(`/${id}.change-request.md`));
/** The workspace's own copy of the migration, run as a person runs it. */
export function migrate(ws, { cwd = ws, args = [] } = {}) {
	const r = spawnSync(process.execPath, [path.join(ws, 'modules/rnd/bin/migrate-change-request-stage.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
export const accepted = [`status: accepted`, `accepted_on: '${T}'`];
export const designs = (...slugs) => ['design_docs:', ...slugs.map((s) => `  - ${docRef(s)}`)].join('\n');
export const bytes = (f) => fs.readFileSync(f);
