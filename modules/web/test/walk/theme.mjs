#!/usr/bin/env node
// The theme walk (cr-modules-005 line 8, the browser half): the same board route on the synthetic Northwind
// workspace in light and in dark (Chromium's emulated prefers-color-scheme), one screenshot each. The page wears
// its own tokens: the surface is light in one and dark in the other, the text contrasts with it in both, and the
// status lanes of the enum (charts.green / charts.orange, colour ids only VS Code defines) still draw on a
// surface of their own. The VS Code half is the CDP smoke at the same route.
// usage: node modules/web/test/walk/theme.mjs        (DT_WEB_APP_DIR, DT_ENGINE_DIR, DT_WALK_SHOTS optional)
import { appDir, browser, checks, go, northwind, serve, shot, signedIn } from './support.mjs';

appDir();
const { ok, done } = checks();
const f = await northwind();
const s = await serve(f.root);
const b = await browser();
const lum = (rgb) => { const [r, g, bl] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255; };
try {
	const seen = {};
	let url = s.url;
	for (const scheme of ['light', 'dark']) {
		const { page, errors, context } = await signedIn(b, url, { colorScheme: scheme });
		const route = await page.evaluate(async () => {
			const nav = await (await fetch('/api/nav')).json();
			const all = (ns) => ns.flatMap((n) => [n, ...all(n.children ?? [])]);
			return all(nav).find((n) => /board/i.test(n.label ?? ''))?.route ?? null;
		});
		ok(Boolean(route), `${scheme}: the nav names the board`, String(route));
		await go(page, route);
		await page.waitForTimeout(1200);
		const look = await page.evaluate(() => {
			const cs = (el) => (el ? getComputedStyle(el) : null);
			const surface = cs(document.querySelector('.dt-page-area')) ?? cs(document.body);
			const shell = cs(document.querySelector('.dt-shell'));
			const bg = [surface?.backgroundColor, shell?.backgroundColor, cs(document.body).backgroundColor].find((c) => c && c !== 'rgba(0, 0, 0, 0)') ?? '';
			const chips = [...document.querySelectorAll('*')].filter((e) => /^(active|paused)$/.test(e.textContent.trim()) && e.children.length === 0)
				.map((e) => { let n = e; while (n && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)' && n !== document.body) n = n.parentElement; return { text: e.textContent.trim(), bg: n ? getComputedStyle(n).backgroundColor : '', color: getComputedStyle(e).color }; });
			return { bg, text: cs(document.body).color, chips };
		});
		seen[scheme] = look;
		console.log(`  ${scheme}: surface ${look.bg} · text ${look.text} · chips ${JSON.stringify(look.chips.slice(0, 4))}`);
		ok(look.chips.length >= 2, `${scheme}: the board draws its status lanes (active, paused)`, String(look.chips.length));
		ok(look.chips.every((c) => c.bg && c.bg !== 'rgba(0, 0, 0, 0)'), `${scheme}: every lane header sits on a drawn surface, never transparent`);
		ok(Math.abs(lum(look.bg) - lum(look.text)) > 0.4, `${scheme}: the text contrasts with the surface`, `${lum(look.bg).toFixed(2)} vs ${lum(look.text).toFixed(2)}`);
		await page.screenshot({ path: shot(`theme-${scheme}`) });
		ok(errors.length === 0, `${scheme}: no page errors`, JSON.stringify(errors.slice(0, 3)));
		await context.close();
		url = await s.signInUrl(); // a sign-in URL is single-use
	}
	ok(lum(seen.light.bg) > 0.7, 'light: the surface is light', seen.light.bg);
	ok(lum(seen.dark.bg) < 0.3, 'dark: the surface is dark', seen.dark.bg);
} finally {
	await b.close();
	await s.stop();
	f.cleanup();
}
process.exit(done());
