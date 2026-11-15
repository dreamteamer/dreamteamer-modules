<!--
	App shell, VS Code edition. The ModuleBar and NavSidebar are GONE — VS Code's activity bar and
	the extension's native Collections tree are the nav (decision 48; operator: "one experience in
	vscode", "double nav"). What remains is the page area plus the RightSidebar, which is page
	TOOLING (layout options, revisions, info), not app chrome — hiding it once removed layout
	switching, so it stays.
-->
<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import RightSidebar from './components/RightSidebar.vue';
import AppNav from './components/AppNav.vue';
import ToastHost from './components/ToastHost.vue';
import TabStrip from './components/TabStrip.vue';
import { hostNotify, hostSetState } from './api/transport';
import { loadUiViews } from './ui-views';
import { refreshSchema } from './lib/schema-refresh';
import { liveSchemaCaches } from './composables/schema-caches';
import { invalidateStageReviews } from './lib/stage-reviews';
import { handleInvalidate } from './lib/host-invalidate';
import { refreshPages } from './composables/page-caches';
import { loadHost, paneHost, signedOut, SIGNED_OUT } from './lib/host-boot';
import { receiveSelect, startPaneReport } from './composables/pane-report';
import { useCollections } from './composables/collections';

// Host → app navigation: the extension posts `dt:navigate` when the operator clicks a collection
// or record in the native tree. App → host: every route change is reported back so the TAB can
// title itself after the app navigates on its own (a row click, a breadcrumb).
const router = useRouter();
const route = useRoute();
/** A host with no native tree (dt web) asks the app to draw the nav; VS Code never does. */
const appNav = (window as any).__DT_HOST__?.nav === 'app';
/** The browser shell draws its own pill tabs unless the host declares it draws tabs itself (VS Code: `tabs: true`). */
const appTabs = appNav && (window as any).__DT_HOST__?.tabs !== true;

// This tab's identity, mirrored into webview state on every change so a window reload restores
// each tab on its own route with its own pinning (the host is the authority; we just persist).
let pinned = false;

window.addEventListener('message', (e: MessageEvent) => {
	const m = e.data;
	if (m?.type === 'dt:navigate' && typeof m.route === 'string') void router.push(m.route);
	// The workspace changed on disk (a compile, an agent write, a git checkout). The host has posted
	// this since the tab existed and NOTHING listened, which is why a ui-view record written after
	// boot never reached the screen: the view table was read once, at boot, and a filter authored
	// afterwards simply didn't exist as far as the open tab was concerned. Re-reading it is cheap and
	// self-cancelling (`loadUiViews` returns early when the table is unchanged).
	//
	// ⚠ And for eleven months that ONE listener was the whole handler, which left the same hole one
	// layer down: the SCHEMA caches (`/presentation`, the collections overview, per-collection fields,
	// relations) were also read once at boot and never again, so a collection compiled while the tab
	// was open rendered "Unknown collection" until a window reload. `scope` comes from the host, which
	// is the only side that sees which path moved (src/changes.ts): `schema` means the compiled runtime
	// itself changed, and only then is the full refetch worth paying for. An older host sends no scope
	// at all — treat that as `schema`, because a host that cannot classify has told us nothing that
	// rules the expensive case out.
	//
	// `pages` comes only from the refresh button: after those settle, the open page re-fetches its
	// own records too (lib/host-invalidate.ts holds the order and why it is settle-not-succeed).
	if (m?.type === 'dt:invalidate') {
		// any change may be a review written or closed: the stage checks read their reviews again
		invalidateStageReviews();
		void handleInvalidate(m, {
			loadUiViews: () => loadUiViews(router),
			refreshSchema: () => refreshSchema(liveSchemaCaches),
			refreshPages,
		});
	}
	// cr-modules-017: the level, the chat flag or the files key changed on the server — ask GET /host again
	if (m?.type === 'dt:host') void loadHost();
	// cr-modules-017 §5: the chat ticked rows (`dt web select`) — tick them here, on that collection's list
	if (m?.type === 'dt:select') receiveSelect(m.refs, { router, collections: paneCollections });
	if (m?.type === 'dt:tab') {
		pinned = !!m.pinned;
		document.documentElement.dataset.dtActive = m.active ? '1' : '0';
		hostSetState({ route: typeof m.route === 'string' ? m.route : route.fullPath, pinned });
	}
});

watch(
	() => route.fullPath,
	(fullPath) => {
		hostNotify('dt:route', { route: fullPath });
		hostSetState({ route: fullPath, pinned });
		// dev-loop handle: `scripts/app.mjs` reads this to know which tab it is talking to
		document.documentElement.dataset.dtRoute = fullPath;
	},
);

// cr-modules-017 §5: on a pane host the page reports its place and ticked rows to the server the chat's hook reads.
// The host can only answer once GET /host did (main-browser reads it before mount), so a page that is not a pane
// host never starts the reporter.
const { tree: collectionTree } = useCollections();
const paneCollections = () => collectionTree.value.map((row) => row.collection);
let stopReport: (() => void) | null = null;
watch(
	() => paneHost(),
	(on) => {
		if (on && !stopReport) stopReport = startPaneReport({ route, collections: paneCollections });
		else if (!on && stopReport) { stopReport(); stopReport = null; }
	},
	{ immediate: true },
);

onMounted(() => hostNotify('dt:ready'));
</script>

<template>
	<div class="dt-shell" :class="{ 'dt-shell--app': appNav }">
		<!-- the nav, and on a pane host its switcher and level in the nav's toolbar (no bar above the page) -->
		<AppNav v-if="appNav" />
		<main class="dt-page-area" :class="{ 'dt-page-area--tabs': appTabs }">
			<template v-if="appTabs">
				<TabStrip />
				<!-- the page scrolls under the strip, which stays put -->
				<div class="dt-page-scroll"><router-view /></div>
			</template>
			<router-view v-else />
		</main>
		<RightSidebar />
		<!-- the browser host's shell reports writes as toasts (cr-modules-022); the editor has its own notifications -->
		<ToastHost v-if="appNav" />
		<!-- cr-modules-017: a 401 from any request means the session is gone; the chat is where a person gets back in -->
		<div v-if="signedOut" class="dt-signed-out" role="alert">
			<p>{{ SIGNED_OUT }}</p>
		</div>
	</div>
</template>

<style scoped>
.dt-shell {
	display: flex;
	height: 100vh;
	overflow: hidden;
}

.dt-page-area {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	background: var(--dt-bg);
	overflow-y: auto;
}

/* The browser host's shell (cr-modules-022): the nav sits on the warm canvas and the page is a sheet laid on it —
   a rounded top-left corner, a hairline ring and a soft shadow instead of a border line between the two. Only under a
   host that draws the app's own nav (dt web); inside VS Code the page area is the whole webview, as before. The 8px
   above both keeps the nav's toolbar and the page's first header row one band, and lets the corner read. */
.dt-shell--app {
	padding-top: var(--dt-space-2);
	background: var(--dt-canvas);
}

.dt-shell--app .dt-page-area {
	position: relative;
	background: var(--dt-surface);
	border-top-left-radius: var(--dt-radius-sheet);
	box-shadow: var(--dt-shadow-sheet);
}

.dt-page-area--tabs {
	overflow: hidden;
}

.dt-page-scroll {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
}

.dt-signed-out {
	position: fixed;
	inset: 0;
	z-index: 1000;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 32px;
	background: var(--dt-bg);
	color: var(--dt-fg);
	text-align: center;
}

.dt-shell-error {
	color: var(--dt-danger);
	padding: 32px;
}
</style>
