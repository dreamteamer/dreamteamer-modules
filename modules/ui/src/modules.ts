/**
 * Module `app` loading at boot (spec §4/§8, studio side).
 *
 * `compile` stages each module's pre-built browser entry at `.dreamteamer/ui/<shortName>/app.js`
 * and the server lists the staged short-names in `GET /api/info` as `ui: [<shortNames>]`, serving
 * the bundles at `/ui/<name>/app.js` (absolute — NOT under /admin). On boot the studio
 * dynamic-imports each entry and calls its default export against the registry API below. A
 * module contributes Edits / Views / Lists / apps / panels through that API — the same
 * registries the built-ins use (registry/register-defaults.ts).
 *
 * ── Module-app author contract ────────────────────────────────────────────────────────────────
 * A module's `app.js` is an ES module whose DEFAULT export is a register function taking ONE
 * argument, the registry API (plus `router` for programmatic navigation from module components):
 *
 *   // app.js
 *   export default ({ registerEdit, registerView, registerList, registerApp, registerPanel, router }) => {
 *     registerList({ id: 'kanban', name: 'Kanban', component: MyKanban })
 *   }
 *
 * Host-provided Vue: modules MUST NOT bundle Vue (Directus's rule — two Vue copies break
 * reactivity). The host exposes its own Vue namespace as `window.Vue` BEFORE any module entry is
 * imported; a module accesses `window.Vue` (e.g. `const { defineComponent, h } = window.Vue`) or
 * builds its components from what the registry API hands it. Vite lib-mode module builds should
 * mark `vue` external and map it to the `Vue` global. (No import-map in this pass — `window.Vue`
 * is the single documented mechanism.)
 *
 * Fault isolation: a module whose entry fails to import or throws while registering is caught,
 * warned, and skipped — a broken module never blanks the studio.
 */
import * as Vue from 'vue';
import type { Router } from 'vue-router';
import { loadServerInfo } from './api/info';
import { apps, edits, lists, panels, registerKindDefault, views, type AppDefinition, type ExtensionDefinition, type ListDefinition } from './registry/index';

/** The single argument a module's default export receives. Thin wrappers over the registries. */
export interface ModuleRegistryApi {
	registerEdit(definition: ExtensionDefinition): void;
	registerView(definition: ExtensionDefinition): void;
	registerList(definition: ListDefinition): void;
	registerApp(definition: AppDefinition): void;
	registerPanel(definition: ExtensionDefinition): void;
	/** Make an Edit/View the kind default for a wire `type` (e.g. a geo module making `map` the
	 *  default View for `geometry`) without touching core resolution — see registry/index.ts. */
	registerKindDefault(kind: 'edit' | 'view', type: string, id: string): void;
	/** The studio's vue-router instance — module components use it for programmatic navigation
	 *  (they can't `import { useRouter } from 'vue-router'`: only Vue is host-exposed). */
	router: Router;
}

type ModuleEntry = (api: ModuleRegistryApi) => void | Promise<void>;

function makeRegistryApi(router: Router): ModuleRegistryApi {
	return {
		registerEdit: (definition) => edits.register(definition),
		registerView: (definition) => views.register(definition),
		registerList: (definition) => lists.register(definition),
		registerPanel: (definition) => panels.register(definition),
		registerKindDefault: (kind, type, id) => registerKindDefault(kind, type, id),
		registerApp: (definition) => {
			apps.register(definition);
			// Module apps mount under /a/<id> — their own `routes` become children of that base,
			// so a module route `path: 'board'` resolves at `/a/<id>/board` and `path: ''` is the
			// app index. Built-in apps (content/settings) register their absolute route trees in
			// register-defaults.ts directly and never reach this path.
			router.addRoute({ path: `/a/${definition.id}`, children: definition.routes });
		},
		router,
	};
}

/**
 * Fetch `/api/info`, then dynamic-import and invoke every staged module `app` entry
 * (`/ui/<name>/app.js`). Resolves once all modules have been attempted; a failure of `/api/info`
 * itself (or an absent/empty `ui`) is treated as "no modules" — the studio boots normally either way.
 */
export async function loadModules(router: Router): Promise<void> {
	// Expose the host's Vue to module entries BEFORE importing any of them (see the contract above).
	(window as unknown as { Vue?: typeof Vue }).Vue = Vue;

	let names: string[] = [];
	try {
		names = (await loadServerInfo()).ui;
	} catch (err) {
		console.warn('[modules] could not fetch /api/info — continuing with no modules', err);
		return;
	}

	const registryApi = makeRegistryApi(router);

	// Bundles are read off disk, not served: the host stages `.dreamteamer/ui/` into the webview's
	// localResourceRoots and injects its `vscode-resource` base as `__DT_UI_BASE__` (decision 48).
	const uiBase = window.__DT_UI_BASE__ ?? '/ui';

	for (const name of names) {
		try {
			const imported = (await import(/* @vite-ignore */ `${uiBase}/${name}/app.js`)) as { default?: ModuleEntry };
			const entry = imported.default;
			if (typeof entry !== 'function') {
				console.warn(`[modules] '${name}' app entry has no default export function — skipping`);
				continue;
			}
			await entry(registryApi);
		} catch (err) {
			// A broken module never blanks the studio (spec §4 "Trust": code is gated, data is safe).
			console.warn(`[modules] '${name}' app entry failed to load — skipping`, err);
		}
	}
}
