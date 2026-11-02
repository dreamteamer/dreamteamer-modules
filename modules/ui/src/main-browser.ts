// THE BROWSER PAGE: the same app for a host with no editor around it — dt web, in a browser tab or a
// desktop session's pane — over the HTTP transport. It adds browser.css (the chart and ANSI colours, light
// and dark, and the fallback for a theme colour no editor defines) and declares the host's capabilities
// when the host did not.
import { httpTransport, mount } from './index';
import './styles/browser.css';

(window as any).__DT_HOST__ ??= { nav: 'app', commands: false, openFile: 'tab', tabs: false, history: 'hash' };

void mount('#app', { transport: httpTransport() });
