#!/usr/bin/env node
// The edit walk (cr-modules-005 lines 4 and 5) on the synthetic Northwind workspace, in headless Chromium:
//   1. a record edited on its page lands on disk byte-for-byte as `dt set` writes it — git shows one record file
//   2. a write the engine refuses shows the engine's own sentence on the page, and nothing is written
//   3. a record held by the git_modules layer, edited on its page, lands in the layer's clone
//   4. renaming that record is refused by the engine naming the layer (asked from the signed-in page: the
//      record page offers no rename gesture, so the refusal is the API's answer to the page's session)
//   5. a record written from a terminal with `dt set` re-renders the open list within 5 s, with no reload
// usage: node modules/web/test/walk/edit-walk.mjs        (DT_WEB_APP_DIR, DT_ENGINE_DIR, DT_WALK_SHOTS optional)
import fs from 'node:fs';
import path from 'node:path';
import { appDir, browser, checks, go, northwind, serve, shot, signedIn } from './support.mjs';

appDir();
const { ok, done } = checks();
const f = await northwind();
const s = await serve(f.root);
// at Admin (cr-modules-017 levels): step 4 asks the engine for a rename, an Admin route — below it the level refuses first
s.run('open', '--admin');
const b = await browser();
const status = (cwd = f.root) => f.git(['status', '--porcelain'], cwd);
const RECORD = 'data/projects/northwind-launch.project.md';
try {
	const { page, errors } = await signedIn(b, s.url);

	// 1 — an edit on the page, then the same edit by dt set on the original bytes: the two files are equal
	await go(page, '/content/projects/northwind-launch');
	await page.click('button[title="Edit"]');
	await page.fill('[data-field="name"] input', 'Northwind launch, phase two');
	await page.click('button[title="Save"]');
	await page.waitForSelector('button[title="Edit"]', { timeout: 10_000 });
	const changed = status();
	ok(changed === `M ${RECORD}`, 'git shows exactly one record file changed', JSON.stringify(changed));
	const fromPage = fs.readFileSync(path.join(f.root, RECORD), 'utf8');
	f.git(['checkout', '--', RECORD]);
	const set = f.dt('set', 'projects/northwind-launch', '--name', 'Northwind launch, phase two');
	ok(set.status === 0, 'dt set of the same value', `exit ${set.status}`);
	const fromSet = fs.readFileSync(path.join(f.root, RECORD), 'utf8');
	const strip = (t) => t.replace(/^(last-modified|updated|modified)[^\n]*\n/gm, '');
	ok(strip(fromPage) === strip(fromSet), 'the page wrote what dt set writes', fromPage === fromSet ? 'byte-identical' : 'identical but for the modified stamp');
	const check = f.dt('check');
	ok(check.status === 0, 'dt check passes after the edit', `exit ${check.status}`);
	f.git(['checkout', '--', RECORD]);
	await page.screenshot({ path: shot('edit-walk-saved') });

	// 2 — the engine's refusal on the page; nothing written
	await go(page, '/content/projects/harbor-mutual-renewal');
	await page.click('button[title="Edit"]');
	await page.fill('[data-field="name"] input', '');
	await page.click('button[title="Save"]');
	const line = await page.waitForSelector('.dt-detail-error', { timeout: 10_000 }).then((e) => e.textContent(), () => '');
	ok(/must have required property 'name'/.test(line) && /nothing was written/.test(line), "the engine's refusal is on the page", JSON.stringify(line.trim()));
	ok(status() === '', 'the refused write changed no file', JSON.stringify(status()));
	await page.screenshot({ path: shot('edit-walk-refused') });
	page.once('dialog', (d) => d.accept());
	await page.click('button[title="Cancel"]');

	// 3 — a layer record's edit lands in the layer's clone, and nothing in the workspace's own repo
	await go(page, '/content/projects/harbor-mutual-archive');
	await page.click('button[title="Edit"]');
	await page.fill('[data-field="name"] input', 'Harbor Mutual archive, 2019');
	await page.click('button[title="Save"]');
	await page.waitForSelector('button[title="Edit"]', { timeout: 10_000 });
	const inLayer = status(f.layer);
	ok(inLayer === "M data/projects/harbor-mutual-archive.project.md", "the layer record's edit landed in the layer's clone", JSON.stringify(inLayer));
	ok(/Harbor Mutual archive, 2019/.test(fs.readFileSync(path.join(f.layer, 'data', 'projects', 'harbor-mutual-archive.project.md'), 'utf8')), 'with the new value');
	ok(status() === '', "the workspace's own repo is unchanged", JSON.stringify(status()));

	// 4 — renaming the layer's record: the engine refuses, naming the layer
	const menu = await (async () => { await page.click('button[title="More actions"]'); const items = await page.$$eval('[role=menuitem]', (e) => e.map((x) => x.textContent.trim())); await page.keyboard.press('Escape'); return items; })();
	console.log(`  the record page's actions: ${JSON.stringify(menu)} (no rename gesture)`);
	const rename = await page.evaluate(async () => {
		const r = await fetch('/api/collections/projects/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ old: 'harbor-mutual-archive', new: 'harbor-mutual-history' }) });
		return { status: r.status, text: await r.text() };
	});
	ok(rename.status === 400 && /held by layer northwind-archive/.test(rename.text), 'a rename of the layer record is refused, naming the layer', `${rename.status} ${rename.text.slice(0, 160)}`);
	ok(fs.existsSync(path.join(f.layer, 'data', 'projects', 'harbor-mutual-archive.project.md')), 'the layer record did not move');

	// 5 — a terminal write re-renders the open list without a reload
	await go(page, '/content/projects');
	await page.evaluate(() => { window.__walkNoReload = true; });
	const t0 = Date.now();
	const term = f.dt('set', 'projects/harbor-mutual-renewal', '--name', 'Harbor Mutual renewal 2027');
	ok(term.status === 0, 'dt set from a terminal', `exit ${term.status}`);
	const seen = await page.waitForFunction(() => document.body.innerText.includes('Harbor Mutual renewal 2027'), null, { timeout: 5_000 }).then(() => Date.now() - t0, () => null);
	ok(seen !== null, 'the list shows the terminal write within 5 s', seen === null ? 'not within 5000 ms' : `${seen} ms`);
	ok(await page.evaluate(() => window.__walkNoReload === true), 'with no reload');
	await page.screenshot({ path: shot('edit-walk-live') });

	const real = errors.filter((e) => !/status of 400/.test(e));
	ok(real.length === 0, 'no page errors besides the refusals the walk asked for', JSON.stringify(real.slice(0, 3)));
} finally {
	await b.close();
	await s.stop();
	f.cleanup();
}
process.exit(done());
