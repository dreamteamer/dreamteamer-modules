#!/usr/bin/env node
// The machine-with-no-editor walk (cr-modules-005 line 7), run by .github/workflows/web-walk.yml on a fresh
// ubuntu runner: the synthetic Northwind hq with one git_modules layer, `npm install` of the packed protocol, ui
// and web tarballs (the app is @dreamteamer/ui's built page, inside the ui tarball), `dt compile`, then the
// one command — `dt web --no-open` through the workspace's own engine CLI — and headless Chromium:
//   - no `code` on PATH, and no .dreamteamer/editor.json before the start (no editor ever opened it)
//   - the page draws the nav (with its Layers folder) and the layer's record in the projects list
//   - the layer's record, edited in the browser, lands in the layer's clone
//   - renaming it is refused by the engine, naming the layer (the record page has no rename gesture: the
//     refusal is the API's answer to the signed-in page)
// usage: node modules/web/test/walk/no-vscode.mjs <protocol.tgz> <ui.tgz> <web.tgz>   (DT_ENGINE_DIR: the fixture's engine)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { browser, checks, go, northwind, shot } from './support.mjs';

const [protocolTgz, uiTgz, webTgz] = process.argv.slice(2).map((p) => path.resolve(p));
if (!protocolTgz || !uiTgz || !webTgz) { console.error('usage: no-vscode.mjs <protocol.tgz> <ui.tgz> <web.tgz>'); process.exit(2); }
const { ok, done } = checks();

const which = spawnSync('sh', ['-c', 'command -v code || true'], { encoding: 'utf8' }).stdout.trim();
ok(which === '', 'no `code` on this machine', `command -v code → ${JSON.stringify(which)}`);

const f = await northwind();
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: f.root, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
// a fresh install: the engine from the registry (replacing the fixture's link), the three packages from their tarballs
fs.rmSync(path.join(f.root, 'node_modules'), { recursive: true, force: true });
sh('npm', ['install', '--no-audit', '--no-fund', protocolTgz, uiTgz, webTgz]);
const DT = path.join(f.root, 'node_modules', '.bin', 'dt');
ok(fs.existsSync(path.join(f.root, 'node_modules', '@dreamteamer', 'ui', 'dist', 'app', 'index.html')), 'the installed ui package carries the app');
const compile = spawnSync(DT, ['compile'], { cwd: f.root, encoding: 'utf8', timeout: 120_000 });
ok(compile.status === 0, 'dt compile', `exit ${compile.status} ${compile.stderr.slice(0, 200)}`);
ok(!fs.existsSync(path.join(f.root, '.dreamteamer', 'editor.json')), 'no editor marker before the start');

const child = spawn(DT, ['web', '--no-open', '--idle', '10'], { cwd: f.root, env: { ...process.env, CLAUDE_PID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const killer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
let err = '';
child.stderr.on('data', (x) => { err += x; });
const url = await new Promise((resolve, reject) => {
	let out = '';
	child.stdout.on('data', (x) => { out += x; if (out.includes('\n')) resolve(out.split('\n')[0].replace(/^✔ dreamteamer web at /, '')); });
	child.on('exit', (code) => reject(new Error(`dt web exited ${code}: ${err}`)));
	setTimeout(() => reject(new Error(`no URL in 60 s: ${err}`)), 60_000).unref();
});
ok(/^http:\/\/127\.0\.0\.1:\d+\/sign-in\/\S+$/.test(url), 'dt web printed a loopback sign-in URL first', url.replace(/sign-in\/.*/, 'sign-in/<code>'));

const b = await browser();
try {
	const context = await b.newContext({ viewport: { width: 1400, height: 900 } });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(url);
	await page.waitForSelector('.dt-nav-row', { timeout: 30_000 });
	const rows = await page.$$eval('.dt-nav-row .dt-nav-label', (e) => e.map((x) => x.textContent.trim()));
	ok(rows.includes('Projects') && rows.includes('Layers'), 'the nav draws, with its Layers folder', rows.join(' · '));
	await go(page, '/content/projects');
	const seen = await page.waitForFunction(() => document.body.innerText.includes('Harbor Mutual archive'), null, { timeout: 10_000 }).then(() => true, () => false);
	ok(seen, "the layer's record is in the projects list");
	await page.screenshot({ path: shot('no-vscode-list') });

	await go(page, '/content/projects/harbor-mutual-archive');
	await page.click('button[title="Edit"]');
	await page.fill('[data-field="name"] input', 'Harbor Mutual archive, 2019');
	await page.click('button[title="Save"]');
	await page.waitForSelector('button[title="Edit"]', { timeout: 10_000 });
	const inLayer = execFileSync('git', ['status', '--porcelain'], { cwd: f.layer, encoding: 'utf8' }).trim();
	ok(inLayer === 'M data/projects/harbor-mutual-archive.project.md', "the edit landed in the layer's clone", JSON.stringify(inLayer));
	const rename = await page.evaluate(async () => {
		const r = await fetch('/api/collections/projects/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ old: 'harbor-mutual-archive', new: 'harbor-mutual-history' }) });
		return { status: r.status, text: await r.text() };
	});
	ok(rename.status === 400 && /held by layer northwind-archive/.test(rename.text), 'renaming it is refused, naming the layer', `${rename.status} ${rename.text.slice(0, 160)}`);
	await page.screenshot({ path: shot('no-vscode-record') });
	ok(errors.length === 0, 'no page errors', JSON.stringify(errors.slice(0, 3)));
} finally {
	await b.close();
	const stop = spawnSync(DT, ['web', 'stop'], { cwd: f.root, encoding: 'utf8', timeout: 30_000 });
	ok(stop.status === 0, 'dt web stop', stop.stdout.trim());
	clearTimeout(killer);
	child.kill('SIGKILL');
	f.cleanup();
}
process.exit(done());
