// The shell: a hash router over the registry, the app object the harness drives, and the two init calls.
import { store, session } from './state.js';
import { screens, byKey } from './screens/index.js';
import * as data from './data/journeys.js';
import * as player from '../harness/player.js';
import * as meta from '../harness/meta.js';
import { stubScreen } from '../harness/catalog.js';

const main = document.getElementById('main');
const listeners = new Set();
let current = null;
const initialHash = location.hash;
const route = () => { const p = location.hash.slice(1).split('?')[0] || '/'; return screens.find((s) => s.route === p) || byKey.home; };
function renderAll() {
	const s = route();
	current = { screen: s, params: {}, query: Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')) };
	meta.syncPortal(s.portal);
	main.replaceChildren(s.stub ? stubScreen(s, null, { stories: app.demo?.stepsFor(s.key) ?? [] }) : s.render({ store, session, meta, screen: s, query: current.query }));
	for (const f of listeners) f();
}
const app = { store, session, screens, byKey, current: () => current, onRender: (f) => listeners.add(f), renderAll, initialHash, mount: document.getElementById('demo-root') };
window.__northwind = app;
meta.init({ storageKey: 'northwind', metaDefault: (p) => (p === 'gp' ? 'off' : 'on'), dictionary: () => import('./data/meta.js'), context: () => ({ key: current?.screen.key, route: current?.screen.route, title: current?.screen.title }) });
store.onChange(() => { if (!app.quiet) renderAll(); });
window.addEventListener('hashchange', renderAll);
renderAll();
player.init(app, { data, storageKey: 'northwind', defaultUser: { gp: 'U-applicant', bo: 'U-officer' }, users: { applicant: 'U-applicant', 'grant-officer': 'U-officer' } });
document.getElementById('tools').append(meta.toggleButton(renderAll));
renderAll();
