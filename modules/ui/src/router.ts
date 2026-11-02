/**
 * Studio router (spec §2 item 4 + §8 apps). History base `/admin/` — the dreamteamer server mounts
 * the built studio there, so this must agree with `vite.config.ts`'s `base: '/admin/'`.
 *
 * Route trees are no longer hardcoded here: the Content and Settings **apps** contribute them via
 * the apps registry (registry/register-defaults.ts, imported for its side effect before this module
 * evaluates), and this file flattens `apps.all()` into the initial route table. Module apps mount
 * later, under `/a/<id>`, via `router.addRoute` after their `app.js` loads (modules.ts).
 *
 * Route contracts (unchanged, now owned by the Content/Settings app definitions):
 *   '/'                              → redirect to '/content/' (ContentBrowse resolves the first
 *                                       collection once the async tree loads; see its header).
 *   '/content/:path(.*)'            → ONE greedy catch-all, resolved by ContentBrowse via
 *                                       `resolveContentPath` — collection ids can contain '/'
 *                                       (nested namespaces), so the split can't be a static route.
 *   '/settings/data-model[/:path]'  → data-model designer list + detail, greedy for the same reason.
 */
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router';
import './registry/register-defaults';
import { apps } from './registry/index';

const routes: RouteRecordRaw[] = [{ path: '/', redirect: '/content/' }, ...apps.all().flatMap((app) => app.routes)];

// MEMORY history (decision 48): the document is a `vscode-webview://` resource loaded off disk —
// there is no server to SPA-fallback deep links and no address bar to show a URL. Routes are
// driven programmatically: the extension posts `dt:navigate` when a tree node is clicked, and the
// app posts its current route back so a reloaded window restores where the operator was.
export const router = createRouter({
	history: createMemoryHistory(),
	routes,
});
