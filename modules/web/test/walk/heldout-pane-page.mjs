#!/usr/bin/env node
// HELD-OUT cr-modules-017 (rnd/tests dreamteamer-modules/heldout-m017-m-page-reconnect-and-narrow-bar), the part a
// headless browser can prove — written by the test stage from the record alone.
// usage: node modules/web/test/walk/heldout-pane-page.mjs <shots dir>  → one ✔/✖ line per expectation, exit 1 when any
// fails; a screenshot per step in <shots dir>.
//
// AMENDED READING of step 1 (decisions/2026-11-14--the-pane-re-pairs-after-every-server-restart-sessions-live-in-memory-only):
// a restart signs the pane out, so "the image and the frame are drawn again from the new key without a reload"
// cannot hold by decision. Judged instead: after the restart the page shows the signed-out sentence (no raw 401 text,
// no endless spinner) and no request to the old files key is left failing in a loop; after a fresh dt web open the
// frame draws from the new key. The original reading is printed as an ℹ line and not counted. The IMAGE half is left to
// a person (this fixture has no record that draws a picture from a record file).
import fs from 'node:fs';
import path from 'node:path';
import { appDir, browser, checks, northwind, serve } from './support.mjs';

const shots = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'heldout-pane-page-shots'));
fs.mkdirSync(shots, { recursive: true });
const shot = (name) => path.join(shots, `${name}.png`);
const { ok, done } = checks();
const info = (what) => console.log(`ℹ ${what}`);
appDir();

const NAME = 'northwind-forty-character-workspace-name';
if (NAME.length !== 40) throw new Error('the name is 40 characters');
const SIGNED_OUT = 'This pane is signed out. Ask the chat to show it again — it runs dt web open.';

// the workspace: Northwind, a 40-character name, and one module app (a frame)
const f = await northwind();
const pkgFile = path.join(f.root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.name = NAME;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
const mod = path.join(f.root, 'modules', 'h8frame');
fs.mkdirSync(path.join(mod, 'ui'), { recursive: true });
fs.writeFileSync(path.join(mod, 'package.json'), JSON.stringify({ name: 'h8frame', private: true, version: '0.0.1', dreamteamer: { title: 'H8 frame', description: 'one module app for the held-out walk', engine: '>=0.43.0' } }, null, '\t'));
fs.writeFileSync(path.join(mod, 'ui', 'app.js'), `export default ({ registerApp }) => {
	const { defineComponent, h, onMounted } = window.Vue;
	const App = defineComponent({ setup() { onMounted(() => { document.body.dataset.h8 = 'drawn'; }); return () => h('p', { class: 'h8-app' }, 'H8 frame drawn'); } });
	registerApp({ id: 'h8frame', label: 'H8 frame', icon: 'beaker', routes: [{ path: '', component: App }] });
};
`);
const c = f.dt('compile');
if (c.status !== 0) throw new Error(`compile: ${c.stdout}${c.stderr}`);

const b = await browser();
const s = await serve(f.root, { idle: 10 });
const requests = [];
const watch = (page) => page.on('request', (r) => requests.push({ t: Date.now(), url: r.url() }));
const frameKey = async (page) => {
	for (let i = 0; i < 60; i++) {
		for (const fr of page.frames()) { const m = /\/_frames\/([^/]+)\/h8frame\//.exec(fr.url()); if (m) { const drawn = await fr.evaluate(() => document.body.dataset.h8).catch(() => null); if (drawn === 'drawn') return m[1]; } }
		await page.waitForTimeout(500);
	}
	return null;
};
const openApp = async (page) => {
	// a module app's route is /a/<app id> (@dreamteamer/ui modules.ts)
	await page.evaluate(() => { location.hash = '/a/h8frame'; });
	return frameKey(page);
};
const text = (page) => page.evaluate(() => document.body.innerText);
const fresh = async (url, viewport = { width: 1200, height: 800 }) => {
	const context = await b.newContext({ viewport });
	const page = await context.newPage();
	watch(page);
	const res = await page.goto(url);
	if (!res || res.status() !== 200) throw new Error(`sign-in answered ${res?.status()}`);
	await page.waitForSelector('.dt-nav-row', { timeout: 30_000 });
	return { context, page };
};

try {
	// ---- step 1: a restart under an open page with a module frame --------------------------------------------
	{
		const { context, page } = await fresh(s.url);
		const oldKey = await openApp(page);
		ok(Boolean(oldKey), 'step 1: the module app frame is drawn before the restart', oldKey ? `files key ${oldKey.slice(0, 6)}…` : 'no frame drew');
		await page.screenshot({ path: shot('1a-before-restart') });
		const stop = s.run('stop');
		ok(stop.status === 0, 'step 1: dt web stop', stop.stdout.trim());
		const sel = s.run('selection');
		ok(sel.status === 0, 'step 1: dt web selection restarts the server', sel.stdout.trim().split('\n')[0]);
		await page.waitForTimeout(8000);
		const t = await text(page);
		ok(t.includes(SIGNED_OUT), 'step 1 (amended): after the restart the page shows the signed-out sentence (no interaction)', t.includes(SIGNED_OUT) ? '' : JSON.stringify(t.slice(0, 120)));
		ok(!/\b401\b|unauthori[sz]ed|sign in first/i.test(t), 'step 1 (amended): no raw 401 text on the page');
		const since = Date.now() - 5000;
		const loop = oldKey ? requests.filter((r) => r.t >= since && r.url.includes(oldKey)).length : 0;
		ok(loop <= 2, 'step 1: no request to the old files key is left failing in a loop', `${loop} requests to the old key in the last 5 s`);
		const after = await frameKey(page).catch(() => null);
		info(`step 1 (original reading, not counted): frame redrawn from a new key without a reload — ${after && after !== oldKey ? 'yes' : 'no'}`);
		await page.screenshot({ path: shot('1b-after-restart') });
		await page.locator('.dt-nav-row').nth(2).click();
		await page.waitForTimeout(3000);
		const t2 = await text(page);
		ok(t2.includes(SIGNED_OUT), 'step 1 (amended): after the restart, the next click shows the signed-out sentence', t2.includes(SIGNED_OUT) ? '' : JSON.stringify(t2.slice(0, 120)));
		await page.screenshot({ path: shot('1b2-after-restart-click') });
		await context.close();
		// a fresh dt web open: the frame draws from the new key
		const again = await fresh(await s.signInUrl());
		const newKey = await openApp(again.page);
		ok(Boolean(newKey) && newKey !== oldKey, 'step 1 (amended): after dt web open the frame draws from the new key', newKey ? `new ${newKey.slice(0, 6)}…` : 'no frame');
		await again.page.screenshot({ path: shot('1c-after-open') });
		await again.context.close();
	}

	// ---- step 2: dt web revoke under an open page, then a click ----------------------------------------------
	{
		const { context, page } = await fresh(await s.signInUrl());
		const rv = s.run('revoke');
		ok(rv.status === 0, 'step 2: dt web revoke', rv.stdout.trim());
		// a click, as the record says — unless the page already drew the sentence when revoke ended its event stream
		await page.waitForTimeout(500);
		if (!(await text(page)).includes(SIGNED_OUT)) await page.locator('.dt-nav-row').nth(1).click({ timeout: 5000 }).catch((e) => info(`step 2: the click did not land (${String(e.message).split('\n')[0]})`));
		else info('step 2: the sentence was already drawn when revoke ended the event stream — no click needed');
		await page.waitForTimeout(3000);
		const t = await text(page);
		ok(t.includes(SIGNED_OUT), 'step 2: the page shows the signed-out sentence over or instead of the view', t.includes(SIGNED_OUT) ? '' : JSON.stringify(t.slice(0, 200)));
		ok(!/\b401\b|unauthori[sz]ed|sign in first/i.test(t), 'step 2: no raw 401 text');
		const spinning = await page.evaluate(() => [...document.querySelectorAll('[class*="spin"], [class*="loading"], [aria-busy="true"]')].filter((e) => { const b = e.getBoundingClientRect(); if (!(b.width > 0)) return false; const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return Boolean(top && (top === e || e.contains(top))); }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')} "${(e.innerText ?? '').slice(0, 40)}"`));
		ok(spinning.length === 0, 'step 2: no endless spinner (a busy element the person can see — not one under the sentence)', `${spinning.length} visible busy element(s) after 3 s: ${spinning.join(' · ')}`);
		await page.screenshot({ path: shot('2-revoked') });
		await context.close();
	}

	// ---- step 3: the switcher with no other workspace ----------------------------------------------------------
	{
		const { context, page } = await fresh(await s.signInUrl());
		await page.click('.dt-pane-bar__ws-button');
		await page.waitForTimeout(800);
		const menu = await page.evaluate(() => {
			const m = document.querySelector('.dt-pane-bar__ws .dt-pane-bar__menu');
			return m ? { text: m.innerText, checked: [...m.querySelectorAll('[aria-checked="true"]')].map((e) => e.innerText.trim()) } : null;
		});
		ok(Boolean(menu), 'step 3: the switcher opens a menu');
		ok(Boolean(menu?.checked.some((x) => x.startsWith(NAME))), 'step 3: the menu shows the current workspace checked', JSON.stringify(menu?.checked));
		ok(/no other workspace was opened on this machine/i.test(menu?.text ?? ''), 'step 3: a line says no other workspace was opened on this machine', JSON.stringify(menu?.text));
		await page.screenshot({ path: shot('3-switcher-alone') });
		await context.close();
	}

	// ---- step 4: the pane bar at 320 px, Admin with raisedAt, a 40-character name -------------------------------
	{
		const up = s.run('open', '--admin');
		const url = /^✔ open in the pane: (\S+)$/m.exec(up.stdout)?.[1];
		ok(Boolean(url), 'step 4: dt web open --admin', up.stdout.trim().split('\n').join(' · '));
		const { context, page } = await fresh(url, { width: 320, height: 640 });
		await page.waitForTimeout(800);
		await page.click('.dt-pane-bar__chip');
		await page.waitForTimeout(600);
		const m = await page.evaluate(() => {
			const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: b.left, y: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0, overflow: cs.textOverflow, sw: e.scrollWidth, cw: e.clientWidth, text: e.innerText }; };
			// reachable = the topmost element at its centre is it (not clipped by an ancestor, not covered)
			const top = (sel) => { const e = document.querySelector(sel); if (!e) return false; const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return Boolean(t && (t === e || e.contains(t))); };
			const clipped = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); let p = e.parentElement; while (p) { const cs = getComputedStyle(p); if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') { const q = p.getBoundingClientRect(); if (b.left < q.left - 0.5 || b.right > q.right + 0.5) return p.className || p.tagName; } p = p.parentElement; } return null; };
			return { reach: { chip: top('.dt-pane-bar__chip'), menu: top('.dt-pane-bar__level .dt-pane-bar__menu button') || top('.dt-pane-bar__level .dt-pane-bar__menu .dt-pane-bar__hint') }, clip: { chip: clipped('.dt-pane-bar__chip'), menu: clipped('.dt-pane-bar__level .dt-pane-bar__menu') }, vw: window.innerWidth, docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth, chip: r('.dt-pane-bar__chip'), menu: r('.dt-pane-bar__level .dt-pane-bar__menu'), name: r('.dt-pane-bar__ws-button'), notice: r('.dt-pane-bar__notice') };
		});
		const inside = (b) => b && b.x >= 0 && b.right <= m.vw + 0.5;
		ok(inside(m.chip) && m.chip.visible && m.reach.chip && !m.clip.chip, 'step 4: the level chip is reachable and inside the viewport (topmost at its centre, not clipped)', JSON.stringify({ box: m.chip && { x: m.chip.x, right: m.chip.right, text: m.chip.text }, topmost: m.reach.chip, clippedBy: m.clip.chip }));
		ok(inside(m.menu) && m.menu.visible && m.reach.menu && !m.clip.menu, 'step 4: the level menu is reachable and inside the viewport (topmost, not clipped)', JSON.stringify({ box: m.menu && { x: m.menu.x, right: m.menu.right }, topmost: m.reach.menu, clippedBy: m.clip.menu }));
		ok(m.docSW <= m.docCW, 'step 4: no horizontal scroll of the page', `scrollWidth ${m.docSW}, clientWidth ${m.docCW}`);
		ok(m.name?.overflow === 'ellipsis' && m.name.sw > m.name.cw, 'step 4: the workspace name truncates with an ellipsis', JSON.stringify(m.name && { overflow: m.name.overflow, sw: m.name.sw, cw: m.name.cw }));
		const covers = m.notice?.visible && m.chip && !(m.notice.right <= m.chip.x || m.notice.x >= m.chip.right || m.notice.bottom <= m.chip.y || m.notice.y >= m.chip.bottom);
		ok(!covers, 'step 4: the raise notice wraps or hides, never covers the chip', JSON.stringify(m.notice && { visible: m.notice.visible, x: m.notice.x, right: m.notice.right, text: m.notice.text }));
		info(`step 4: raise notice ${m.notice?.visible ? `shown: "${m.notice.text}"` : 'hidden at this width'}`);
		await page.screenshot({ path: shot('4-narrow-bar-level-menu') });
		await context.close();
	}
} catch (e) {
	ok(false, 'the walk ran to its end', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
	await b.close();
	s.run('stop');
	await s.stop();
	f.cleanup();
}
console.log(`screenshots: ${shots}`);
process.exit(done());
