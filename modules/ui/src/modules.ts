/**
 * MODULE APPS (cr-modules-008) — a module's `ui/app.js` never runs in this page. Each module gets a hidden
 * REGISTRY frame that loads its bundle and says what it registered; the host registers a PROXY for each free id
 * (D9) and draws it as a SURFACE frame where the mount rule allows (D10), else the built-in. Every request,
 * intent, navigation and value a frame sends is checked here — requests by @dreamteamer/protocol's gate under
 * the module's scope, built from the compiled runtime and the person's grant (__DT_MODULE_GRANTS__).
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component, type PropType } from 'vue';
import type { Router } from 'vue-router';
import { gate } from '@dreamteamer/protocol/gate';
import { reshape } from '@dreamteamer/protocol/reshape';
import { applyWrite } from '@dreamteamer/protocol/apply-write';
import { createFrameBridge } from '@dreamteamer/protocol/frame-bridge';
import { buildModuleScope } from '@dreamteamer/protocol/module-scope';
import { buildFrameDocument } from '@dreamteamer/protocol/frame-document';
import { loadServerInfo } from './api/info';
import { hostRequest } from './api/transport';
import { apps, edits, lists, panels, views, type ExtensionDefinition } from './registry/index';
import { moduleKindDefault, resolveEdit, resolveView } from './registry/resolve';
import { recordTitle } from './lib/record-titles';
import { buildSnapshot, checkIntent, checkNavigate, createBounds, forwardKey, invalidationFor, sanitizeCellHtml } from './modules/policy';

type AnyScope = ReturnType<typeof buildModuleScope> & { ownViews?: string[] };
declare global { interface Window { __DT_MODULE_GRANTS__?: Record<string, { reads: string[]; writes: string[] }>; __DT_FILES__?: string; __DT_UI_BASE__?: string; __DT_GUEST_URL__?: string; __DT_HOST__?: { moduleFrames?: 'url' | 'srcdoc' } } }

const bridge = createFrameBridge<{ handle: (msg: any) => void }>();
let descriptors: any[] = [];
const scopes = new Map<string, AnyScope>();
const registries = new Map<string, Window>();
const cellReplies = new Map<number, (cells: Array<{ key: string; html: string }>) => void>();
let routerRef: Router | null = null;
const warn = (m: string) => console.warn(`[modules] ${m}`);

if (typeof window !== 'undefined') {
	window.addEventListener('message', (ev) => { const a = bridge.accept(ev); if (a) a.meta.handle(a.msg); });
	window.addEventListener('message', (ev) => {
		const d = ev.data;
		if (d?.type !== 'dt:invalidate' || ev.source !== window && ev.source !== null && ev.source !== window.parent) return;
		for (const [, frame] of liveFrames) { const out = invalidationFor(frame.scope, d); if (out) frame.post({ op: 'invalidate', detail: out }); }
	});
}
const liveFrames = new Map<Window, { scope: AnyScope; post: (m: any) => void }>();

// ---- the frame document: by URL from the files origin (dt web) or as srcdoc (VS Code)
const texts = new Map<string, Promise<string>>();
const text = (url: string) => { if (!texts.has(url)) texts.set(url, fetch(url).then((r) => r.text())); return texts.get(url)!; };
async function frameSource(module: string, kind: string): Promise<{ src?: string; srcdoc?: string }> {
	if ((window.__DT_HOST__?.moduleFrames ?? 'srcdoc') === 'url') return { src: `${window.__DT_FILES__}/_dt/frame/${encodeURIComponent(module)}/${kind}.html` };
	const [guestText, bundleText] = await Promise.all([text(window.__DT_GUEST_URL__ ?? ''), text(`${window.__DT_UI_BASE__}/${module}/app.js`)]);
	return { srcdoc: buildFrameDocument({ guestText, bundleText, meta: true }).html };
}
async function makeFrame(module: string, kind: string, hidden = false): Promise<HTMLIFrameElement> {
	const f = document.createElement('iframe');
	f.setAttribute('sandbox', 'allow-scripts');
	f.setAttribute('title', `module app ${module}`);
	f.style.cssText = hidden ? 'display:none' : 'border:0;width:100%;display:block;min-height:24px';
	const s = await frameSource(module, kind);
	if (s.src) f.src = s.src; else f.srcdoc = s.srcdoc!;
	return f;
}

// ---- requests: the gate, then the transport, then reshape
async function answer(scope: AnyScope, bounds: ReturnType<typeof createBounds>, msg: any): Promise<{ status: number; body: unknown }> {
	if (!bounds.start()) return { status: 429, body: { error: `module app ${scope.module} has too many requests in flight` } };
	try {
		const [path, qs] = String(msg.path ?? '/').split('?');
		const decision: any = gate(scope as any, descriptors, msg.method, path, new URLSearchParams(qs ?? ''), msg.body);
		if (!decision.ok) { warn(decision.error); return { status: decision.status, body: { error: decision.error } }; }
		const handle = (m: string, p: string, b?: unknown) => hostRequest(m, p, b).then((body) => ({ status: 200, body }), (e: any) => ({ status: e?.status ?? 500, body: { error: e?.message ?? String(e) } }));
		if (decision.call.method === 'GET') {
			const q = new URLSearchParams(decision.call.query).toString();
			const r = await handle('GET', q ? `${decision.call.path}?${q}` : decision.call.path);
			return r.status === 200 ? { status: 200, body: reshape(decision.call.routeId, r.body, scope as any, decision.call.collection) } : r;
		}
		if (!bounds.write()) return { status: 429, body: { error: `module app ${scope.module} writes too fast (60 a minute)` } };
		if (decision.needsSource === 'home') {
			const id = decodeURIComponent(path.split('/records/')[1] ?? path.split('/position/')[1] ?? '');
			const rec = await handle('GET', `/collections/${encodeURIComponent(decision.call.collection)}/records/${id.split('/').map(encodeURIComponent).join('/')}`);
			const src = (rec.body as any)?.fields?.$source ?? (rec.body as any)?.$source;
			if (rec.status !== 200 || src !== scope.home) {
				const error = `module app ${scope.module} cannot write ${decision.call.collection}/${id}: the record is held by ${src ?? 'nobody'} — a module app writes only in ${scope.home}`;
				warn(error); return { status: 403, body: { error } };
			}
		}
		return await applyWrite(handle, decision);
	} finally { bounds.end(); }
}

// ---- a surface frame, drawn where a proxy mounts
const ModuleFrame = defineComponent({
	name: 'ModuleFrame',
	props: { module: { type: String, required: true }, kind: { type: String, required: true }, defId: { type: String, required: true }, frameProps: { type: Object, default: () => ({}) }, listState: { type: Object as PropType<any>, default: null }, collection: { type: String, default: '' } },
	emits: ['update:value'],
	setup(props, { emit }) {
		const host = ref<HTMLElement | null>(null);
		const scope = scopes.get(props.module)!;
		const bounds = createBounds();
		let win: Window | null = null;
		let posted = new Set<string>();
		const post = (m: any) => win && bridge.post(win, m);
		const snapshot = () => {
			const s = props.listState; if (!s) return null;
			const rows = s.items.items.value as Record<string, unknown>[];
			const row = (descriptors as any[]).find((d) => d.name === props.collection);
			const snap = buildSnapshot({
				scope, collection: props.collection, rows, total: s.items.total?.value ?? rows.length, pk: 'id',
				columns: (s.columns?.value ?? []).map((c: any) => ({ field: c.field, title: c.title, type: c.type, editable: c.editable })),
				selected: s.selectedIds?.value ?? new Set(), sort: { field: s.sortField?.value ?? null, desc: !!s.sortDesc?.value },
				titleOf: (r) => recordTitle(row ? { collection: row.name, record_title: row.display?.record_title ?? row.compiled?.defaults?.record_title } as any : null, r, String(r.id ?? '')), titleRefs: {},
				loading: s.items.loading?.value, error: s.items.error?.value ?? null,
			});
			posted = new Set(snap.ids);
			return { ...snap, hasPrev: s.hasPrev?.value, hasNext: s.hasNext?.value, from: s.from?.value, to: s.to?.value };
		};
		const route = () => { const r = routerRef?.currentRoute.value; return props.kind === 'app' ? { path: r?.path, fullPath: r?.fullPath, params: {}, query: r?.query ?? {} } : props.collection ? { path: `/content/${props.collection}${props.frameProps.record ? `/${(props.frameProps.record as any).id}` : ''}`, params: { path: props.frameProps.record ? `${props.collection}/${(props.frameProps.record as any).id}` : props.collection }, query: {} } : { path: '/', params: {}, query: {} }; };
		const handle = async (msg: any) => {
			const reply = (v: unknown) => win && bridge.reply(win, msg.id, v);
			switch (msg.op) {
				case 'request': reply(await answer(scope, bounds, msg)); break;
				case 'emit':
					if (msg.event === 'update:value' && props.kind === 'edit' && scope.writes.has(props.collection)) emit('update:value', msg.args?.[0]);
					else warn(`module app ${props.module} cannot change ${props.collection}: no write is granted`);
					break;
				case 'intent': {
					if (!bounds.intent()) { reply({ ok: false, error: `module app ${props.module} sends intents too fast` }); break; }
					const cols = (props.listState?.columns?.value ?? []).map((c: any) => c.field);
					const c = checkIntent(scope, props.collection, posted, msg.name, msg.args ?? [], cols);
					if (!c.ok) { warn(c.error!); reply(c); break; }
					const s = props.listState; const id = msg.args?.[0];
					const rowOf = () => s.items.items.value.find((r: any) => s.pkOf(r) === id);
					const run: Record<string, () => unknown> = {
						reload: () => s.items.reload(), setSort: () => s.items.setSort(id), setSortValue: () => s.setSortValue?.(id),
						openRecord: () => s.openRecord(rowOf()), toggleSelect: () => s.toggleSelect(id),
						toggleSelectAllVisible: () => s.toggleSelectAllVisible(), clearSelection: () => s.clearSelection(), prevPage: () => s.prevPage?.(), nextPage: () => s.nextPage?.(),
					};
					try { await run[msg.name]?.(); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e) }); }
					break;
				}
				case 'navigate': { const n = checkNavigate(scope, msg.to); if (!n.ok) { warn(n.error!); reply(n); break; } await (msg.replace ? routerRef?.replace(n.to!) : routerRef?.push(n.to!)); reply({ ok: true }); break; }
				case 'resize': { const f = host.value?.querySelector('iframe'); if (f && props.kind !== 'list' && props.kind !== 'app') f.style.height = `${Math.min(Number(msg.height) || 0, window.innerHeight)}px`; break; }
				case 'key': if (forwardKey(msg)) for (const t of [document, window]) t.dispatchEvent(new KeyboardEvent('keydown', { key: msg.key, code: msg.code, metaKey: msg.metaKey, ctrlKey: msg.ctrlKey, shiftKey: msg.shiftKey, altKey: msg.altKey, bubbles: true, cancelable: true })); break;
				case 'error': warn(`module app ${props.module}: ${msg.message}`); break;
			}
		};
		const onPaste = (e: ClipboardEvent) => { const f = host.value?.querySelector('iframe'); if (f && document.activeElement === f) post({ op: 'paste', text: e.clipboardData?.getData('text/plain') ?? '' }); };
		onMounted(async () => {
			const f = await makeFrame(props.module, props.kind);
			if (props.kind === 'list' || props.kind === 'app') f.style.height = '100%';
			let loads = 0;
			f.addEventListener('load', () => {
				if (!f.contentWindow) return;
				if (++loads === 1) { win = f.contentWindow; bridge.add(win, { handle }); liveFrames.set(win, { scope, post }); }
				bridge.loaded(f.contentWindow);
				if (loads === 1) post({ op: 'init', surface: 'surface', kind: props.kind, defId: props.defId, props: props.frameProps, state: snapshot(), route: route(), routes: [], theme: themeNow() });
				else if (win) liveFrames.delete(win);
			});
			host.value?.appendChild(f);
			document.addEventListener('paste', onPaste, true);
		});
		watch(() => props.frameProps, (p) => post({ op: 'props', props: p }), { deep: true });
		if (props.listState) watch(() => [props.listState.items.items.value, props.listState.selectedIds?.value, props.listState.sortField?.value, props.listState.sortDesc?.value, props.listState.items.loading?.value], () => post({ op: 'state', state: snapshot() }));
		if (props.kind === 'app') watch(() => routerRef?.currentRoute.value.fullPath, () => post({ op: 'route', route: route() }));
		onBeforeUnmount(() => { if (win) { bridge.remove(win); liveFrames.delete(win); } document.removeEventListener('paste', onPaste, true); });
		return () => h('div', { ref: host, class: 'dt-module-frame', style: props.kind === 'list' || props.kind === 'app' ? 'height:100%' : '' });
	},
});

function themeNow() {
	const vars: Record<string, string> = {};
	const cs = getComputedStyle(document.documentElement);
	for (let i = 0; i < cs.length; i++) { const n = cs[i]; if (n.startsWith('--dt-') || n.startsWith('--vscode-')) vars[n] = cs.getPropertyValue(n); }
	return { vars, scheme: document.body.className };
}

const stripCommit = (scope: AnyScope, collection: string, rec: unknown) => (rec && typeof rec === 'object' && !scope.own.has(collection) ? reshape('record-read', { id: (rec as any).id, fields: rec }, scope as any, collection) : rec);

// ---- cells (D5): markup from the registry frame, sanitized here
let cellSeq = 0;
function cellMarkup(module: string, viewId: string, cellProps: Record<string, unknown>): Promise<string> {
	const reg = registries.get(module);
	if (!reg) return Promise.resolve('');
	return new Promise((resolve) => {
		const id = ++cellSeq;
		cellReplies.set(id, (cells) => resolve(sanitizeCellHtml(cells[0]?.html ?? '')));
		bridge.post(reg, { op: 'render-cells', id, viewId, cells: [{ key: '0', props: cellProps }] });
		setTimeout(() => { if (cellReplies.delete(id)) resolve(''); }, 3000);
	});
}

function fieldProxy(module: string, kind: 'edit' | 'view', defId: string): Component {
	return defineComponent({
		name: `Module${kind}Proxy`,
		props: ['value', 'field', 'options', 'autofocus', 'saveHint', 'disabled', 'context', 'record'],
		emits: ['update:value'],
		setup(p: any, { emit }) {
			const scope = scopes.get(module)!;
			const collection = () => String(p.field?.collection ?? '');
			const html = ref('');
			return () => {
				const c = collection();
				if (!scope.reads.has(c)) {
					warn(`module app ${module} is not shown on ${c || 'this field'}: it is outside the app's read scope`);
					const fallback = kind === 'edit' ? resolveEdit({ ...p.field, editor: undefined }).entry.component : resolveView({ ...p.field, viewer: undefined }, p.context ?? 'cell').entry.component;
					return h(fallback, { ...p, 'onUpdate:value': (v: unknown) => emit('update:value', v) });
				}
				if (kind === 'view' && (p.context ?? 'cell') === 'cell') {
					void cellMarkup(module, defId, { value: p.value, field: p.field, options: p.options, context: 'cell' }).then((x) => { html.value = x; });
					return h('span', { class: 'dt-module-cell', style: 'contain:paint;overflow:hidden;display:inline-block;max-width:100%', innerHTML: html.value });
				}
				const frameProps = { value: p.value, field: p.field, options: p.options, autofocus: p.autofocus, saveHint: p.saveHint, context: p.context, disabled: kind === 'edit' ? (p.disabled || !scope.writes.has(c)) : undefined, record: stripCommit(scope, c, p.record) };
				return h(ModuleFrame, { module, kind, defId, collection: c, frameProps, 'onUpdate:value': (v: unknown) => emit('update:value', v) });
			};
		},
	});
}

function listProxy(module: string, defId: string): Component {
	return defineComponent({
		name: 'ModuleListProxy',
		props: ['state', 'collection', 'query', 'options'],
		setup(p: any) {
			const scope = scopes.get(module)!;
			return () => {
				if (!scope.reads.has(p.collection)) {
					warn(`module app ${module} is not shown on ${p.collection}: it is outside the app's read scope`);
					return h(lists.get('table')!.component, p);
				}
				return h(ModuleFrame, { module, kind: 'list', defId, collection: p.collection, listState: p.state, frameProps: { collection: p.collection, query: p.query, options: p.options } });
			};
		},
	});
}

function appProxy(module: string, defId: string): Component {
	return defineComponent({ name: 'ModuleAppProxy', setup: () => () => h(ModuleFrame, { module, kind: 'app', defId, collection: '', frameProps: {} }) });
}

function held(kind: string, id: string): string | null {
	const reg: any = { edit: edits, view: views, list: lists, app: apps, panel: panels }[kind];
	const e = reg?.get(id);
	return e ? ((e as any).__module ? `module app ${(e as any).__module}` : 'the editor') : null;
}

function register(module: string, d: any, router: Router) {
	const holder = held(d.kind, d.id);
	if (holder) { warn(`module app ${module} cannot register ${d.kind} '${d.id}': the id belongs to ${holder}`); return; }
	const base = { id: d.id, name: d.name ?? d.id, __module: module };
	if (d.kind === 'edit') edits.register({ ...base, types: d.types ?? [], scope: d.scope, component: fieldProxy(module, 'edit', d.id) } as ExtensionDefinition);
	else if (d.kind === 'view') views.register({ ...base, types: d.types ?? [], scope: d.scope, component: fieldProxy(module, 'view', d.id) } as ExtensionDefinition);
	else if (d.kind === 'list') lists.register({ ...base, fillsHeight: d.fillsHeight, summarizes: d.summarizes, component: listProxy(module, d.id) } as any);
	else if (d.kind === 'panel') panels.register({ ...base, types: d.types ?? [], component: { render: () => null } } as any); // held; no panel surface yet
	else if (d.kind === 'app') {
		const component = appProxy(module, d.id);
		apps.register({ id: d.id, icon: d.icon ?? 'extension', label: d.label ?? d.id, routes: [{ path: '', component }, { path: ':rest(.*)*', component }], __module: module } as any);
		router.addRoute({ path: `/a/${d.id}`, children: [{ path: '', component }, { path: ':rest(.*)*', component }] });
	}
}

const kindDefaults: Array<{ module: string; kind: 'edit' | 'view'; type: string; id: string }> = [];
moduleKindDefault.find = (kind, field) => kindDefaults.find((k) => k.kind === kind && k.type === field.type && scopes.get(k.module)?.own.has(String((field as any).collection ?? '')))?.id;

async function openRegistry(module: string, router: Router): Promise<void> {
	const f = await makeFrame(module, 'registry', true);
	await new Promise<void>((resolve) => {
		const done = setTimeout(() => { warn(`module app ${module} did not register within 10 s — skipped`); resolve(); }, 10_000);
		const handle = (msg: any) => {
			if (msg.op === 'registered') {
				clearTimeout(done);
				for (const d of msg.definitions ?? []) register(module, d, router);
				for (const k of msg.kindDefaults ?? []) if (k.kind === 'edit' || k.kind === 'view') kindDefaults.push({ module, ...k });
				resolve();
			} else if (msg.op === 'cells') { cellReplies.get(msg.replyTo)?.(msg.cells ?? []); cellReplies.delete(msg.replyTo); }
			else if (msg.op === 'request') { /* the registry frame reads too: same gate */ void answer(scopes.get(module)!, createBounds(), msg).then((r) => bridge.reply(f.contentWindow!, msg.id, r)); }
			else if (msg.op === 'error') { warn(`module app ${module}: ${msg.message}`); }
		};
		let loads = 0;
		f.addEventListener('load', () => {
			const w = f.contentWindow; if (!w) return;
			if (++loads === 1) { bridge.add(w, { handle }); registries.set(module, w); bridge.loaded(w); bridge.post(w, { op: 'init', surface: 'registry', theme: themeNow() }); }
			else { bridge.loaded(w); registries.delete(module); }
		});
		document.body.appendChild(f);
	});
}

/** Boot: build each module's scope, open its registry frame, register its proxies. Never rejects. */
export async function loadModules(router: Router): Promise<void> {
	routerRef = router;
	try {
		const info: any = await loadServerInfo();
		const names: string[] = info.ui ?? [];
		if (!names.length) return;
		const [schema, rows, sources] = await Promise.all([
			hostRequest('GET', '/schema') as Promise<any[]>,
			hostRequest('GET', '/collections/collections/records?limit=2000') as Promise<{ records: any[] }>,
			hostRequest('GET', '/sources').catch(() => ({})) as Promise<any>,
		]);
		descriptors = schema;
		const views = ((await hostRequest('GET', '/collections/ui-views/records?limit=2000').catch(() => ({ records: [] }))) as any).records ?? [];
		const grants = window.__DT_MODULE_GRANTS__ ?? {};
		for (const name of names) {
			const home = (sources.layers ?? []).find((l: any) => l.name === name || (l.modules ?? []).includes?.(name))?.name ?? sources.workspace?.name ?? sources.workspace ?? '.';
			const scope = buildModuleScope({ module: name, home, collectionsRows: (rows.records ?? []).map((r: any) => ({ id: r.id, $module: r.$module })), descriptors: schema, grant: grants }) as AnyScope;
			scope.ownViews = views.filter((v: any) => v.$module === name && v.route).map((v: any) => v.route);
			scopes.set(name, scope);
			await openRegistry(name, router);
		}
	} catch (err) {
		warn(`could not load module apps — continuing without them: ${String(err)}`);
	}
}
