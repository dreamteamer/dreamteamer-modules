<script setup lang="ts">
/**
 * THE PANE'S LEVEL (cr-modules-017 §4; the 2026-11-14 16:30 revision made the pane bar's chip an icon at the nav
 * toolbar's right end): `eye` Read, `edit` Edit, `shield` Admin (in the warning colour), the tooltip naming the level
 * and, while a raise holds, since when. Its menu LOWERS the level (`POST /_dt/level`) and never raises it — the last
 * line sends a person to the chat, where `dt web open --edit|--admin` is. A raise in force is said at the menu's top;
 * a refused lower shows inside the menu. Keyboard: lib/menu-keys.ts, through DtMenu (the one menu). One nav menu at a time: lib/open-menu.ts.
 */
import { computed, ref, shallowRef } from 'vue';
import DtIcon from './DtIcon.vue';
import { hostInfo, loadHost } from '../lib/host-boot';
import { levelWord, lowerChoices, raiseNotice, type PaneLevel } from '../lib/pane-level';
import { paneFetch, paneMenu } from '../lib/pane-api';
import { menuUnder, rectOf, viewportWidth } from '../lib/menu-place';
import DtMenu from './DtMenu.vue';

const MENU_WIDTH = 220;
const ICONS: Record<PaneLevel, string> = { read: 'eye', edit: 'edit', admin: 'shield' };

const level = computed<PaneLevel>(() => (hostInfo.value?.level as PaneLevel | undefined) ?? 'read');
const notice = computed(() => (hostInfo.value ? raiseNotice({ level: level.value, raisedAt: hostInfo.value.raisedAt }) : null));
const lowers = computed(() => lowerChoices(level.value));
const title = computed(() => `Level: ${levelWord(level.value)}${notice.value ? ` — ${notice.value}` : ''}`);
const open = computed(() => paneMenu.value === 'level');
const at = ref({ x: 0, y: 0 });
const error = ref<string | null>(null);

const button = shallowRef<{ focus?: () => void } | null>(null);
const close = () => { paneMenu.value = null; };

function toggle(e: MouseEvent): void {
	if (open.value) { paneMenu.value = null; return; }
	at.value = menuUnder(rectOf(e?.currentTarget), 'end', MENU_WIDTH, viewportWidth());
	error.value = null;
	paneMenu.value = 'level';
}

async function lower(to: PaneLevel): Promise<void> {
	error.value = null;
	try {
		await paneFetch('POST', '/_dt/level', { level: to });
		close();
		await loadHost();
	} catch (err) {
		error.value = (err as Error).message;
	}
}
</script>

<template>
	<button
		ref="button"
		type="button"
		class="dt-nav-tool dt-pane-level"
		:data-level="level"
		:title="title"
		:aria-label="`Level: ${levelWord(level)}`"
		aria-haspopup="menu"
		:aria-expanded="open ? 'true' : 'false'"
		@click.stop="toggle"
	><DtIcon :name="ICONS[level]" /></button>
	<!-- in the body, so no ancestor of the nav (its toolbar, its overflow) can clip or cover it; in place where there is no body -->
	<DtMenu v-if="open" teleport class="dt-pane-menu dt-pane-level__menu" label="Level" :at="at" :trigger="button" @close="close" @click.stop>
			<p v-if="notice" class="dt-pane-menu__notice">{{ notice }}</p>
			<p v-if="error" class="dt-pane-menu__error" role="alert">{{ error }}</p>
			<button v-for="l in lowers" :key="l" type="button" role="menuitem" class="dt-menu-item dt-pane-level__lower" :data-level="l" @click.stop="lower(l)">{{ levelWord(l) }}</button>
			<p class="dt-pane-menu__hint">To raise it, ask in the chat</p>
	</DtMenu>
</template>

<style scoped>
/* the shield keeps the warning colour on hover: this out-specifies NavSidebar's `.dt-nav-tool:hover:not(:disabled)` */
.dt-pane-level[data-level='admin'], .dt-pane-level[data-level='admin']:hover:not(:disabled) { color: var(--dt-warning); }
.dt-pane-level[aria-expanded='true'] { background: var(--dt-bg-hover); }
</style>
