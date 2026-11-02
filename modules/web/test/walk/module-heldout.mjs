#!/usr/bin/env node
// cr-modules-008 held-out h1-h8 (and t13), dt web half: the held-out fixture modules on dt web in headless Chrome.
// usage: node modules/web/test/walk/module-heldout.mjs  → one ✔/✖ line per expectation, exit 1 when any fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { appDir, browser, checks, go, northwind, serve, shot, signedIn } from './support.mjs';
import { addHeldout } from './heldout-fixture.mjs';

const { ok, done } = checks();
appDir();
const f = await northwind();
addHeldout(f);
const settings = path.join(f.root, '.vscode', 'settings.json');
const GRANT = { pattern: { reads: ['collections', 'other-items', 'tasks'], writes: ['collections', 'other-items', 'tasks', 'pattern-items'] }, probe2: { reads: ['projects', 'pattern-items'] } };
fs.mkdirSync(path.dirname(settings), { recursive: true });
fs.writeFileSync(settings, JSON.stringify({ 'dreamteamer.moduleApps': GRANT }));
const layer = path.join(f.root, 'git_modules', 'northwind-archive');
const status = (cwd) => execFileSync('git', ['status', '--porcelain', '--', 'data'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const head = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const before = { root: head(f.root), layer: head(layer), layerStatus: status(layer).join() };
const b = await browser();
const s = await serve(f.root);
const frameData = async (page, title, key = 'done', ms = 30_000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		for (const el of await page.$$(`iframe[title="${title}"]`)) {
			const fr = await el.contentFrame(); if (!fr) continue;
			const d = await fr.evaluate(() => ({ ...document.body.dataset })).catch(() => ({}));
			if (d[key] !== undefined) return d;
		}
		await page.waitForTimeout(400);
	}
	const frames = [];
	for (const el of await page.$$('iframe')) { const fr = await el.contentFrame(); frames.push(`${await el.getAttribute('title')} ${await el.getAttribute('style')} ${fr ? fr.url().slice(-40) : '-'} ${fr ? JSON.stringify(await fr.evaluate(() => ({ ...document.body.dataset })).catch(() => ({}))).slice(0, 160) : ''}`); }
	console.log(`DEBUG no '${key}' in ${title} at ${page.url()}:\n  ` + frames.join('\n  ') + '\n  console: ' + (globalThis.__lines ?? []).slice(-8).join('\n  '));
	return {};
};
try {
	const { page, context } = await signedIn(b, s.url);
	const consoleLines = []; globalThis.__lines = consoleLines; page.on('console', (m) => consoleLines.push(m.text().slice(0, 240)));
	const apiReads = []; page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) apiReads.push(`${r.method()} ${u.pathname}`); });
	const outbound = []; context.on('requestfinished', (r) => { if (!/^(http:\/\/(127\.0\.0\.1|localhost)|blob:|data:)/.test(r.url())) outbound.push(r.url()); });
	await page.reload(); await page.waitForSelector('.dt-nav-row', { timeout: 30_000 }); await page.waitForTimeout(12_000);

	// h1 — bundles that are not one self-contained ES module
	for (const m of ['named-only', 'meta-url', 'chunked']) {
		const lines = consoleLines.filter((l) => l.startsWith(`[modules] module app ${m}`));
		ok(lines.length >= 1, `h1: ${m} — a [modules] line names the module and why`, JSON.stringify(lines).slice(0, 220));
		ok(lines.length === 1, `h1: ${m} — exactly one line (the held-out expectation)`, `${lines.length} lines`);
	}
	await go(page, '/content/named-items'); const listOk = await page.waitForSelector('table, .dt-table', { timeout: 5000 }).then(() => true, () => false);
	ok(listOk && !(await page.$('.dt-module-frame')), 'h1: the built-in list draws for a broken module\'s collection');

	// h2 + h6 — pattern's attempts
	await go(page, '/a/pattern');
	const p = await frameData(page, 'module app pattern');
	ok(p.done === '1', 'h2/h6: the pattern app ran', JSON.stringify(p).slice(0, 120));
	for (const c of ['collections', 'otheritems', 'tasks']) {
		ok(p[`h2read_${c}`]?.startsWith('403:') && /module app pattern cannot read/.test(p[`h2read_${c}`]), `h2: a granted read of ${c} is refused with the sentence`, p[`h2read_${c}`]?.slice(0, 120));
		ok(p[`h2write_${c}`]?.startsWith('403:'), `h2: a granted write of ${c} is refused`, p[`h2write_${c}`]?.slice(0, 120));
	}
	for (const k of ['dsource', 'id', 'created', 'stub']) {
		ok(p[`h6post_${k}`]?.startsWith('403:'), `h6: a create naming ${k.replace('d', '$')} is refused`, p[`h6post_${k}`]?.slice(0, 100));
		ok(p[`h6patch_${k}`]?.startsWith('403:'), `h6: a PATCH naming ${k.replace('d', '$')} is refused`, p[`h6patch_${k}`]?.slice(0, 100));
	}
	console.log('LAYER', p.h6layerpatch, p.h6layerdelete); ok(/held by northwind-archive/.test(p.h6layerpatch ?? '') && /held by northwind-archive/.test(p.h6layerdelete ?? ''), 'h6: PATCH and DELETE of the layer-held own record are refused', `${p.h6layerpatch?.slice(0, 80)} | ${p.h6layerdelete?.slice(0, 80)}`);
	ok(/cannot pass target on a write/.test(p.h6target ?? ''), 'h6: ?target= on a create is refused', p.h6target?.slice(0, 100));
	ok(p.h6clean?.startsWith('200:'), 'h6: a clean create still lands', p.h6clean?.slice(0, 100));

	// h3 — two module surfaces on one record page
	await go(page, '/content/pattern-items/pattern-one'); await page.waitForTimeout(1500);
	const pe = await frameData(page, 'module app pattern', 'h3save');
	const pr = await frameData(page, 'module app probe2', 'h3write');
	ok(pr.h3write?.startsWith('403:'), 'h3: probe\'s write of pattern\'s collection is refused (event.source decides)', pr.h3write?.slice(0, 120));
	ok(Number(pr.h3flood429) > 0, 'h3: probe\'s flood gets 429 beyond 4 in flight', pr.h3flood429);
	ok(pe.h3read?.startsWith('200:') && pe.h3save?.startsWith('200:'), 'h3: pattern\'s read and save succeed with no 429 (its bounds are its own)', `${pe.h3read?.slice(0, 30)} | ${pe.h3save?.slice(0, 60)}`);
	const t0 = Date.now(); await go(page, '/content/projects'); const t1 = Date.now() - t0;
	ok(t1 < 2800, 'h3: the editor stays responsive', `${t1} ms (incl. 800 ms settle)`);

	// h4 + h5 — markup and escape scripts inside probe2's frame
	await go(page, '/a/probe2');
	const q = await frameData(page, 'module app probe2', 'h4marker', 20_000);
	ok(q.h4marker === 'none' && q.h4location === q.h4location2, 'h4: no injected handler, javascript: link or meta refresh ran or navigated', `${q.h4marker} ${q.h4location} → ${q.h4location2}`);
	ok(q.h5integrity === 'refused' && q.h5nonce === 'refused' && q.h5data === 'refused', 'h5: the integrity, nonce and data: scripts are refused', `${q.h5integrity} ${q.h5nonce} ${q.h5data}`);
	ok(q.h5blobfetch === 'failed', 'h5: fetching remote text for a blob fails', q.h5blobfetch);
	ok(q.h5commit?.startsWith('403:'), 'h5: a locally minted script has no more reach — commit 403', q.h5commit?.slice(0, 80));
	const pf = await (await page.$('iframe[title="module app probe2"]:not([style*="display: none"])'))?.contentFrame();
	const urlBefore = pf?.url();
	await pf?.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<meta http-equiv="refresh" content="0;url=https://example.com/">'; document.body.appendChild(d); }).catch(() => {});
	await page.waitForTimeout(3000);
	const now = await Promise.all((await page.$$('iframe[title="module app probe2"]:not([style*="display: none"])')).map(async (e) => (await e.contentFrame())?.url() ?? ''));
	ok(now.length === 1 && now[0] === urlBefore, 'h4: after an inserted meta refresh the surface is on its own document again (dropped and rebuilt), and nothing left the machine', `${urlBefore?.slice(-30)} → ${JSON.stringify(now.map((u) => u.slice(-30)))}`);
	await go(page, '/content/probe-items'); await page.waitForTimeout(2500);
	const cells = await page.$$eval('.dt-module-cell', (es) => es.slice(0, 5).map((e) => e.innerHTML));
	ok(cells.length > 0 && cells.every((h) => !/\son\w+=|href=|style=|class=/i.test(h)), 'h4: the list cell view is sanitized — no on*, href, style or class', JSON.stringify(cells.slice(0, 2)).slice(0, 200));

	// h7 — 1000 rows, record_title through an ungranted… (probe2 is granted projects: the snapshot must still resolve nothing)
	const mark = apiReads.length;
	await go(page, '/probe-list'); await page.waitForTimeout(3000);
	let l = await frameData(page, 'module app probe2', 'h7rows', 15_000);
	for (let i = 0; i < 60 && !(Number(l.h7rows) > 0); i++) { await page.waitForTimeout(500); l = await frameData(page, 'module app probe2', 'h7rows', 2_000); }
	if (!(Number(l.h7rows) > 0)) { console.log('H7DEBUG', page.url(), JSON.stringify(l).slice(0, 200)); console.log('  ' + consoleLines.slice(-10).join('\n  ')); for (const el of await page.$$('iframe')) console.log('  frame', await el.getAttribute('title'), (await el.contentFrame())?.url().slice(-30)); }
	const titleReads = apiReads.slice(mark).filter((x) => /\/collections\/projects\/records\/./.test(x));
	ok(Number(l.h7rows) > 0 && /projects\//.test(l.h7titles ?? '') , 'h7: the snapshot carries raw reference ids in titles', `${l.h7rows} rows; ${l.h7titles?.slice(0, 120)}`);
	ok(titleReads.length === 0, 'h7: no read of the referenced HQ collection to title the rows', JSON.stringify(titleReads.slice(0, 3)));
	ok(l.h7keys === 'clean', 'h7: no non-own commit keys on any row');
	const t2 = Date.now(); await go(page, '/content/projects/harbor-mutual-renewal'); const t3 = Date.now() - t2;
	ok(t3 < 2800, 'h7: opening a record after the 1000-row list renders within 2 s', `${t3} ms (incl. 800 ms settle)`);
	ok(outbound.length === 0, 'h4/h5: no request left the machine', JSON.stringify(outbound.slice(0, 3)));

	// h8 — a bundle change under an open form
	await go(page, '/content/pattern-items/pattern-one'); await page.waitForTimeout(1500);
	fs.writeFileSync(path.join(f.root, 'modules', 'pattern', 'ui', 'app.js'), fs.readFileSync(path.join(f.root, 'modules', 'pattern', 'ui', 'app.js'), 'utf8') + '\n// changed\n');
	f.dt('compile'); await page.waitForTimeout(4000);
	ok(/module app updated/i.test(await page.content()), 'h8: the bundle change shows the "module app updated — reload" notice');

	// h2 — a malformed or wrongly typed settings file
	for (const [label, text] of [['unparsable', '{ "dreamteamer.moduleApps": {'], ['string', '{"dreamteamer.moduleApps": "all"}'], ['array', '{"dreamteamer.moduleApps": ["pattern"]}']]) {
		fs.writeFileSync(settings, text); const n = consoleLines.length;
		await page.reload(); const loaded = await page.waitForSelector('.dt-nav-row', { timeout: 30_000 }).then(() => true, () => false);
		const grants = await page.evaluate(() => window.__DT_MODULE_GRANTS__);
		ok(loaded && JSON.stringify(grants) === '{}', `h2: a ${label} settings file yields an empty grant and the editor loads`, JSON.stringify(grants));
		ok(consoleLines.slice(n).some((x) => /grant could not be read/i.test(x)), `h2: the page console says the ${label} grant could not be read`);
	}
	await page.screenshot({ path: shot('module-heldout') });

	// t13 — localhost and [::1]
	const port = new URL(s.url).port; const signIn = await s.signInUrl();
	const lp = await context.newPage(); globalThis.__lpLines = []; lp.on('console', (m) => globalThis.__lpLines.push(m.text().slice(0, 200))); lp.on('pageerror', (e) => globalThis.__lpLines.push('PAGEERROR ' + String(e).slice(0, 200))); await lp.goto(signIn.replace('127.0.0.1', 'localhost')); await lp.waitForSelector('.dt-nav-row', { timeout: 30_000 }).catch(() => {});
	fs.writeFileSync(settings, JSON.stringify({ 'dreamteamer.moduleApps': GRANT }));
	await lp.reload(); await lp.waitForSelector('.dt-nav-row', { timeout: 30_000 }).catch(() => {}); await lp.waitForTimeout(12_000); await lp.evaluate(() => { location.hash = '/a/pattern'; }); await lp.waitForTimeout(3000);
	const lpd = await frameData(lp, 'module app pattern', 'done', 20_000);
	if (lpd.done !== '1') console.log('LOCALHOST CONSOLE\n  ' + globalThis.__lpLines.slice(-12).join('\n  '));
	ok(lpd.done === '1', 't13: a module app renders when dt web is opened at localhost (Chrome may resolve it to ::1, which redirects to 127.0.0.1)', lp.url());
	const v6 = await context.newPage(); await v6.goto(`http://[::1]:${port}/`).catch(() => {});
	ok(v6.url().startsWith(`http://127.0.0.1:${port}/`), 't13: a page at [::1] is redirected to 127.0.0.1', v6.url());
} finally {
	await b.close();
	await s.stop();
	const changed = status(f.root);
	ok(head(f.root) === before.root && head(layer) === before.layer && status(layer).join() === before.layerStatus, 'h4/h6: HEAD of the HQ and the layer unchanged; the layer untouched');
	ok(changed.every((c) => /pattern-items\/(pattern-one|h6-clean)\./.test(c)), 'h3/h6: only pattern\'s granted save and clean create changed files', JSON.stringify(changed));
	f.cleanup();
}
process.exit(done());
