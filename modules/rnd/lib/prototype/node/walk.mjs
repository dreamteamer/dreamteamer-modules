// `npx dt-prototype walk [--only k,k]` — opens every registered screen of the prototype's portals with the
// metadata layer OFF and fails on a page error, or on visible text matching any regex in the prototype's
// `forbidden` file (one per line, `#` comments). The harness's own UI, `.meta-only`, `[data-meta]`, `code` and
// `[data-ident]` are not product copy and are skipped. The vocabulary is the prototype's; the walk is generic.
import fs from 'node:fs';
import { loadConfig } from './config.mjs';
import { serve } from './serve.mjs';
import { chromium } from './devdep.mjs';

export const SKIP = '.demo-fab, .demo-bar, .demo-guide, #meta-pane, .harness-toasts, .meta-only, [data-meta], code, pre, [data-ident], script, style';

/** the forbidden file → [RegExp], comments and blank lines skipped */
export function forbiddenOf(text) {
	return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new RegExp(l, 'u'));
}

/** the prototype's portal keys */
export const portalsOf = (c) => new Set(c.portal.from === 'product' ? Object.values(c.products).map((p) => p.key) : Object.values(c.portal.map ?? {}));

/** open the app, list the screens to visit (registered in a portal, routes without parameters) */
export async function screensToVisit(page, base, c, only = null) {
	await page.goto(`${base}#/`);
	await page.waitForFunction((app) => !!window[app]?.screens, c.app, { timeout: 15000 });
	const all = await page.evaluate((app) => window[app].screens.map((s) => ({ key: s.key, portal: s.portal ?? null, route: s.route ?? null, stub: !!s.stub, sample: s.sample?.id ?? null })), c.app);
	const portals = portalsOf(c);
	return all.filter((s) => s.route && portals.has(s.portal) && !s.route.includes(':') && (!only || only.includes(s.key)));
}

/** go to one screen as the portal's default user, layer off; resolves when it has rendered */
export async function visit(page, c, s) {
	await page.evaluate(({ app, s, user }) => {
		const A = window[app];
		document.documentElement.dataset.metalayer = 'off';
		if (user) A.session?.set?.(s.portal, user);
		const hash = `#${s.route}${s.sample ? `?id=${encodeURIComponent(s.sample)}` : ''}`;
		if (location.hash !== hash) location.hash = hash; else A.renderAll();
	}, { app: c.app, s, user: c.defaultUser?.[s.portal] ?? null });
	await page.waitForFunction(({ app, key }) => window[app].current()?.screen?.key === key, { app: c.app, key: s.key }, { timeout: 4000 }).catch(() => {});
	await page.evaluate(() => { document.documentElement.dataset.metalayer = 'off'; });
	await page.waitForTimeout(80);
}

export async function run(dir, { only = null, port = null, log = console.log, error = console.error } = {}) {
	const c = await loadConfig(dir);
	const rules = c.paths.forbidden && fs.existsSync(c.paths.forbidden) ? forbiddenOf(fs.readFileSync(c.paths.forbidden, 'utf8')) : [];
	const pw = await chromium(c.dir); const srv = await serve(c, port);
	let browser; try { browser = await pw.launch(); } catch (e) { srv.stop(); throw e; }
	const failures = []; let n = 0;
	try {
		const page = await browser.newPage({ viewport: c.viewport, ...(c.locale ? { locale: c.locale } : {}) });
		let errs = [];
		page.on('pageerror', (e) => errs.push(`pageerror: ${(e.message || String(e)).split('\n')[0]}`));
		page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text().split('\n')[0]}`); });
		const list = await screensToVisit(page, srv.base, c, only);
		for (const s of list) {
			errs = []; await visit(page, c, s); n++;
			const texts = await page.evaluate((skip) => {
				const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				for (let t = w.nextNode(); t; t = w.nextNode()) {
					const el = t.parentElement; const v = t.nodeValue.trim();
					if (!v || !el || el.closest(skip) || !el.checkVisibility()) continue;
					out.push(v);
				}
				return out;
			}, SKIP);
			for (const t of texts) for (const re of rules) if (re.test(t)) failures.push({ screen: s.key, kind: 'forbidden', detail: `«${t.slice(0, 90)}» matches /${re.source}/` });
			for (const e of errs) failures.push({ screen: s.key, kind: 'JS error', detail: e });
		}
	} finally { await browser.close(); srv.stop(); }
	for (const f of failures) error(`FAIL ${f.screen} [${f.kind}] ${f.detail}`);
	log(`${n} screens walked with the layer off · ${rules.length} forbidden pattern(s) · ${failures.length} failure(s)`);
	return failures.length ? 1 : 0;
}
