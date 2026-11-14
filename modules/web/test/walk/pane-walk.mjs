#!/usr/bin/env node
// The pane walk (cr-modules-017, acceptance lines 3–7; stories s3 and s5) on two synthetic Northwind workspaces that
// share one machine's state, in headless Chromium, the bin driven as a chat session drives it:
//   a. `dt web open tasks` → the page shows the tasks list, with no 401
//   b. a record's .html file framed by the page (sandboxed, as the page frames one) cannot read /api with the session
//   c. at Read the chip reads Read and a field edit is refused naming Read; lowered from Edit in the menu, the chip
//      reads Read and the menu offers no raise
//   d. two rows ticked → `dt web selection` prints both; `dt web show <ref>` moves the page; `dt web select` ticks
//   e. after the hook's GET /_dt/pane?hook=1, Ask in chat shows Waiting; the hook bin's next run prints the queued
//      line, and the item shows Delivered
//   f. the switcher lists the second workspace (stopped); choosing it lands on its page with no sign-in step
//   g. at 320 px (a narrow desktop pane) the chip and its menu are reachable and inside the page, the name truncates,
//      the raise notice takes its own row, and the page does not scroll sideways
//   h. a server restart under that open page (dt web stop, then a verb that starts it): the page shows the signed-out
//      sentence ON ITS OWN, with no click and no raw 401 (the h8 amendment; sessions live in memory only)
// usage: node modules/web/test/walk/pane-walk.mjs [<shots dir>]     (DT_WEB_APP_DIR, DT_ENGINE_DIR optional)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, browser, checks, go, paneWorkspace, serve, shot, signedIn, WEB } from './support.mjs';

if (process.argv[2]) process.env.DT_WALK_SHOTS = path.resolve(process.argv[2]);
appDir();
const { ok, done } = checks();
const step = (name) => shot(`pane-${name}`);
const dirs = { runtime: fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-pane-rt-')), state: fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-pane-state-')) };
const a = await paneWorkspace('northwind', { tasks: ['Call the bank', 'File taxes'] });
const other = await paneWorkspace('harbor');
const s = await serve(a.root, { dirs });
const b = await browser();
const HOOK = path.join(WEB, 'bin', 'dt-web-hook.mjs');
const runOther = (...args) => spawnSync(process.execPath, [path.join(WEB, 'bin', 'dt-web.mjs'), other.root, ...args], { env: s.env, encoding: 'utf8', timeout: 30_000 });
const urlOf = (out) => /^✔ open in the pane: (\S+)$/m.exec(out ?? '')?.[1];
const chip = (page) => page.$eval('.dt-pane-bar__chip', (e) => e.textContent.trim()).catch(() => '');
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
const until = (page, fn, arg, ms = 10_000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const ticked = (page) => page.$$eval('tbody .dt-table__checkbox-col input:checked', (e) => e.length).catch(() => -1);
const tick = async (page, name) => {
	const row = page.locator('tbody tr', { hasText: name }).first();
	await row.locator('.dt-table__checkbox-col input').click();
};

try {
	// a — one step: `dt web open tasks`, the URL from its first line, the tasks list with no 401
	const opened = s.run('open', 'tasks');
	const url = urlOf(opened.stdout);
	ok(Boolean(url) && opened.stdout.split('\n')[0].startsWith('✔ open in the pane: http://127.0.0.1:'), 'a: dt web open prints the sign-in URL first', (opened.stdout.split('\n')[0] ?? '').replace(/sign-in\/\S+/, 'sign-in/<code>'));
	const { page, errors, context } = await signedIn(b, url);
	const unauthorised = [];
	page.on('response', (r) => { if (r.status() === 401) unauthorised.push(new URL(r.url()).pathname); });
	ok(await until(page, () => decodeURIComponent(location.hash).startsWith('#/content/tasks') && document.body.innerText.includes('Brief Dana')), 'a: the page shows the tasks list', await hash(page));
	await page.waitForTimeout(600);
	ok(unauthorised.length === 0, 'a: no request answered 401', JSON.stringify(unauthorised));
	ok((await chip(page)) === 'Edit', 'a: the pane bar draws, the chip reads the stored level', await chip(page));
	await page.screenshot({ path: step('a-open') });

	// b — a record's .html file in a sandboxed frame: its script either never runs (the files policy is `sandbox`) or
	// its read of /api fails; either way it reads nothing with the pane's session
	fs.mkdirSync(path.join(a.root, 'data', 'notes'), { recursive: true });
	fs.writeFileSync(path.join(a.root, 'data', 'notes', 'probe.html'), `<!doctype html><script>
fetch('/api/info', { credentials: 'include' }).then(async (r) => parent.postMessage({ probe: 'answered', status: r.status, body: (await r.text()).slice(0, 80) }, '*'), (e) => parent.postMessage({ probe: 'failed', error: String(e) }, '*'));
</script>`);
	const probe = await page.evaluate(async () => {
		const host = await (await fetch('/api/host', { credentials: 'same-origin' })).json();
		return await new Promise((resolve) => {
			const f = document.createElement('iframe');
			f.setAttribute('sandbox', 'allow-scripts');
			f.src = `${host.filesBase}/w/data/notes/probe.html?frame=1`;
			const done = (v) => { window.removeEventListener('message', on); f.remove(); resolve(v); };
			const on = (e) => { if (e.data?.probe) done(e.data); };
			window.addEventListener('message', on);
			document.body.appendChild(f);
			setTimeout(() => done({ probe: 'no script ran' }), 4000);
		});
	});
	const readNothing = probe.probe === 'failed' || probe.probe === 'no script ran' || (probe.probe === 'answered' && probe.status === 403);
	ok(readNothing, 'b: a framed record file cannot read /api with the session', JSON.stringify(probe));

	// c — at Read: the chip, and a field edit refused naming Read
	const atRead = s.run('open', '--read', 'tasks/brief-dana');
	ok(/^level: Read$/m.test(atRead.stdout), 'c: dt web open --read sets the level', atRead.stdout.split('\n')[1]);
	await page.goto(urlOf(atRead.stdout));
	await page.waitForSelector('.dt-pane-bar__chip', { timeout: 30_000 });
	ok((await chip(page)) === 'Read', 'c: after the reload the chip reads Read', await chip(page));
	// the record page has drawn its value before the edit starts (an Edit pressed on a page still loading is lost)
	await until(page, () => document.body.innerText.includes('Brief Dana') && !!document.querySelector('button[title="Edit"]'), null, 15_000);
	await page.waitForTimeout(500);
	await page.click('button[title="Edit"]');
	await page.waitForSelector('[data-field="name"] input', { timeout: 10_000 });
	await page.fill('[data-field="name"] input', 'Brief Dana again');
	await page.click('button[title="Save"]');
	const refusal = await page.waitForSelector('.dt-detail-error', { timeout: 10_000 }).then((e) => e.textContent(), async () => `no refusal line; the page reads: ${(await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200)}`);
	ok(/is at Read/.test(refusal), 'c: a field edit shows a refusal naming Read', JSON.stringify(refusal.trim().slice(0, 140)));
	ok(!fs.readFileSync(path.join(a.root, 'data', 'tasks', 'brief-dana.task.md'), 'utf8').includes('again'), 'c: and nothing was written');
	await page.screenshot({ path: step('c-read-refused') });
	page.once('dialog', (d) => d.accept());
	await page.click('button[title="Cancel"]').catch(() => {});
	// lowered from Edit in the menu
	const atEdit = s.run('open', '--edit', 'tasks');
	await page.goto(urlOf(atEdit.stdout));
	await page.waitForSelector('.dt-pane-bar__chip', { timeout: 30_000 });
	ok((await chip(page)) === 'Edit', 'c: raised from the chat, the chip reads Edit', await chip(page));
	const notice = await page.$eval('.dt-pane-bar__notice', (e) => e.textContent.trim()).catch(() => '');
	ok(/^Edit since \d\d:\d\d — opened from the chat$/.test(notice), 'c: the raise notice draws beside the chip', notice);
	await page.click('.dt-pane-bar__chip');
	const lowers = await page.$$eval('.dt-pane-bar__lower', (e) => e.map((x) => x.textContent.trim()));
	ok(JSON.stringify(lowers) === '["Read"]', 'c: the menu offers Read only', JSON.stringify(lowers));
	await page.click('.dt-pane-bar__lower[data-level="read"]');
	ok(await until(page, () => document.querySelector('.dt-pane-bar__chip')?.textContent.trim() === 'Read'), 'c: lowered in the menu, the chip reads Read', await chip(page));
	await page.click('.dt-pane-bar__chip');
	const after = await page.$$eval('.dt-pane-bar__lower', (e) => e.length);
	const hint = await page.$eval('.dt-pane-bar__hint', (e) => e.textContent.trim()).catch(() => '');
	ok(after === 0 && hint === 'To raise it, ask in the chat', 'c: and the menu offers no raise', `${after} items · ${hint}`);
	ok(/level Read/.test(s.run('status').stdout), 'c: dt web status reads the lowered level');
	await page.screenshot({ path: step('c-lowered') });
	await page.click('.dt-pane-bar__chip');

	// d — the selection both ways (story s3); back at Edit so the rest of the walk can queue
	s.run('open', '--edit');
	await page.reload();
	await page.waitForSelector('.dt-pane-bar__chip', { timeout: 30_000 });
	await go(page, '/content/tasks');
	await page.waitForSelector('tbody tr', { timeout: 15_000 });
	await tick(page, 'Brief Dana');
	await tick(page, 'Call the bank');
	await page.waitForTimeout(700);
	const sel = s.run('selection');
	ok(/^showing: tasks · List$/m.test(sel.stdout) && /^tasks\/brief-dana$/m.test(sel.stdout) && /^tasks\/call-the-bank$/m.test(sel.stdout), 'd: two ticked rows → dt web selection prints both', JSON.stringify(sel.stdout.trim()));
	await page.screenshot({ path: step('d-ticked') });
	const shown = s.run('show', 'tasks/file-taxes');
	ok(shown.status === 0 && await until(page, () => decodeURIComponent(location.hash) === '#/content/tasks/file-taxes'), 'd: dt web show <ref> moves the page', `${shown.stdout.trim()} · ${await hash(page)}`);
	await page.waitForTimeout(500);
	const placed = s.run('selection');
	ok(/^showing: tasks\/file-taxes$/m.test(placed.stdout), 'd: and the page reports the record it moved to', JSON.stringify(placed.stdout.trim()));
	const selected = s.run('select', 'tasks/brief-dana', 'tasks/file-taxes');
	ok(selected.status === 0, 'd: dt web select answers', selected.stdout.trim());
	const both = await until(page, () => document.querySelectorAll('tbody .dt-table__checkbox-col input:checked').length === 2 && document.body.innerText.includes('2 selected'));
	ok(both && /#\/content\/tasks$/.test(decodeURIComponent(await page.evaluate(() => location.hash))), 'd: dt web select moves to the list and ticks the two rows', `${await ticked(page)} ticked · ${await hash(page)}`);
	const rows = await page.$$eval('tbody tr', (trs) => trs.filter((tr) => tr.querySelector('.dt-table__checkbox-col input:checked')).map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
	ok(rows.length === 2 && rows.some((r) => r.includes('Brief Dana')) && rows.some((r) => r.includes('File taxes')), 'd: the ticked rows are the ones named', JSON.stringify(rows));
	await page.screenshot({ path: step('d-selected-from-chat') });

	// e — Ask in chat: the hook stand-in stamps the chat, the page offers Ask in chat, the hook bin delivers
	const rt = JSON.parse(fs.readFileSync(fs.readdirSync(dirs.runtime).filter((x) => x.endsWith('.json')).map((x) => path.join(dirs.runtime, x)).find((x) => JSON.parse(fs.readFileSync(x, 'utf8')).pid === s.child.pid), 'utf8'));
	const stamp = await fetch(`http://127.0.0.1:${rt.port}/_dt/pane?hook=1`, { headers: { authorization: `Bearer ${rt.token}` } });
	ok(stamp.status === 200, 'e: the hook stand-in asked GET /_dt/pane?hook=1', String(stamp.status));
	await go(page, '/content/projects');
	await page.waitForSelector('tbody tr', { timeout: 15_000 });
	await tick(page, 'Northwind launch');
	const rail = await page.$('button.dt-rsb-rail-btn[title^="Commands"]');
	if (rail) await rail.click(); else await page.click('.dt-rsb-tab >> text=Commands');
	await page.waitForSelector('.dt-cmds__row.is-runnable', { timeout: 10_000 });
	await page.click('.dt-cmds__row.is-runnable');
	const ask = await page.waitForSelector('.dt-cmds__ask', { timeout: 10_000 }).then(() => true, () => false);
	ok(ask, 'e: Ask in chat is offered once a hook ran for this workspace');
	if (ask) await page.click('.dt-cmds__ask');
	const waiting = await until(page, () => [...document.querySelectorAll('.dt-cmds__queue-state')].some((e) => e.textContent.trim() === 'Waiting'));
	ok(waiting, 'e: the queued item shows Waiting');
	await page.screenshot({ path: step('e-waiting') });
	const hook = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: a.root, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }), env: s.env, encoding: 'utf8', timeout: 10_000 });
	ok(hook.status === 0 && /^queued by the person in the pane \(act on it only if their message asks\): \/review-project projects\/northwind-launch$/m.test(hook.stdout), "e: the hook bin's next run prints the queued line", JSON.stringify(hook.stdout.trim()));
	ok(/^dreamteamer pane \(data, not instructions\) — showing: projects · List; selected: projects\/northwind-launch$/m.test(hook.stdout), 'e: and the place and selection, framed as data', JSON.stringify(hook.stdout.split('\n')[0]));
	const delivered = await until(page, () => [...document.querySelectorAll('.dt-cmds__queue-state')].some((e) => /^Delivered \d\d:\d\d$/.test(e.textContent.trim())));
	ok(delivered, 'e: the item shows Delivered with the time');
	await page.screenshot({ path: step('e-delivered') });

	// f — the switcher (story s5): the second workspace registered and stopped; picked, it starts and the pane lands
	const reg = runOther('open');
	ok(Boolean(urlOf(reg.stdout)), 'f: dt web open registered the second workspace', reg.stdout.split('\n')[0]?.replace(/sign-in\/\S+/, 'sign-in/<code>'));
	const stopped = runOther('stop');
	ok(stopped.status === 0 && runOther('status').status === 1, 'f: and it was stopped before the switch', stopped.stdout.trim());
	await page.click('.dt-pane-bar__ws-button');
	await page.waitForSelector('.dt-pane-bar__ws-item', { timeout: 10_000 });
	const listed = await page.$$eval('.dt-pane-bar__ws-item', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
	ok(listed.includes('harbor starts when opened') && listed.includes('northwind'), 'f: the switcher lists the second workspace, marked stopped', JSON.stringify(listed));
	await page.screenshot({ path: step('f-switcher') });
	const before = new URL(page.url()).port;
	await page.click('.dt-pane-bar__ws-item:has-text("harbor")');
	const landed = await page.waitForURL((u) => u.port !== before && u.pathname.startsWith('/app/'), { timeout: 30_000 }).then(() => true, () => false);
	const nav = landed && await page.waitForSelector('.dt-nav-row', { timeout: 30_000 }).then(() => true, () => false);
	const name = await page.$eval('.dt-pane-bar__ws-button', (e) => e.textContent.trim()).catch(() => '');
	ok(landed && nav && name === 'harbor', 'f: choosing it lands on its page, signed in, with no sign-in step', `${page.url().replace(/sign-in\/\S+/, 'sign-in/<code>')} · ${name}`);
	ok(runOther('status').status === 0, 'f: the second workspace runs now');
	const moved = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: a.root }), env: s.env, encoding: 'utf8', timeout: 10_000 });
	ok(/^dreamteamer pane moved to workspace "harbor"$/m.test(moved.stdout), "f: the first workspace's hook says the pane moved", JSON.stringify(moved.stdout.trim()));
	await page.screenshot({ path: step('f-landed') });

	// the refusals the walk asked for: the Read edit (403) and the probe's blocked script (step b)
	const real = errors.filter((e) => !/status of (400|403)/.test(e) && !/probe\.html.*sandboxed/.test(e));
	ok(real.length === 0, 'no page errors besides the refusals the walk asked for', JSON.stringify(real.slice(0, 3)));
	await context.close();

	// g — a narrow pane: 320 × 640, Admin with its raise notice, the page of the first workspace
	const SIGNED_OUT = 'This pane is signed out. Ask the chat to show it again — it runs dt web open.';
	const admin = s.run('open', '--admin');
	const narrow = await signedIn(b, urlOf(admin.stdout), { viewport: { width: 320, height: 640 } });
	await narrow.page.waitForSelector('.dt-pane-bar__chip', { timeout: 10_000 });
	await narrow.page.click('.dt-pane-bar__chip');
	await narrow.page.waitForSelector('.dt-pane-bar__level .dt-pane-bar__menu', { timeout: 5_000 }).catch(() => null);
	const fit = await narrow.page.evaluate(() => {
		const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, right: r.right, y: r.top, bottom: r.bottom }; };
		const topmost = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(t && (t === e || e.contains(t))); };
		const area = box('.dt-page-area');
		const name = document.querySelector('.dt-pane-bar__ws-button');
		return { area, chip: box('.dt-pane-bar__chip'), menu: box('.dt-pane-bar__level .dt-pane-bar__menu'), notice: box('.dt-pane-bar__notice'), chipTop: topmost('.dt-pane-bar__chip'), itemTop: topmost('.dt-pane-bar__lower'), nameFits: name ? name.scrollWidth <= name.clientWidth || getComputedStyle(name).textOverflow === 'ellipsis' : false, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth };
	});
	const within = (bx) => Boolean(bx && fit.area && bx.x >= fit.area.x - 0.5 && bx.right <= fit.area.right + 0.5);
	ok(within(fit.chip) && fit.chipTop, 'g: at 320 px the level chip is inside the page and reachable', JSON.stringify({ area: fit.area, chip: fit.chip }));
	ok(within(fit.menu) && fit.itemTop, 'g: its menu opens inside the page, its first item reachable', JSON.stringify(fit.menu));
	ok(fit.nameFits && !fit.sideways, 'g: the name fits or truncates with an ellipsis, and the page does not scroll sideways');
	ok(Boolean(fit.notice && fit.chip && fit.notice.y >= fit.chip.bottom - 0.5), 'g: the raise notice takes a row of its own below the chip', JSON.stringify(fit.notice));
	await narrow.page.screenshot({ path: step('g-narrow') });
	await narrow.page.keyboard.press('Escape');

	// h — a restart under that open page: the signed-out sentence comes on its own, with no click
	const stoppedA = s.run('stop');
	const restarted = s.run('selection');
	ok(stoppedA.status === 0 && restarted.status === 0, 'h: dt web stop, then dt web selection starts the server again', `${stoppedA.stdout.trim()} · ${restarted.stdout.split('\n')[0]}`);
	const out = await until(narrow.page, (want) => document.body.innerText.includes(want), SIGNED_OUT, 15_000);
	const seen = await narrow.page.evaluate(() => document.body.innerText);
	ok(out, 'h: the page shows the signed-out sentence on its own, with no click', out ? '' : JSON.stringify(seen.slice(0, 120)));
	ok(!/\b401\b|unauthori[sz]ed|sign in first/i.test(seen), 'h: and no raw 401 text');
	await narrow.page.screenshot({ path: step('h-signed-out') });
	await narrow.context.close();
} finally {
	await b.close();
	runOther('stop');
	s.run('stop'); // h restarted the first workspace's server detached; the foreground one is gone
	await s.stop();
	a.cleanup();
	other.cleanup();
	for (const d of Object.values(dirs)) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(done());
