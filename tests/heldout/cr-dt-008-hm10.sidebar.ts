/**
 * The sidebar half of held-out cr-dt-008-hm10 — bundled and run by cr-dt-008-hm10.test.mjs, never by the ui runner.
 * Renders the REAL NavSidebar.vue over a model (process.env.HM10_CASES: [{ id, model, gesture }]) and performs one
 * gesture per case through the row menu (move-up · move-down · move-top · move-bottom) or a drop (drop: [from, to]),
 * then prints the PATCH /nav bodies it sent as one JSON line prefixed HM10:.
 */
import { onHostRequest, requests, resetHost } from '../../modules/ui/test/webview/host-stub';
import { all, flush, render, unmountAll, type TestNode } from '../../modules/ui/test/webview/render';
import { createMemoryHistory, createRouter } from 'vue-router';
import NavSidebar from '../../modules/ui/src/components/NavSidebar.vue';

type Case = { id: string; model: unknown[]; gesture: { menu?: [string, string]; drop?: [string, string]; open?: string[] } };
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
const rowOf = (root: TestNode, key: string) => {
	const r = all(root, (n) => n.tag === 'li' && n.props['data-key'] === key)[0];
	if (!r) throw new Error(`no row ${key}`);
	return r;
};
async function open(root: TestNode, key: string) {
	(all(rowOf(root, key), (n) => n.props['class'] === 'dt-nav-twisty')[0].props['onClick'] as (e: unknown) => void)({ stopPropagation() {} });
	await flush();
}
async function drop(root: TestNode, from: string, to: string, y = 18) {
	const store = new Map<string, string>();
	const dataTransfer = { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '', effectAllowed: '', dropEffect: '' };
	const at = { clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 200, width: 200 }) } };
	const ev = () => ({ ...at, dataTransfer, preventDefault() {}, stopPropagation() {} });
	(rowOf(root, from).props['onDragstart'] as (e: unknown) => void)(ev());
	await flush();
	(rowOf(root, to).props['onDragover'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
	(rowOf(root, to).props['onDrop'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
}
async function menu(root: TestNode, key: string, id: string) {
	(rowOf(root, key).props['onContextmenu'] as (e: unknown) => void)({ clientX: 40, clientY: 60, preventDefault() {}, stopPropagation() {} });
	await flush();
	const item = all(root, (n) => n.tag === 'button' && n.props['data-id'] === id)[0];
	if (!item) throw new Error(`no menu item ${id} on ${key}`);
	if (item.props['disabled'] === true) return 'disabled';
	(item.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} });
	await flush();
	return 'sent';
}

const cases: Case[] = JSON.parse(process.env.HM10_CASES ?? '[]');
const out: Record<string, { patches: unknown[]; state?: string }> = {};
for (const c of cases) {
	resetHost();
	onHostRequest((method, path, body) => {
		if (method === 'GET' && path === '/nav') return c.model;
		if (method === 'PATCH' && path === '/nav') return { doc: { tree: [], hidden: [] } };
		throw new Error(`unexpected ${method} ${path} ${JSON.stringify(body)}`);
	});
	const root = await render(NavSidebar, {}, [router()]);
	for (const k of c.gesture.open ?? []) await open(root, k);
	let state: string | undefined;
	if (c.gesture.menu) state = await menu(root, c.gesture.menu[0], c.gesture.menu[1]);
	if (c.gesture.drop) await drop(root, c.gesture.drop[0], c.gesture.drop[1]);
	out[c.id] = { patches: requests.filter((r) => r.method === 'PATCH' && r.path === '/nav').map((r) => r.body), ...(state ? { state } : {}) };
	unmountAll();
}
console.log(`HM10:${JSON.stringify(out)}`);
