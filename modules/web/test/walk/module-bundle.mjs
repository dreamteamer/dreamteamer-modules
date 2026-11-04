#!/usr/bin/env node
// The module-bundle walk (cr-modules-005 line 9, the browser half): a workspace module ships a PREBUILT app
// bundle (`modules/default/ui/app.js`, no build step, Vue from window.Vue) whose page calls fetch('/api/…');
// `dt compile` stages it to .dreamteamer/ui/; since cr-modules-008 dt web serves it inside a sandboxed module frame
// from the files origin (/_dt/frame/), and the frame renders the count the bridge answered. The same file, unchanged, is what the extension loads (the VS Code
// half: the CDP smoke on the same fixture).
// usage: node modules/web/test/walk/module-bundle.mjs   (DT_WEB_APP_DIR, DT_ENGINE_DIR, DT_WALK_SHOTS optional)
import fs from 'node:fs';
import path from 'node:path';
import { appDir, browser, checks, go, northwind, serve, shot, signedIn } from './support.mjs';

export const BUNDLE = `// a prebuilt module app: no imports, Vue from the host
export default ({ registerApp }) => {
	const { defineComponent, h, ref, onMounted } = window.Vue;
	const Stats = defineComponent({
		setup() {
			const line = ref('counting…');
			onMounted(async () => {
				const res = await fetch('/api/collections/projects/records?limit=100');
				const body = await res.json();
				const n = Array.isArray(body) ? body.length : (body.records ?? body.data ?? []).length;
				line.value = res.ok ? 'Northwind projects: ' + n : 'refused: ' + res.status;
			});
			return () => h('p', { class: 'northwind-stats' }, line.value);
		},
	});
	registerApp({ id: 'northwind-stats', name: 'Northwind stats', icon: 'graph', routes: [{ path: '', component: Stats }] });
};
`;

if (import.meta.url === `file://${process.argv[1]}`) {
	appDir();
	const { ok, done } = checks();
	const f = await northwind();
	const file = path.join(f.root, 'modules', 'default', 'ui', 'app.js');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, BUNDLE);
	const c = f.dt('compile');
	ok(c.status === 0, 'dt compile stages the bundle', `exit ${c.status}`);
	const staged = fs.readdirSync(path.join(f.root, '.dreamteamer', 'ui'));
	ok(staged.length === 1 && fs.readFileSync(path.join(f.root, '.dreamteamer', 'ui', staged[0], 'app.js'), 'utf8') === BUNDLE, 'the staged bundle is the file as written', staged.join(','));
	const s = await serve(f.root);
	const b = await browser();
	try {
		const { page, errors } = await signedIn(b, s.url);
		const loaded = [];
		page.on('response', (r) => { if (r.url().includes('/_dt/frame/') || r.url().includes('/ui-modules/')) loaded.push(`${r.status()} ${new URL(r.url()).pathname.replace(/^\/[^/]+/, '')}`); });
		await page.reload();
		await page.waitForSelector('.dt-nav-row', { timeout: 30_000 });
		await go(page, '/a/northwind-stats');
		const frame = await (await page.waitForSelector('iframe[title="module app default"]:not([style*="display:none"])', { timeout: 15_000 })).contentFrame();
		const line = await frame.waitForSelector('.northwind-stats', { timeout: 10_000 }).then(async (e) => { await frame.waitForFunction(() => !/counting/.test(document.querySelector('.northwind-stats').textContent), null, { timeout: 10_000 }).catch(() => {}); return e.textContent(); }, () => '');
		ok(loaded.some((l) => l === '200 /_dt/frame/default/app.html') && !loaded.some((l) => l.includes('/ui-modules/')), 'the bundle is served in its module frame, never from /ui-modules/', JSON.stringify(loaded));
		ok(line === 'Northwind projects: 3', "the module's page renders what its fetch('/api/…') answered", JSON.stringify(line));
		await page.screenshot({ path: shot('module-bundle') });
		ok(errors.length === 0, 'no page errors (CSP included)', JSON.stringify(errors.slice(0, 3)));
	} finally {
		await b.close();
		await s.stop();
		f.cleanup();
	}
	process.exit(done());
}
