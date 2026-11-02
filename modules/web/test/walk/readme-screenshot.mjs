#!/usr/bin/env node
// Makes modules/web/docs/screenshot.png, the README's picture: the synthetic Northwind workspace (its folder
// named "northwind") in dt web, light scheme, the nav on the left and the projects board on the right.
// usage: node modules/web/test/walk/readme-screenshot.mjs   (DT_WEB_APP_DIR, DT_ENGINE_DIR optional)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, browser, go, northwind, serve, signedIn, WEB } from './support.mjs';

appDir();
const f = await northwind();
// the nav's first row is the workspace's folder name
const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-readme-'));
const root = path.join(holder, 'northwind');
fs.renameSync(f.root, root);
const s = await serve(root);
const b = await browser();
try {
	const { page } = await signedIn(b, s.url, { viewport: { width: 1200, height: 640 } });
	await go(page, '/projects-board');
	await page.waitForTimeout(1500);
	const out = path.join(WEB, 'docs', 'screenshot.png');
	fs.mkdirSync(path.dirname(out), { recursive: true });
	await page.screenshot({ path: out });
	console.log(`✔ ${path.relative(process.cwd(), out)} · ${fs.statSync(out).size} bytes`);
} finally {
	await b.close();
	await s.stop();
	fs.rmSync(holder, { recursive: true, force: true });
}
