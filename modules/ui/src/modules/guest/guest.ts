/**
 * THE GUEST (cr-modules-008 §2, D6) — runs inside a module frame, after the Vue runtime in the same inline
 * script. It recreates the module-app contract a bundle was built against (window.Vue, the register API, a
 * router, fetch('/api/…')) and talks only to window.parent: every /api call, intent and navigation is a message
 * the host checks. It imports the bundle from the document's JSON data block as a blob: module.
 */
declare const Vue: any;
type Msg = { dt: 1; id: number; op?: string; reply?: any; [k: string]: any };

(function guest() {
	// the round-4 remedy: after this script, no inline handler or inline script runs (dt web); blob: stays for the bundle
	const lock = document.createElement('meta');
	lock.httpEquiv = 'Content-Security-Policy';
	lock.content = 'script-src blob:';
	document.head.appendChild(lock);

	let seq = 0;
	const pending = new Map<number, (r: any) => void>();
	const post = (op: string, payload: Record<string, unknown> = {}) => parent.postMessage({ dt: 1, id: ++seq, op, ...payload }, '*');
	const ask = (op: string, payload: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
		const id = ++seq; pending.set(id, resolve); parent.postMessage({ dt: 1, id, op, ...payload }, '*');
	});

	// ---- fetch('/api/…') over the bridge; anything else is the browser's, which the frame policy refuses
	const realFetch = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		if (url === '/api' || url.startsWith('/api/')) {
			let body: unknown;
			if (typeof init.body === 'string' && init.body.length) { try { body = JSON.parse(init.body); } catch { body = init.body; } }
			const r = await ask('request', { method: String(init.method ?? 'GET').toUpperCase(), path: url.slice(4) || '/', body });
			return new Response(JSON.stringify(r?.body ?? null), { status: r?.status ?? 500, headers: { 'Content-Type': 'application/json' } });
		}
		return realFetch(input, init);
	};

	// ---- the register API and the router proxy
	const defs: Record<string, Map<string, any>> = { edit: new Map(), view: new Map(), list: new Map(), app: new Map(), panel: new Map() };
	const kindDefaults: Array<{ kind: string; type: string; id: string }> = [];
	const route = Vue.shallowRef({ path: '/', fullPath: '/', params: {}, query: {} });
	let routes: Array<{ path: string; name?: string }> = [];
	const guards: Array<(to: any, from: any) => unknown> = [];
	const toPath = (to: any): string => {
		if (typeof to === 'string') return to;
		const q = to?.query ? new URLSearchParams(Object.entries(to.query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString() : '';
		return `${to?.path ?? route.value.path}${q ? `?${q}` : ''}`;
	};
	const go = (to: any, replace: boolean) => ask('navigate', { to: toPath(to), replace }).then((r) => { if (!r?.ok) throw new Error(r?.error ?? 'navigation refused'); });
	const router = {
		currentRoute: route,
		push: (to: any) => go(to, false),
		replace: (to: any) => go(to, true),
		resolve: (to: any) => { const p = toPath(to); return { href: `#${p}`, fullPath: p, path: p.split('?')[0] }; },
		getRoutes: () => routes,
		beforeEach: (g: any) => { guards.push(g); return () => guards.splice(guards.indexOf(g), 1); },
		afterEach: () => () => undefined,
		isReady: () => Promise.resolve(),
	};
	const api = {
		registerEdit: (d: any) => defs.edit.set(d.id, d),
		registerView: (d: any) => defs.view.set(d.id, d),
		registerList: (d: any) => defs.list.set(d.id, d),
		registerApp: (d: any) => defs.app.set(d.id, d),
		registerPanel: (d: any) => defs.panel.set(d.id, d),
		registerKindDefault: (kind: string, type: string, id: string) => kindDefaults.push({ kind, type, id }),
		router,
	};

	const text = JSON.parse(document.getElementById('dt-bundle')?.textContent ?? '""');
	const ready: Promise<unknown> = import(/* @vite-ignore */ URL.createObjectURL(new Blob([text], { type: 'text/javascript' })))
		.then((m: any) => (typeof m.default === 'function' ? m.default(api) : Promise.reject(new Error('the module app has no default export'))))
		.catch((e: unknown) => { post('error', { message: String(e) }); });

	// ---- keys, links, size
	document.addEventListener('keydown', (e) => {
		const chrome = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && !e.altKey && ['p', 'b', 'j'].includes(e.key.toLowerCase()));
		if (chrome) post('key', { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
	}, true);
	document.addEventListener('click', (e) => {
		const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
		if (!a) return;
		const href = a.getAttribute('href') ?? '';
		if (href.startsWith('#/') || (href.startsWith('/') && !href.startsWith('//'))) { e.preventDefault(); void go(href.replace(/^#/, ''), false).catch(() => undefined); }
	}, true);
	if (typeof ResizeObserver === 'function') new ResizeObserver(() => post('resize', { height: document.documentElement.scrollHeight })).observe(document.documentElement);

	// ---- the list state the host's browse-state offers, rebuilt from snapshots; methods are intents
	const intent = (name: string, ...args: unknown[]) => ask('intent', { name, args }).then((r) => { if (!r?.ok) throw new Error(r?.error ?? `${name} refused`); return r.value; });
	function makeListState() {
		const r = Vue.ref;
		const snap: any = Vue.shallowRef({ items: [], ids: [], selected: [], titles: {}, tints: {}, sort: { field: null, desc: false }, columns: [], pk: 'id' });
		const pkOf = (row: any) => String(row?.[snap.value.pk] ?? row?.id ?? '');
		const state: any = {
			collection: r(''), columns: r([]), selectedIds: r(new Set<string>()), sortField: r(null), sortDesc: r(false),
			hasPrev: r(false), hasNext: r(false), from: r(0), to: r(0), titleField: r(null), colorBy: r(null), imageField: r(null), subtitleFields: r([]),
			items: { items: r([]), loading: r(false), error: r(null), total: r(0), reload: () => intent('reload'), setSort: (f: string) => intent('setSort', f) },
			pkOf,
			isSelected: (x: any) => state.selectedIds.value.has(typeof x === 'string' ? x : pkOf(x)),
			sortIndicator: (f: string) => (state.sortField.value === f ? (state.sortDesc.value ? 'desc' : 'asc') : null),
			recordTitleOf: (row: any) => snap.value.titles[pkOf(row)] ?? pkOf(row),
			tintOf: (row: any) => snap.value.tints[pkOf(row)],
			openRecord: (row: any) => intent('openRecord', typeof row === 'string' ? row : pkOf(row)),
			toggleSelect: (x: any) => intent('toggleSelect', typeof x === 'string' ? x : pkOf(x)),
			toggleSelectAllVisible: () => intent('toggleSelectAllVisible'),
			clearSelection: () => intent('clearSelection'),
			setSortValue: (v: unknown) => intent('setSortValue', v),
			prevPage: () => intent('prevPage'),
			nextPage: () => intent('nextPage'),
		};
		state.allVisibleSelected = Vue.computed(() => state.items.items.value.length > 0 && state.items.items.value.every((row: any) => state.selectedIds.value.has(pkOf(row))));
		state.apply = (s: any) => {
			snap.value = s;
			state.collection.value = s.collection; state.columns.value = s.columns; state.items.items.value = s.items;
			state.items.loading.value = s.loading; state.items.error.value = s.error; state.items.total.value = s.total;
			state.selectedIds.value = new Set(s.selected); state.sortField.value = s.sort?.field ?? null; state.sortDesc.value = !!s.sort?.desc;
			for (const k of ['hasPrev', 'hasNext', 'from', 'to', 'titleField', 'colorBy', 'imageField', 'subtitleFields']) if (k in s) state[k].value = s[k];
		};
		return state;
	}

	// ---- surfaces
	const props = Vue.reactive({} as Record<string, unknown>);
	let listState: any = null;
	function appComponent(def: any) {
		return Vue.defineComponent({
			setup() {
				return () => {
					const below = route.value.path.replace(new RegExp(`^/a/${def.id}/?`), '');
					const hit = (def.routes ?? []).find((x: any) => (x.path ?? '').replace(/^\//, '') === below) ?? (def.routes ?? []).find((x: any) => !x.path);
					return hit?.component ? Vue.h(hit.component) : Vue.h('p', `no route ${below}`);
				};
			},
		});
	}
	function mount(d: Msg) {
		const def = defs[d.kind]?.get(d.defId);
		if (!def) { post('error', { message: `the module registered no ${d.kind} '${d.defId}'` }); return; }
		routes = d.routes ?? []; route.value = d.route ?? route.value; Object.assign(props, d.props ?? {});
		const component = d.kind === 'app' ? appComponent(def) : def.component;
		if (d.kind === 'list') { listState = makeListState(); if (d.state) listState.apply(d.state); }
		const root = document.createElement('div'); document.body.appendChild(root);
		Vue.createApp({
			render: () => Vue.h(component, d.kind === 'list'
				? { ...props, state: listState }
				: { ...props, 'onUpdate:value': (v: unknown) => post('emit', { event: 'update:value', args: [v] }) }),
		}).mount(root);
	}
	async function renderCells(d: Msg) {
		const def = defs.view.get(d.viewId);
		const cells: Array<{ key: string; html: string }> = [];
		for (const c of d.cells ?? []) {
			const el = document.createElement('div');
			try {
				const a = Vue.createApp({ render: () => Vue.h(def.component, c.props) }); a.mount(el); await Vue.nextTick();
				cells.push({ key: c.key, html: el.innerHTML }); a.unmount();
			} catch { cells.push({ key: c.key, html: '' }); }
		}
		parent.postMessage({ dt: 1, id: ++seq, op: 'cells', replyTo: d.id, cells }, '*');
	}
	function paste(textIn: string) {
		const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
		if (!el) return;
		const data = new DataTransfer(); data.setData('text/plain', textIn);
		const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		if (el.dispatchEvent(ev) && 'setRangeText' in el) {
			el.setRangeText(textIn, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}
	function theme(t: any) {
		if (!t) return;
		for (const [k, v] of Object.entries(t.vars ?? {})) document.documentElement.style.setProperty(k, String(v));
		if (t.scheme) document.body.className = t.scheme;
	}

	addEventListener('message', async (ev) => {
		if (ev.source !== parent) return;
		const d = ev.data as Msg;
		if (!d || d.dt !== 1) return;
		if (d.reply !== undefined && pending.has(d.id)) { pending.get(d.id)!(d.reply); pending.delete(d.id); return; }
		switch (d.op) {
			case 'init':
				await ready; theme(d.theme);
				if (d.surface === 'registry') {
					const definitions = Object.entries(defs).flatMap(([kind, m]) => [...m.values()].map((x: any) => ({ kind, id: x.id, name: x.name, types: x.types ?? [], scope: x.scope, fillsHeight: x.fillsHeight, summarizes: x.summarizes, icon: x.icon, label: x.label, routes: (x.routes ?? []).map((r: any) => ({ path: r.path ?? '' })) })));
					post('registered', { definitions, kindDefaults });
				} else mount(d);
				break;
			case 'props': Object.assign(props, d.props ?? {}); break;
			case 'state': listState?.apply(d.state); break;
			case 'route': {
				const from = route.value;
				for (const g of guards) { try { if ((await g(d.route, from)) === false) return; } catch { /* a guard's error is the module's */ } }
				route.value = d.route; break;
			}
			case 'theme': theme(d.theme); break;
			case 'invalidate': dispatchEvent(new CustomEvent('dt:invalidate', { detail: d.detail })); break;
			case 'render-cells': await ready; await renderCells(d); break;
			case 'paste': paste(String(d.text ?? '')); break;
		}
	});
})();
