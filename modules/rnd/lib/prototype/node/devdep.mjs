// playwright-core is never a dependency of rnd: the browser tools resolve it at run time from an install up the
// tree, else the local npx cache, and launch an installed Chromium — the build that copy expects, else any
// installed one (PLAYWRIGHT_CHROMIUM_EXECUTABLE, then the playwright browsers cache). Absent, the message names
// the install command.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export const INSTALL = 'npm i --no-save playwright-core && npx playwright-core install chromium';

function candidates(from) {
	const out = [];
	try { out.push(createRequire(path.join(from, 'noop.js')).resolve('playwright-core')); } catch { /* not installed here */ }
	const npx = path.join(os.homedir(), '.npm', '_npx');
	for (const d of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
		const p = path.join(npx, d, 'node_modules', 'playwright-core', 'index.mjs');
		if (fs.existsSync(p)) out.push(p);
	}
	return out;
}

/** the playwright browsers cache, as playwright itself places it */
export function browsersDir(env = process.env, platform = process.platform, home = os.homedir()) {
	if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
	if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
	if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright');
	return path.join(env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'ms-playwright');
}

/** every installed Chromium executable in the cache, headless shells first, newest build first */
export function installedChromiums(dir = browsersDir()) {
	if (!fs.existsSync(dir)) return [];
	const names = ['chrome-headless-shell', 'chrome', 'Chromium', 'Google Chrome for Testing', 'chrome.exe', 'chrome-headless-shell.exe'];
	const found = [];
	const walk = (d, depth) => {
		if (depth > 6) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p, depth + 1);
			else if (names.includes(e.name)) { try { fs.accessSync(p, fs.constants.X_OK); found.push(p); } catch { /* not executable */ } }
		}
	};
	for (const b of fs.readdirSync(dir).filter((x) => /^chromium(_headless_shell)?-\d+$/.test(x)).sort((a, b) => (/headless/.test(b) - /headless/.test(a)) || Number(b.split('-').pop()) - Number(a.split('-').pop()))) walk(path.join(dir, b), 0);
	return found;
}

/** → { chromium, executablePath } — `launch(opts)` is chromium.launch with the executable filled in */
export async function chromium(from = process.cwd()) {
	for (const p of candidates(from)) {
		let c; try { const m = await import(p); c = m.chromium ?? m.default?.chromium; } catch { continue; }
		if (!c) continue;
		let exe = null;
		try { if (fs.existsSync(c.executablePath())) exe = c.executablePath(); } catch { /* no build for this copy */ }
		exe = exe ?? (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : installedChromiums()[0]);
		if (exe) return { chromium: c, executablePath: exe, launch: (opts = {}) => c.launch({ executablePath: exe, ...opts }) };
	}
	throw new Error(`playwright-core with an installed Chromium not found — run: ${INSTALL}`);
}
