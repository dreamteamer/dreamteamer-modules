import '@vscode/codicons/dist/codicon.css';
import { createApp } from 'vue';
import App from './App.vue';
import './registry/register-defaults';
import { loadModules } from './modules';
import { loadUiViews } from './ui-views';
import { router } from './router';
import './styles/tokens.css';
import './styles/base.css';
import './styles/vscode.css';
import { hostNotify, installApiFetchShim } from './api/transport';

// No Inter webfont: this runs inside VS Code and wears the editor's own font family
// (styles/vscode.css maps --dt-font onto --vscode-font-family). No host-theme listener either —
// the `--vscode-*` variables are directly in scope now that the app IS the webview document
// rather than a cross-origin iframe (decision 48, "drop the web server").

// Module bundles are pre-built against the HTTP contract — teach fetch to answer /api from the
// host before any of them is imported (see installApiFetchShim).
installApiFetchShim();

// Load module `app` entries (spec §8) BEFORE mounting so the apps/lists registries are fully
// populated by the time the browse/record pages first render, THEN register ui-view routes
// (their `page` targets resolve against the apps registry). Neither loader ever rejects — a
// failed boot read or a broken module/view is caught inside and the app boots anyway.
void loadModules(router)
	.then(() => loadUiViews(router))
	.finally(() => {
		createApp(App).use(router).mount('#app');
		// memory history has no URL to read: the host holds the operator's route until we say go
		hostNotify('dt:mounted');
	});
