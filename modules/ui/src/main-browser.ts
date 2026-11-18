// THE BROWSER PAGE: the same app for a host with no editor around it — dt web, in a browser tab or a
// desktop session's pane — over the HTTP transport. It adds browser.css (the chart and ANSI colours, light
// and dark, and the fallback for a theme colour no editor defines) and declares the host's capabilities
// when the host did not.
//
// cr-modules-017: the page's boot values (the files and frames bases, the file bases, the var roots, the module
// grants, the level and the workspace) come from GET /host behind the cookie, read BEFORE mount so the first
// render already draws images and frames. A page whose session is gone draws one sentence and does not mount.
import { httpTransport, mount } from './index';
import { setTransport } from './api/transport';
import { loadHost, signedOut, SIGNED_OUT } from './lib/host-boot';
import './styles/browser.css';

(window as any).__DT_HOST__ ??= { nav: 'app', commands: false, openFile: 'tab', tabs: false, history: 'hash' };

const transport = httpTransport();
setTransport(transport);
// not a top-level await: the page build targets browsers vite's default target names
void loadHost().then(() => {
	if (!signedOut.value) return mount('#app', { transport });
	const el = document.querySelector('#app');
	if (!el) return;
	const p = document.createElement('p');
	p.className = 'dt-signed-out';
	p.textContent = SIGNED_OUT;
	el.replaceChildren(p);
});
