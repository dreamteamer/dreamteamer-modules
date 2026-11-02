// What every walk shares: the built app, the synthetic Northwind workspace, dt-web started the way a person
// starts it (the bin, --no-open, the first stdout line) and bounded by a hard timer, headless Chromium, and
// screenshots named YYYY-MM-DD--HHMM--<name>.png. A walk is a script, not a suite test: it needs the BUILT app
// (@dreamteamer/ui's dist/app, built and gitignored) and a browser, so it runs by hand or in .github/workflows/web-walk.yml.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(HERE, '..', '..');
export const MODULES = path.resolve(WEB, '..');
export const REPO = path.resolve(MODULES, '..');
export const BIN = path.join(WEB, 'bin', 'dt-web.mjs');

/** The built app the walk serves: DT_WEB_APP_DIR, else @dreamteamer/ui's dist/app. A walk without one stops here, by name. */
export function appDir() {
	const dir = path.resolve(process.env.DT_WEB_APP_DIR ?? path.join(MODULES, 'ui', 'dist', 'app'));
	if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`no built app at ${dir} — npm run build -w modules/ui`);
	return dir;
}

/** The engine the fixture is built with: DT_ENGINE_DIR, else this repo's devDependency. */
export const ENGINE_DIR = fs.realpathSync(process.env.DT_ENGINE_DIR ? path.resolve(process.env.DT_ENGINE_DIR) : path.join(REPO, 'node_modules', 'dreamteamer'));

/** The contract's synthetic Northwind workspace (one git_modules layer holding a projects record). */
export async function northwind() {
	const { makeFixture } = await import(pathToFileURL(path.join(MODULES, 'protocol', 'lib', 'contract', 'fixture.js')).href);
	return makeFixture({ engineDir: ENGINE_DIR });
}

/** Headless Chromium through rnd's resolver (playwright-core from the npx cache, or PLAYWRIGHT_CHROMIUM_EXECUTABLE). */
export async function browser() {
	const { chromium } = await import(pathToFileURL(path.join(MODULES, 'rnd', 'lib', 'prototype', 'node', 'devdep.mjs')).href);
	return (await chromium(REPO)).launch();
}

/**
 * `dt-web <root> --no-open --idle <n>` as a child, killed by a hard timer after `limitMs` whatever happens.
 * Resolves `{ url, child, stop(), stderr() }` once the first stdout line — the sign-in URL — is printed.
 */
export async function serve(root, { limitMs = 10 * 60_000, idle = 10, env = {} } = {}) {
	const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-walk-rt-'));
	const child = spawn(process.execPath, [BIN, root, '--no-open', '--idle', String(idle)], {
		env: { ...process.env, DT_WEB_RUNTIME_DIR: runtime, DT_WEB_APP_DIR: appDir(), CLAUDE_PID: '', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const killer = setTimeout(() => child.kill('SIGKILL'), limitMs);
	killer.unref();
	let err = '';
	child.stderr.on('data', (b) => { err += b; });
	const exited = new Promise((r) => child.once('exit', (code, signal) => { clearTimeout(killer); r({ code, signal }); }));
	const url = await new Promise((resolve, reject) => {
		let out = '';
		child.stdout.on('data', (b) => { out += b; if (out.includes('\n')) resolve(out.split('\n')[0].replace(/^✔ dreamteamer web at /, '')); });
		exited.then(({ code }) => reject(new Error(`dt-web exited ${code} before printing: ${err}`)));
		setTimeout(() => reject(new Error(`no sign-in URL within 60 s: ${err}`)), 60_000).unref();
	});
	const stop = async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
		await exited;
		fs.rmSync(runtime, { recursive: true, force: true });
	};
	// a fresh single-use sign-in URL from the running server, as `dt web url` mints one
	const signInUrl = async () => {
		const state = JSON.parse(fs.readFileSync(path.join(runtime, fs.readdirSync(runtime).find((n) => n.endsWith('.json'))), 'utf8'));
		const r = await fetch(`http://127.0.0.1:${state.port}/_dt/sign-in`, { method: 'POST', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(10_000) });
		return (await r.json()).url;
	};
	return { url, child, stop, signInUrl, stderr: () => err, runtime };
}

/** A page signed in through the URL, with page errors collected. */
export async function signedIn(b, url, { colorScheme = 'light', viewport = { width: 1400, height: 900 } } = {}) {
	const context = await b.newContext({ colorScheme, viewport });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	const res = await page.goto(url);
	if (!res || res.status() !== 200) throw new Error(`sign-in answered ${res?.status()}`);
	await page.waitForSelector('.dt-nav-row', { timeout: 30_000 });
	return { page, context, errors };
}

/** Navigate the app to a route (its own hash router, as a click would). */
export async function go(page, route) {
	await page.evaluate((r) => { location.hash = r; }, route);
	await page.waitForTimeout(800);
}

/** Where screenshots go: DT_WALK_SHOTS, else a temp folder. Names carry the YYYY-MM-DD--HHMM-- prefix. */
export function shot(name) {
	const dir = process.env.DT_WALK_SHOTS ?? path.join(os.tmpdir(), 'dt-web-walk-shots');
	fs.mkdirSync(dir, { recursive: true });
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return path.join(dir, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}--${p(d.getHours())}${p(d.getMinutes())}--${name}.png`);
}

/** One line per check; the walk's exit code is 1 when any failed. */
export function checks() {
	const failed = [];
	const ok = (cond, what, detail = '') => { console.log(`${cond ? '✔' : '✖'} ${what}${detail ? ` — ${detail}` : ''}`); if (!cond) failed.push(what); };
	const done = () => { console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nevery check passed'); return failed.length ? 1 : 0; };
	return { ok, done };
}
