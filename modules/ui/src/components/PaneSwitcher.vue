<script setup lang="ts">
/**
 * THE WORKSPACE SWITCHER (cr-modules-017 §7; the 2026-11-14 16:30 revision moved it from the pane bar into the nav's
 * toolbar). On a pane host the toolbar's name is this button; its menu lists the workspaces `dt web open` registered
 * on this machine, and a pick asks this server to hand the whole pane — nav and page — to that workspace's server
 * (`POST /_dt/handoff`), then goes to the URL it answers. Its last entry, Settings, opens the workspace settings (the
 * name's click off a pane host). The menu hangs from the toolbar's left; a refusal (the list, a handoff) shows inside
 * it. Keyboard: lib/menu-keys.ts. One nav menu at a time: lib/open-menu.ts.
 */
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { hostInfo } from '../lib/host-boot';
import { paneFetch, paneMenu } from '../lib/pane-api';
import { menuUnder, rectOf, viewportWidth } from '../lib/menu-place';
import { menuKeys } from '../lib/menu-keys';

interface WorkspaceRow { id: string; name: string; running: boolean; current: boolean }

/** The nav's workspace label — drawn only when the host names no workspace. The host's name wins: it is the name the
 *  switcher's own list (and `dt web list`) shows for this workspace, which a folder-named nav label need not be. */
const props = defineProps<{ label?: string }>();

/** The workspace settings — the toolbar name's click off a pane host. */
const SETTINGS = '/settings/schema/activity';
const MENU_WIDTH = 220;
const router = useRouter();
const name = computed(() => hostInfo.value?.workspace?.name || props.label || '');
const open = computed(() => paneMenu.value === 'switch');
const at = ref({ x: 0, y: 0 });
/** A document to hang the menu in (the render test tier has none, and draws it in place). */
const hasBody = typeof document !== 'undefined' && !!(document as { body?: unknown }).body;
const workspaces = ref<WorkspaceRow[]>([]);
const error = ref<string | null>(null);
/** The list always holds the current workspace once `dt web open` registered it: the line says there is nothing else. */
const others = computed(() => workspaces.value.some((w) => !w.current));
const busy = ref(false);

const button = shallowRef<{ focus?: () => void } | null>(null);
const menuEl = shallowRef<{ focus?: () => void } | null>(null);
const itemEls = shallowRef<Array<{ focus?: () => void } | null>>([]);
const settingsEl = shallowRef<{ focus?: () => void } | null>(null);
const keys = menuKeys({ items: () => [...itemEls.value, settingsEl.value], menu: () => menuEl.value, button: () => button.value, close: () => { paneMenu.value = null; } });

async function toggle(e: MouseEvent): Promise<void> {
	if (open.value) { paneMenu.value = null; return; }
	at.value = menuUnder(rectOf(e?.currentTarget), 'start', MENU_WIDTH, viewportWidth());
	paneMenu.value = 'switch';
	error.value = null;
	try {
		const rows = await paneFetch('GET', '/_dt/workspaces');
		workspaces.value = Array.isArray(rows) ? rows : [];
	} catch (err) {
		error.value = (err as Error).message;
	}
	if (open.value) keys.opened();
}

async function pick(w: WorkspaceRow): Promise<void> {
	if (w.current || busy.value) { paneMenu.value = null; return; }
	busy.value = true;
	error.value = null;
	try {
		const answer = await paneFetch('POST', '/_dt/handoff', { id: w.id });
		paneMenu.value = null;
		if (typeof answer?.url === 'string') window.location.href = answer.url;
	} catch (err) {
		error.value = (err as Error).message;
	} finally {
		busy.value = false;
	}
}

function settings(): void {
	paneMenu.value = null;
	void router.push(SETTINGS);
}

// a click anywhere else closes the menu (the button and the menu stop their own clicks)
const away = () => { if (open.value) paneMenu.value = null; };
watch(open, (on) => {
	if (on) window.addEventListener('click', away);
	else window.removeEventListener('click', away);
});
onUnmounted(() => window.removeEventListener('click', away));
</script>

<template>
	<button
		ref="button"
		type="button"
		class="dt-pane-switch"
		:title="`${name} — switch workspace`"
		aria-haspopup="menu"
		:aria-expanded="open ? 'true' : 'false'"
		@click.stop="toggle"
	><span class="dt-pane-switch__name">{{ name }}</span><span class="codicon codicon-chevron-down dt-pane-switch__chevron" aria-hidden="true"></span></button>
	<!-- in the body, so no ancestor of the nav (its toolbar, its overflow) can clip or cover it; in place where there is no body -->
	<Teleport to="body" :disabled="!hasBody">
		<div v-if="open" ref="menuEl" class="dt-pane-menu dt-pane-switch__menu" role="menu" tabindex="-1" :style="{ left: `${at.x}px`, top: `${at.y}px` }" @click.stop @keydown="keys.keydown" @focusin="keys.focusin">
			<p v-if="error" class="dt-pane-menu__error" role="alert">{{ error }}</p>
			<button
				v-for="w in workspaces"
				:key="w.id"
				ref="itemEls"
				type="button"
				role="menuitemradio"
				class="dt-pane-switch__item"
				:data-id="w.id"
				:aria-checked="w.current ? 'true' : 'false'"
				@click.stop="pick(w)"
			>{{ w.name }} <span v-if="!w.current && !w.running" class="dt-pane-menu__muted">starts when opened</span></button>
			<p v-if="!others && !error" class="dt-pane-menu__hint">No other workspace was opened on this machine</p>
			<button ref="settingsEl" type="button" role="menuitem" class="dt-pane-switch__settings" @click.stop="settings">Settings</button>
		</div>
	</Teleport>
</template>

<style scoped>
/* the name, as a button: it ellipsises in a narrow nav but never below the chevron and a usable hit target */
.dt-pane-switch { display: inline-flex; align-items: center; gap: 2px; flex: 0 1 auto; min-width: 36px; max-width: 100%; height: 24px; padding: 0 4px; border: 0; border-radius: var(--dt-radius); background: transparent; color: var(--dt-fg); font: inherit; font-weight: 600; cursor: default; }
.dt-pane-switch:hover, .dt-pane-switch[aria-expanded='true'] { background: var(--dt-bg-hover); }
.dt-pane-switch__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-pane-switch__chevron { flex: none; font-size: 12px; color: var(--dt-fg-subtle); }
</style>

<style>
/* The toolbar's name slot holds the switcher: it keeps the switcher's minimum, so in a narrow nav the toolbar's
   buttons wrap to a second line rather than squeezing the switcher to nothing (NavSidebar lets a plain name give way). */
.dt-nav-toolbar__name:has(> .dt-pane-switch) { flex: 1 0 36px; min-width: 36px; }
/* The pane's two toolbar menus (this one and PaneLevel's): fixed, placed under their button inside the window. */
.dt-pane-menu { position: fixed; z-index: 60; box-sizing: border-box; width: 220px; max-width: calc(100vw - 8px); display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--dt-border-strong, var(--dt-border)); border-radius: var(--dt-radius); background: var(--dt-bg); box-shadow: var(--dt-shadow-lg, var(--dt-shadow)); font-size: var(--dt-text, 13px); font-weight: normal; outline: none; }
.dt-pane-menu > button { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; border: 0; background: none; color: var(--dt-fg); padding: 4px 8px; border-radius: var(--dt-radius); cursor: default; font: inherit; }
.dt-pane-menu > button:hover, .dt-pane-menu > button:focus-visible { background: var(--dt-bg-hover); outline: none; }
.dt-pane-menu > button[aria-checked='true'] { font-weight: 600; }
.dt-pane-menu > .dt-pane-switch__settings { border-top: 1px solid var(--dt-border); border-radius: 0; margin-top: 2px; padding-top: 6px; }
.dt-pane-menu__hint, .dt-pane-menu__muted, .dt-pane-menu__notice { color: var(--dt-fg-muted); margin: 0; }
.dt-pane-menu__hint { padding: 4px 8px; border-top: 1px solid var(--dt-border); }
.dt-pane-menu__notice { padding: 4px 8px 6px; border-bottom: 1px solid var(--dt-border); }
.dt-pane-menu__error { margin: 0; padding: 4px 8px; color: var(--dt-danger); }
</style>
