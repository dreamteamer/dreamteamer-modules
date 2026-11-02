#!/usr/bin/env node
// The workspace walk (cr-modules-005 line 4, on a real hq): dt-web over <workspace> from this checkout's bin,
// with nothing installed into the workspace, in headless Chromium:
//   - the sidebar's rows are GET /nav's labels, in order (top level and each folder opened once)
//   - a list, a record page and (when the nav names one) a board render with no page error
//   - no TRACKED file of the workspace changes, and its editor marker (.dreamteamer/editor.json) is
//     byte-identical before and after (dt web writes none — README § the editor marker)
// Live updates are walked on the synthetic fixture (edit-walk.mjs), never by writing this workspace's records.
// usage: node modules/web/test/walk/hq-walk.mjs <workspace>   (DT_WEB_APP_DIR, DT_WALK_SHOTS optional)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, browser, checks, go, serve, shot, signedIn } from './support.mjs';

const root = path.resolve(process.argv[2] ?? '.');
appDir();
const { ok, done } = checks();
const tracked = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
const marker = path.join(root, '.dreamteamer', 'editor.json');
const markerBytes = () => (fs.existsSync(marker) ? fs.readFileSync(marker) : null);
const before = tracked();
const markerBefore = markerBytes();
console.log(`  tracked changes before: ${before.split('\n').filter(Boolean).length} · editor marker: ${markerBefore ? `${markerBefore.length} bytes` : 'none'}`);

const s = await serve(root);
const b = await browser();
try {
	const t0 = Date.now();
	const { page, errors } = await signedIn(b, s.url);
	console.log(`  the nav drew in ${Date.now() - t0} ms`);
	const nav = await page.evaluate(async () => (await fetch('/api/nav')).json());
	const drawn = async () => page.$$eval('.dt-nav-row .dt-nav-label', (e) => e.map((x) => x.textContent.trim()));
	const top = nav.flatMap((n) => (n.kind === 'workspace' ? [n, ...(n.children ?? [])] : [n])).map((n) => n.label);
	const rows = await drawn();
	ok(JSON.stringify(rows) === JSON.stringify(top), 'the sidebar draws GET /nav, in order', `${rows.length} rows: ${rows.slice(0, 10).join(' · ')}${rows.length > 10 ? ' …' : ''}`);

	// open every top-level folder once: its children are /nav's children, in order
	const folders = nav.flatMap((n) => (n.kind === 'workspace' ? n.children ?? [] : [n])).filter((n) => (n.children ?? []).length && !n.route);
	let foldersOk = 0;
	for (const folder of folders) {
		const row = page.locator('.dt-nav-row', { hasText: folder.label }).first();
		await row.click();
		await page.waitForTimeout(200);
		const now = await drawn();
		const i = now.indexOf(folder.label);
		const kids = now.slice(i + 1, i + 1 + folder.children.length);
		if (JSON.stringify(kids) === JSON.stringify(folder.children.map((c) => c.label))) foldersOk++;
		else console.log(`  ✖ ${folder.label}: drawn ${JSON.stringify(kids)} vs /nav ${JSON.stringify(folder.children.map((c) => c.label))}`);
		await row.click();
	}
	ok(foldersOk === folders.length, 'each folder opens to its /nav children', `${foldersOk} of ${folders.length}`);
	await page.screenshot({ path: shot('hq-walk-nav') });

	const all = (ns) => ns.flatMap((n) => [n, ...all(n.children ?? [])]);
	const routes = all(nav).filter((n) => n.route);
	const contentOf = (n) => /^\/content\/([^?]+)/.exec(n.route)?.[1];
	const list = routes.find((n) => n.kind === 'collection' && contentOf(n) && (n.count ?? 1) > 0) ?? routes.find((n) => contentOf(n));
	const board = routes.find((n) => /board/i.test(n.label ?? '') && !n.route.startsWith('/content/'));
	ok(Boolean(list), 'the nav names a list with records', list ? `${list.label} → ${list.route}` : '');
	if (list) {
		await go(page, list.route);
		const rowsDrawn = await page.waitForSelector('tbody tr, .dt-card', { timeout: 15_000 }).then(() => page.waitForTimeout(1000)).then(() => page.$$eval('tbody tr, .dt-card', (e) => e.length), () => 0);
		ok(rowsDrawn > 0, 'the list renders its records', `${rowsDrawn} rows`);
		await page.screenshot({ path: shot('hq-walk-list') });
		const recs = await page.evaluate(async (c) => (await (await fetch(`/api/collections/${encodeURIComponent(c)}/records?limit=1`)).json()), contentOf(list));
		const first = (Array.isArray(recs) ? recs : recs.records ?? [])[0];
		if (first) {
			await go(page, `/content/${contentOf(list)}/${first.id}`);
			const header = await page.waitForSelector('.dt-page-header, header', { timeout: 15_000 }).then((e) => e.textContent(), () => '');
			ok(header.length > 0, 'a record page renders', `/content/${contentOf(list)}/${first.id}`);
			await page.screenshot({ path: shot('hq-walk-record') });
		}
	}
	if (board) {
		await go(page, board.route);
		await page.waitForTimeout(1500);
		const lanes = await page.$$eval('.dt-kanban-lane, [class*="kanban"] [class*="lane"], [class*="column"]', (e) => e.length);
		ok(lanes > 0, 'a board renders its lanes', `${board.label} → ${board.route} · ${lanes} lane elements`);
		await page.screenshot({ path: shot('hq-walk-board') });
	} else console.log('  (the nav names no board)');
	ok(errors.length === 0, 'no page errors', JSON.stringify(errors.slice(0, 3)));
} finally {
	await b.close();
	await s.stop();
}
const after = tracked();
ok(after === before, 'no tracked file of the workspace changed', after === before ? 'git status --porcelain identical' : after);
const markerAfter = markerBytes();
ok(markerBefore === null ? markerAfter === null : Boolean(markerAfter) && markerBefore.equals(markerAfter), 'the editor marker is byte-identical after the stop', markerBefore ? `${markerBefore.length} bytes` : 'absent before and after');
process.exit(done());
