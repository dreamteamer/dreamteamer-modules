/**
 * MOUNT — the one call a host makes. It wires the transport, teaches `fetch('/api/…')` to go through it
 * (module bundles are pre-built against the HTTP contract), loads the workspace's module `app` entries and
 * ui-views BEFORE the first render so the registries are full, mounts the app, then says `dt:mounted` —
 * the host answers with the route to show.
 */
import { createApp } from 'vue';
import App from './App.vue';
import './registry/register-defaults';
import { loadModules } from './modules';
import { loadUiViews } from './ui-views';
import { router } from './router';
import { hostNotify, installApiFetchShim, setTransport } from './api/transport';
import type { Transport } from './transport/types';

export interface MountOptions {
	transport: Transport;
}

export function mount(el: string | Element, { transport }: MountOptions): Promise<void> {
	setTransport(transport);
	installApiFetchShim();
	// neither loader ever rejects — a failed boot read or a broken module is caught inside and the app boots anyway
	return loadModules(router)
		.then(() => loadUiViews(router))
		.finally(() => {
			createApp(App).use(router).mount(el);
			hostNotify('dt:mounted');
		});
}
