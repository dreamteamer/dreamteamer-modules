<script setup lang="ts">
/**
 * THE WORKSPACE SWITCHER (cr-modules-017 §7; the 2026-11-14 16:30 revision moved it from the pane bar into the nav's
 * toolbar). On a pane host the toolbar's name is this button; its menu lists the workspaces `dt web open` registered
 * on this machine, and a pick asks this server to hand the whole pane — nav and page — to that workspace's server
 * (`POST /_dt/handoff`), then goes to the URL it answers. Its last entry, Settings, opens the workspace settings (the
 * name's click off a pane host). The menu hangs from the toolbar's left; a refusal (the list, a handoff) shows inside
 * it. Keyboard: lib/menu-keys.ts, through DtMenu (the one menu). One nav menu at a time: lib/open-menu.ts.
 */
import { computed, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { hostInfo } from '../lib/host-boot';
import { paneFetch, paneMenu } from '../lib/pane-api';
import { menuUnder, rectOf, viewportWidth } from '../lib/menu-place';
import DtMenu from './DtMenu.vue';

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
const workspaces = ref<WorkspaceRow[]>([]);
const error = ref<string | null>(null);
/** The list always holds the current workspace once `dt web open` registered it: the line says there is nothing else. */
const others = computed(() => workspaces.value.some((w) => !w.current));
const busy = ref(false);
/** The list has not answered yet: the menu says Loading…, never "no other workspace". */
const loading = ref(false);

const button = shallowRef<{ focus?: () => void } | null>(null);
const menu = shallowRef<{ focusFirst?: () => void } | null>(null);
const close = () => { paneMenu.value = null; };

async function toggle(e: MouseEvent): Promise<void> {
	if (open.value) { paneMenu.value = null; return; }
	at.value = menuUnder(rectOf(e?.currentTarget), 'start', MENU_WIDTH, viewportWidth());
	paneMenu.value = 'switch';
	error.value = null;
	workspaces.value = [];
	loading.value = true;
	try {
		const rows = await paneFetch('GET', '/_dt/workspaces');
		workspaces.value = Array.isArray(rows) ? rows : [];
	} catch (err) {
		error.value = (err as Error).message;
	} finally {
		loading.value = false;
	}
	// the items arrived after the menu opened: focus goes to the first now
	if (open.value) menu.value?.focusFirst?.();
}

async function pick(w: WorkspaceRow): Promise<void> {
	if (w.current || busy.value) { close(); return; }
	busy.value = true;
	error.value = null;
	try {
		const answer = await paneFetch('POST', '/_dt/handoff', { id: w.id });
		if (typeof answer?.url === 'string') { paneMenu.value = null; window.location.href = answer.url; }
		else close();
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
	<DtMenu v-if="open" ref="menu" teleport class="dt-pane-menu dt-pane-switch__menu" label="Switch workspace" :at="at" :trigger="button" :autofocus="false" @close="close" @click.stop>
			<p v-if="error" class="dt-pane-menu__error" role="alert">{{ error }}</p>
			<button
				v-for="w in workspaces"
				:key="w.id"
				type="button"
				role="menuitemradio"
				class="dt-menu-item dt-pane-switch__item"
				:data-id="w.id"
				:aria-checked="w.current ? 'true' : 'false'"
				@click.stop="pick(w)"
			>{{ w.name }} <span v-if="!w.current && !w.running" class="dt-pane-menu__muted">starts when opened</span></button>
			<p v-if="loading" class="dt-pane-menu__hint dt-pane-switch__loading" role="status">Loading…</p>
			<p v-else-if="!others && !error" class="dt-pane-menu__hint">No other workspace was opened on this machine</p>
			<button type="button" role="menuitem" class="dt-menu-item dt-pane-switch__settings" @click.stop="settings">Settings</button>
	</DtMenu>
</template>

<style scoped>
/* the name, as a button: it ellipsises in a narrow nav but never below the chevron and a usable hit target */
.dt-pane-switch { display: inline-flex; align-items: center; gap: 2px; flex: 0 1 auto; min-width: 30px; max-width: 100%; height: 24px; padding: 0 4px; border: 0; border-radius: var(--dt-radius); background: transparent; color: var(--dt-fg); font: inherit; font-weight: 600; cursor: default; }
.dt-pane-switch:hover, .dt-pane-switch[aria-expanded='true'] { background: var(--dt-bg-hover); }
.dt-pane-switch__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-pane-switch__chevron { flex: none; font-size: var(--dt-text-sm); color: var(--dt-fg-subtle); }
</style>

<style>
/* The toolbar's name slot holds the switcher: it keeps the switcher's minimum (some of the name, the chevron, a hit
   target), so in a narrow nav the toolbar's buttons wrap rather than squeezing the switcher to nothing (NavSidebar
   lets a plain name give way). The buttons wrap ONE BY ONE as the toolbar's own items (their group is `contents`),
   so a 320 px pane keeps one 32 px line locked (name, lock, level) and two unlocked; a 6 px start inset buys the room.
   `.dt-nav` in front out-specifies NavSidebar's scoped rules. */
.dt-nav .dt-nav-toolbar:has(> .dt-nav-toolbar__name > .dt-pane-switch) { flex-wrap: wrap; justify-content: flex-end; row-gap: 2px; padding-left: 6px; }
.dt-nav .dt-nav-toolbar:has(> .dt-nav-toolbar__name > .dt-pane-switch) > .dt-nav-toolbar__buttons { display: contents; }
.dt-nav .dt-nav-toolbar__name:has(> .dt-pane-switch) { flex: 1 0 30px; min-width: 30px; }
/* The pane's two toolbar menus (this one and PaneLevel's): DtMenu draws the surface and places them under their button
   inside the window; these fix their width and keep a long workspace name to one line. */
.dt-menu.dt-pane-menu { width: 220px; min-width: 0; max-width: calc(100vw - 8px); }
.dt-pane-menu > .dt-menu-item { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
.dt-pane-menu > .dt-menu-item[aria-checked='true'] { font-weight: 600; }
.dt-pane-menu > .dt-pane-switch__settings { border-top: 1px solid var(--dt-border); border-radius: 0; margin-top: 2px; padding-top: 6px; }
.dt-pane-menu__hint, .dt-pane-menu__muted, .dt-pane-menu__notice { color: var(--dt-fg-muted); margin: 0; }
.dt-pane-menu__hint { padding: 4px 8px; border-top: 1px solid var(--dt-border); }
.dt-pane-menu__notice { padding: 4px 8px 6px; border-bottom: 1px solid var(--dt-border); }
.dt-pane-menu__error { margin: 0; padding: 4px 8px; color: var(--dt-danger); }
</style>
