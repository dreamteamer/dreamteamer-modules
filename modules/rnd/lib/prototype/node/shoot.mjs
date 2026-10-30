// `npx dt-prototype shoot [--only k,k] [--portal p] [--out dir]` — one screenshot per registered screen of the
// prototype's portals, the portal's default user signed in and the metadata layer off. The default output is
// tools/out/shots/<portal>/<key>.png; whether that folder is committed is the prototype's choice.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { serve } from './serve.mjs';
import { chromium } from './devdep.mjs';
import { screensToVisit, visit } from './walk.mjs';

export async function run(dir, { only = null, portal = null, out = null, port = null, log = console.log, error = console.error } = {}) {
	const c = await loadConfig(dir);
	const outDir = path.resolve(c.dir, out ?? path.join('tools', 'out', 'shots'));
	const pw = await chromium(c.dir); const srv = await serve(c, port);
	let browser; try { browser = await pw.launch(); } catch (e) { srv.stop(); throw e; }
	const written = []; const failures = [];
	try {
		const page = await browser.newPage({ viewport: c.viewport, ...(c.locale ? { locale: c.locale } : {}) });
		let errs = [];
		page.on('pageerror', (e) => errs.push((e.message || String(e)).split('\n')[0]));
		const list = (await screensToVisit(page, srv.base, c, only)).filter((s) => !portal || s.portal === portal);
		for (const s of list) {
			errs = []; await visit(page, c, s);
			const f = path.join(outDir, s.portal ?? 'none', `${s.key}.png`);
			fs.mkdirSync(path.dirname(f), { recursive: true });
			await page.screenshot({ path: f, fullPage: true });
			written.push(f);
			for (const e of errs) failures.push(`${s.key}: ${e}`);
		}
	} finally { await browser.close(); srv.stop(); }
	for (const f of failures) error(`FAIL ${f}`);
	log(`${written.length} screenshot(s) in ${path.relative(c.dir, outDir) || '.'}`);
	return failures.length ? 1 : 0;
}
