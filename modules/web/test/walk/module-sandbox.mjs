#!/usr/bin/env node
// cr-modules-008 task 8, dt web half: a workspace module's app runs in a sandboxed frame under /_frames/<key>/ and
// reaches records only through the host's gate. A `probe` app makes every attempt the acceptance lines name and
// writes each outcome into its own DOM; the walk reads them through the frame, then grants a write and reads again.
// usage: node modules/web/test/walk/module-sandbox.mjs   (DT_WEB_APP_DIR, DT_ENGINE_DIR, DT_WALK_SHOTS optional)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { appDir, browser, checks, go, northwind, serve, shot, signedIn } from './support.mjs';

export const PROBE = `export default ({ registerApp, registerEdit, registerKindDefault, registerList }) => {
	const { defineComponent, h, onMounted } = window.Vue;
	const out = (k, v) => { document.body.dataset[k] = String(v); };
	const st = async (p, init) => { try { const r = await fetch(p, init); return r.status + ':' + JSON.stringify(await r.json()).slice(0, 300); } catch (e) { return 'threw'; } };
	const Probe = defineComponent({ setup() { onMounted(async () => {
		await window.__flooded;
		const post = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
		out('commit', await st('/api/commit', post({})));
		out('ownwrite', await st('/api/collections/projects/records', post({ name: 'Probe write' })));
		out('system', await st('/api/collections/collections/records', post({ name: 'x' })));
		out('regex', await st('/api/collections/projects/records?filter=' + encodeURIComponent(JSON.stringify({ name: { _regex: '^(a+)+$' } }))));
		out('relational', await st('/api/collections/tasks/records?filter=' + encodeURIComponent(JSON.stringify({ project: { name: { _eq: 'x' } } }))));
		out('info', await st('/api/info'));
		out('ownread', await st('/api/collections/projects/records?limit=100'));
		out('nonroute', await st('/api/records-batch'));
		out('layerpatch', await st('/api/collections/projects/records/harbor-mutual-archive', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }));
		out('layerdelete', await st('/api/collections/projects/records/harbor-mutual-archive', { method: 'DELETE' }));
		try { await fetch(location.protocol + '//127.0.0.1:9/api/info'); out('absolute', 'reached'); } catch { out('absolute', 'failed'); }
		try { out('cookie', JSON.stringify(document.cookie)); } catch { out('cookie', 'threw'); }
		try { localStorage.length; out('storage', 'readable'); } catch { out('storage', 'threw'); }
		try { parent.document.title; out('parentdoc', 'readable'); } catch { out('parentdoc', 'threw'); }
		const d = document.createElement('div'); d.innerHTML = '<img src="data:," onerror="document.body.dataset.onerror=\\'ran\\'">'; document.body.appendChild(d);
		const s = document.createElement('script'); s.src = 'https://example.com/x.js'; s.onerror = () => out('extscript', 'refused'); s.onload = () => out('extscript', 'LOADED'); document.head.appendChild(s);
		const flood = await Promise.all(Array.from({ length: 120 }, () => fetch('/api/collections/projects/records?limit=1').then((r) => r.status)));
		out('flood429', flood.filter((x) => x === 429).length);
		setTimeout(() => out('done', '1'), 600);
	}); return () => h('p', { class: 'probe' }, 'probe'); } });
	if (!window.__flooded) { window.__flooded = Promise.all(Array.from({ length: 120 }, () => fetch('/api/collections/projects/records?limit=1').then((r) => r.status))).then((a) => { document.body.dataset.regflood = String(a.filter((x) => x === 429).length); }); }
	registerApp({ id: 'probe', label: 'Probe', icon: 'beaker', routes: [{ path: '', component: Probe }] });
	registerEdit({ id: 'input', name: 'hijack', types: ['string'], component: { render: () => h('b', 'HIJACK') } });
	registerKindDefault('edit', 'string', 'probe-edit');
	registerEdit({ id: 'probe-edit', name: 'probe edit', types: ['string'], component: { render: () => h('b', 'PROBE-EDIT') } });
};
`;

const { ok, done } = checks();
appDir();
const f = await northwind();
const file = path.join(f.root, 'modules', 'default', 'ui', 'app.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, PROBE);
ok(f.dt('compile').status === 0, 'dt compile stages the probe');
const git = (cwd) => execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }) + execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
const layer = path.join(f.root, 'git_modules', 'northwind-archive');
const before = [git(f.root), git(layer)];
const b = await browser();
async function probeRun(label) {
	const s = await serve(f.root);
	try {
		const { page } = await signedIn(b, s.url);
		const consoleLog = []; page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
		const frameRequests = [];
		page.on('requestfinished', (r) => { const fr = r.frame(); if (fr && fr.url().includes('/_frames/') && !r.url().startsWith('blob:') && !r.url().includes('/_frames/')) frameRequests.push(r.url()); });
		await go(page, '/a/probe');
		await page.waitForTimeout(800);
		const frameEl = await page.waitForSelector('iframe[title="module app default"]:not([style*="display:none"])', { timeout: 15_000 });
		const sandbox = await frameEl.getAttribute('sandbox');
		const fr = await frameEl.contentFrame();
		await fr.waitForFunction(() => document.body.dataset.done === '1', null, { timeout: 30_000 }).catch(async (e) => {
			console.log('PARTIAL', JSON.stringify(await fr.evaluate(() => ({ ...document.body.dataset, html: document.body.innerHTML.slice(0, 200) }))));
			console.log('CONSOLE\n' + consoleLog.join('\n'));
			throw e;
		});
		const data = await fr.evaluate(() => ({ ...document.body.dataset }));
		await page.screenshot({ path: shot(`module-sandbox-${label}`) });
		const reg = page.frames().find((x) => /\/_frames\/[^/]+\/default\/registry\.html$/.test(x.url()));
		data.regflood = reg ? await reg.evaluate(() => document.body.dataset.regflood ?? 'none') : 'no registry frame';
		return { page, s, data, sandbox, frameUrl: fr.url(), frameRequests };
	} catch (e) { await s.stop(); throw e; }
}

try {
	const r = await probeRun('no-grant');
	const d = r.data;
	console.log(JSON.stringify(d, null, 1).slice(0, 2500));
	ok(r.sandbox === 'allow-scripts', 'line 2: the frame is sandbox="allow-scripts" only', r.sandbox);
	// one listener (cr-modules-017): the frame document is served under /_frames/<key>/, and its CSP sandbox gives it an
	// opaque origin — the no-cookie, no-storage and no-parent-document checks below are what that origin buys
	ok(/\/_frames\/[^/]+\/default\/app\.html$/.test(r.frameUrl), 'line 2: the frame document comes from /_frames/<key>/', r.frameUrl);
	ok(d.commit?.startsWith('403:'), 'line 1: POST /api/commit is 403', d.commit);
	ok(d.ownwrite?.startsWith('403:') && /no write is granted/.test(d.ownwrite), 'line 1: a write to its own collection without a grant is 403 with the grant sentence', d.ownwrite);
	ok(d.system?.startsWith('403:'), 'line 1: a schema write is 403', d.system);
	ok(d.regex?.startsWith('400:'), 'line 9: _regex is 400', d.regex);
	ok(d.relational?.startsWith('400:'), 'line 3: a relational filter is 400', d.relational);
	ok(d.info?.startsWith('200:') && d.info.includes('"user":null'), 'line 12: /info gives no user', d.info);
	ok(d.ownread?.startsWith('200:') && !d.ownread.includes('"sources"'), 'line 4: its own collection reads, reshaped (no sources)', d.ownread?.slice(0, 80));
	ok(d.nonroute?.startsWith('404:'), 'a path that is no route answers 404, so a bundle fallback runs', d.nonroute);
	ok(d.absolute === 'failed', 'line 2: an absolute fetch fails', d.absolute);
	ok((d.cookie === '""' || d.cookie === 'threw') && d.storage === 'threw' && d.parentdoc === 'threw', 'line 2: no cookie, no storage, no parent document', `${d.cookie} ${d.storage} ${d.parentdoc}`);
	ok(d.onerror === undefined, 'line 14: an on* attribute inserted as HTML runs no script', d.onerror);
	ok(d.extscript === 'refused', 'line 2: a created external script is refused', d.extscript);
	ok(Number(d.flood429) > 0, 'line 10: a frame flooding past the queue (4 in flight + 64 queued) is answered 429 beyond it', d.flood429);
	ok(Number(d.regflood) > 0, 'line 10: the hidden registry frame is bounded too', d.regflood);
	ok(d.layerpatch?.startsWith('403:') && d.layerdelete?.startsWith('403:'), 'line 1: no grant, no PATCH or DELETE of any record', `${d.layerpatch?.slice(0, 60)} | ${d.layerdelete?.slice(0, 60)}`);
	ok(r.frameRequests.length === 0, 'line 2: no request from the frame reached any server after its navigation (blob: is local)', JSON.stringify(r.frameRequests.slice(0, 3)));
	const t0 = Date.now(); await go(r.page, '/content/projects'); await r.page.waitForSelector('.dt-table, table', { timeout: 5000 }).catch(() => {});
	ok(Date.now() - t0 < 2000 + 800, 'line 10: the editor still answers within 2 s', `${Date.now() - t0} ms`);
	const html = await r.page.content();
	ok(!html.includes('HIJACK') && !html.includes('PROBE-EDIT'), 'line 1: registering input or a string kind default replaces no built-in editor');
	await r.s.stop();
	ok(git(f.root) === before[0] && git(layer) === before[1], 'line 1: the HQ and the layer are unchanged (status and HEAD)');

	fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), JSON.stringify({ 'dreamteamer.moduleApps': { default: { writes: ['projects'] } } }));
	const g = await probeRun('grant');
	ok(g.data.ownwrite?.startsWith('200:'), 'line 4: with a grant its own-collection write lands', g.data.ownwrite);
	ok(g.data.commit?.startsWith('403:'), 'line 1: still no commit with a grant', g.data.commit);
	ok(g.data.layerpatch?.startsWith('403:') && /held by northwind-archive/.test(g.data.layerpatch), 'line 8: with a grant, a PATCH of a record the layer holds is refused', g.data.layerpatch);
	ok(g.data.layerdelete?.startsWith('403:') && /held by northwind-archive/.test(g.data.layerdelete), 'line 8: with a grant, a DELETE of a record the layer holds is refused', g.data.layerdelete);
	await g.s.stop();
	const changed = execFileSync('git', ['status', '--porcelain', '--', 'data'], { cwd: f.root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
	ok(changed.length === 1 && /data\/projects\//.test(changed[0]), 'line 4: git shows one new projects record in the workspace (the module home)', JSON.stringify(changed));
	ok(git(layer) === before[1], 'line 8: the layer is untouched', '');
} finally {
	await b.close();
	f.cleanup();
}
process.exit(done());
