// `npx dt-prototype play [--only k,k] [--jobs n] [--port n]` — plays EVERY journey end to end in headless
// Chromium through the player's own API (window[app].demo: play → next … → stop) and checks each step:
//   route   the app landed on the step's screen
//   anchor  [data-demo~="<anchor>"] is drawn; on a stub, the anchor or the stub card [data-demo~="stub-<screen>"]
//   action  every action the step runs is accepted — or refused, when the step expects it
//   spot    the spotlit element ends inside the visible band the player reports
//   errors  no page error and no console.error while the step plays
// and, per journey, that stop() puts the store back byte-identical. Writes tools/out/coverage.{json,md}.
// Before serving, every vendored file is checked against its stamp: an edited one is a fork, and play refuses.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { serve } from './serve.mjs';
import { chromium } from './devdep.mjs';
import { vendorStatus } from './vendor.mjs';
import { VERSION } from './export.mjs';

/** the steps a journey plays: every index that is not out of scope, with the anchor the player will look for */
export function playable(j, mod) {
	return j.steps.map((s, i) => ({ i, rec: s, m: mod?.steps?.[i] ?? {} })).filter((x) => !x.rec.outOfScope)
		.map(({ i, rec, m }) => ({ i, screen: rec.screen, system: !!rec.system, anchor: m.anchor !== undefined ? m.anchor : rec.system ? null : rec.story ?? null, expectRefusal: !!m.expectRefusal }));
}

async function settle(page, app) {
	let last = null; let v = null;
	for (let t = 0; t < 30; t++) {
		v = await page.evaluate((app) => {
			const A = window[app]; const d = A.demo.state(); if (!d) return null;
			const n = document.querySelector('.demo-highlight'); if (!n) return { spot: false };
			const r = n.getBoundingClientRect(); const band = A.demo.visibleBand();
			const top = Math.round(r.top), bottom = Math.round(r.bottom), height = Math.round(r.height);
			const tall = height > band.bottom - band.top;
			return { spot: true, top, bottom, height, bandTop: Math.round(band.top), bandBottom: Math.round(band.bottom), settled: d.settled, scrollY: Math.round(scrollY),
				visible: height > 0 && top >= band.top - 2 && top < band.bottom - Math.min(height, 24) && (tall || bottom <= band.bottom + 2) };
		}, app);
		if (!v || !v.spot || v.settled === false) { await page.waitForTimeout(80); continue; }
		if (last && last.top === v.top && last.scrollY === v.scrollY) break;
		last = v; await page.waitForTimeout(80);
	}
	return v;
}

async function playJourney(browser, base, c, j, mod) {
	const ctx = await browser.newContext({ viewport: c.viewport, ...(c.locale ? { locale: c.locale } : {}) });
	const page = await ctx.newPage();
	let errs = [];
	page.on('pageerror', (e) => errs.push(`pageerror: ${(e.message || String(e)).split('\n')[0]}`));
	page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text().split('\n')[0]}`); });
	const out = { key: j.key, group: j.group, steps: [], restoreOk: null, fatal: null };
	const app = c.app;
	try {
		await page.goto(`${base}#/`);
		await page.waitForFunction((app) => !!window[app]?.demo, app, { timeout: 15000 });
		if (errs.length) out.loadErrors = errs.splice(0);
		const before = await page.evaluate((app) => JSON.stringify(window[app].store.snapshot()), app);
		const plan = playable(j, mod);
		for (let k = 0; k < plan.length; k++) {
			const p = plan[k]; errs = [];
			const st = { n: p.i + 1, screen: p.screen, fail: [] };
			const call = await page.evaluate(async ({ app, key, i, first }) => {
				try { const r = first ? await window[app].demo.play(key, i) : window[app].demo.next(); return { ok: r !== false }; }
				catch (e) { return { ok: false, threw: String(e?.stack || e).split('\n').slice(0, 2).join(' | ') }; }
			}, { app, key: j.key, i: p.i, first: k === 0 });
			if (call.threw || !call.ok) st.fail.push({ kind: 'setup threw', detail: call.threw ?? 'play() returned false (journey or playback module not found)' });
			await page.waitForFunction(({ app, n, screen }) => { const d = window[app].demo.state(); return d?.step === n && window[app].current()?.screen?.key === screen; }, { app, n: p.i + 1, screen: p.screen }, { timeout: 4000 }).catch(() => {});
			await page.waitForTimeout(120);
			if (p.anchor) await page.waitForFunction(({ app, screen, anchor }) => { const s = window[app].byKey[screen]; return !s || s.stub || !!document.querySelector(`[data-demo~="${CSS.escape(anchor)}"]`); }, { app, screen: p.screen, anchor: p.anchor }, { timeout: 1000 }).catch(() => {});
			const seen = await page.evaluate(({ app, screen, anchor }) => {
				const A = window[app]; const reg = A.byKey[screen] || null; const q = (k) => document.querySelector(`[data-demo~="${CSS.escape(k)}"]`);
				return { inRegistry: !!reg, stub: reg ? !!reg.stub : null, prd: reg?.prd || [], at: A.current()?.screen?.key || null, hash: location.hash,
					anchorFound: anchor ? !!q(anchor) : null, stubCard: !!q(`stub-${screen}`), results: A.demo.state()?.results ?? [], step: A.demo.state()?.step ?? null };
			}, { app, screen: p.screen, anchor: p.anchor });
			Object.assign(st, { stub: seen.stub, prd: seen.prd, at: seen.at });
			if (!seen.inRegistry) st.fail.push({ kind: 'route missing', detail: `screen ${p.screen} is not in the registry` });
			else if (seen.at !== p.screen || seen.step !== p.i + 1) st.fail.push({ kind: 'route missing', detail: `landed on ${seen.at || '—'} (${decodeURIComponent(seen.hash)}) at step ${seen.step ?? '—'} instead of ${p.screen}` });
			st.routeOk = seen.inRegistry && seen.at === p.screen && seen.step === p.i + 1;
			if (st.routeOk) {
				if (seen.stub) { st.anchorOk = seen.stubCard || !!seen.anchorFound; if (!st.anchorOk) st.fail.push({ kind: 'anchor missing', detail: `stub card [data-demo~="stub-${p.screen}"] not rendered` }); }
				else if (p.anchor) { st.anchorOk = seen.anchorFound; if (!st.anchorOk) st.fail.push({ kind: 'anchor missing', detail: `[data-demo~="${p.anchor}"] not on ${p.screen}` }); }
				if (st.anchorOk) {
					const v = await settle(page, app);
					if (!v?.spot) st.fail.push({ kind: 'not spotlit', detail: 'the anchor is on the page but carries no .demo-highlight' });
					else if (!v.visible) st.fail.push({ kind: 'spotlight off-screen', detail: `y ${v.top}–${v.bottom} (${v.height}px), visible band ${v.bandTop}–${v.bandBottom}` });
				}
			}
			for (const r of seen.results) if (!r.ok) st.fail.push({ kind: 'action refused', detail: r.expected ? `${r.name} was expected to be refused but was accepted` : `${r.name} refused${r.rule ? ` (${r.rule})` : ''}${r.reason ? ` — ${typeof r.reason === 'string' ? r.reason : JSON.stringify(r.reason)}` : ''}` });
			for (const e of errs) st.fail.push({ kind: 'JS error', detail: e });
			st.ok = !st.fail.length;
			out.steps.push(st);
		}
		errs = [];
		await page.evaluate((app) => window[app].demo.stop(), app);
		await page.waitForTimeout(100);
		const after = await page.evaluate((app) => JSON.stringify(window[app].store.snapshot()), app);
		out.restoreOk = before === after;
		if (errs.length) out.stopErrors = errs.splice(0);
	} catch (e) { out.fatal = String(e?.message || e).split('\n')[0]; }
	await ctx.close();
	out.ok = !out.fatal && out.restoreOk !== false && !out.stopErrors && !out.loadErrors && out.steps.every((s) => s.ok) && out.steps.length > 0;
	return out;
}

export async function run(dir, { only = null, jobs = 4, port = null, log = console.log, error = console.error } = {}) {
	const c = await loadConfig(dir);
	const forks = vendorStatus(c.paths.harness).filter((v) => v.state !== 'ok' && v.state !== 'stale');
	if (forks.length) { for (const v of forks) error(`fail  vendored ${v.file}: ${v.state} — run dt-prototype vendor (a local edit is a fork)`); return 1; }
	for (const v of vendorStatus(c.paths.harness).filter((x) => x.state === 'stale')) error(`warn  vendored ${v.file} is ${v.version}, the package ${VERSION}`);
	const data = path.join(c.paths.data, 'journeys.js');
	if (!fs.existsSync(data)) { error(`no ${path.relative(c.dir, data)} — run dt-prototype export`); return 1; }
	const { journeys = [], groups = [] } = await import(`${pathToFileURL(data).href}?t=${fs.statSync(data).mtimeMs}`);
	const todo = journeys.filter((j) => !only || only.includes(j.key));
	const mods = {};
	for (const j of todo) { const f = path.join(c.paths.playback, `${j.key}.js`); if (fs.existsSync(f)) mods[j.key] = (await import(`${pathToFileURL(f).href}?t=${fs.statSync(f).mtimeMs}`)).default; }
	const pw = await chromium(c.dir);
	const srv = await serve(c, port);
	const browser = await pw.launch();
	const t0 = Date.now();
	const results = new Array(todo.length); let next = 0;
	try {
		await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs || 4, todo.length)) }, async () => {
			while (next < todo.length) {
				const k = next++; const r = await playJourney(browser, srv.base, c, todo[k], mods[todo[k].key]); results[k] = r;
				const bad = r.steps.filter((s) => !s.ok).length;
				log(`${r.ok ? 'PASS' : 'FAIL'} ${r.key.padEnd(34)} ${r.steps.length} steps${bad ? ` · ${bad} failing` : ''}${r.restoreOk === false ? ' · restore differs' : ''}${r.fatal ? ` · ${r.fatal}` : ''}`);
			}
		}));
	} finally { await browser.close(); srv.stop(); }
	const failures = [];
	for (const r of results) {
		if (r.fatal) failures.push({ journey: r.key, step: null, kind: 'journey crashed', detail: r.fatal });
		for (const e of r.loadErrors ?? []) failures.push({ journey: r.key, step: 0, kind: 'JS error on load', detail: e });
		if (r.restoreOk === false) failures.push({ journey: r.key, step: null, kind: 'restore differs', detail: 'store after stop() ≠ store before play()' });
		for (const e of r.stopErrors ?? []) failures.push({ journey: r.key, step: 'stop', kind: 'JS error on stop', detail: e });
		for (const s of r.steps) for (const f of s.fail) failures.push({ journey: r.key, step: s.n, screen: s.screen, kind: f.kind, detail: f.detail });
	}
	const steps = results.flatMap((r) => r.steps);
	const totals = { journeys: results.length, passing: results.filter((r) => r.ok).length, steps: steps.length, stepsOk: steps.filter((s) => s.ok).length, built: steps.filter((s) => s.stub === false).length, stub: steps.filter((s) => s.stub === true).length };
	const report = { tool: `@dreamteamer/rnd ${VERSION} dt-prototype play`, elapsedSec: Math.round((Date.now() - t0) / 1000), totals,
		groups: groups.map((g) => ({ group: g.key, journeys: results.filter((r) => r.group === g.key).length, passing: results.filter((r) => r.group === g.key && r.ok).length })),
		journeys: results.map((r) => ({ key: r.key, group: r.group, ok: r.ok, steps: r.steps.length, stepsOk: r.steps.filter((s) => s.ok).length, restoreOk: r.restoreOk })), failures };
	if (!only) {
		const outDir = path.join(c.dir, 'tools', 'out'); fs.mkdirSync(outDir, { recursive: true });
		fs.writeFileSync(path.join(outDir, 'coverage.json'), `${JSON.stringify(report, null, 1)}\n`);
		const md = ['# Journey coverage', '', `${totals.passing}/${totals.journeys} journeys play end to end · ${totals.steps} steps · ${totals.built} on built screens · ${totals.stub} on stubs`, '',
			'| journey | group | result | steps | ok | restore |', '|---|---|---|---:|---:|---|', ...report.journeys.map((j) => `| \`${j.key}\` | ${j.group} | ${j.ok ? 'pass' : '**FAIL**'} | ${j.steps} | ${j.stepsOk} | ${j.restoreOk === true ? 'ok' : j.restoreOk === false ? '**differs**' : '—'} |`),
			'', `## Failures (${failures.length})`, '', failures.length ? failures.map((f) => `- \`${f.journey}\` step ${f.step ?? '—'} ${f.screen ?? ''} [${f.kind}] ${f.detail}`).join('\n') : 'None.', ''];
		fs.writeFileSync(path.join(outDir, 'coverage.md'), md.join('\n'));
	}
	log(`\n${totals.passing}/${totals.journeys} journeys end to end · ${totals.steps} steps (${totals.stepsOk} ok) · ${totals.built} built · ${totals.stub} stub`);
	for (const f of failures) error(`  ${f.journey}#${f.step ?? '-'} ${f.screen ?? ''} [${f.kind}] ${f.detail}`);
	return failures.length ? 1 : 0;
}
