<script setup lang="ts">
/**
 * THE PANE'S LEVEL (cr-modules-017 §4; the 2026-11-14 16:30 revision made the pane bar's chip an icon at the nav
 * toolbar's right end): `eye` Read, `edit` Edit, `shield` Admin (in the warning colour), the tooltip naming the level
 * and, while a raise holds, since when. Its menu LOWERS the level (`POST /_dt/level`) and never raises it — the last
 * line sends a person to the chat, where `dt web open --edit|--admin` is. A raise in force is said at the menu's top;
 * a refused lower shows inside the menu.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import DtIcon from './DtIcon.vue';
import { hostInfo, loadHost } from '../lib/host-boot';
import { levelWord, lowerChoices, raiseNotice, type PaneLevel } from '../lib/pane-level';
import { paneFetch, paneMenu } from '../lib/pane-api';
import { menuUnder, rectOf, viewportWidth } from '../lib/menu-place';

const MENU_WIDTH = 220;
const ICONS: Record<PaneLevel, string> = { read: 'eye', edit: 'edit', admin: 'shield' };

const level = computed<PaneLevel>(() => (hostInfo.value?.level as PaneLevel | undefined) ?? 'read');
const notice = computed(() => (hostInfo.value ? raiseNotice({ level: level.value, raisedAt: hostInfo.value.raisedAt }) : null));
const lowers = computed(() => lowerChoices(level.value));
const title = computed(() => `Level: ${levelWord(level.value)}${notice.value ? ` — ${notice.value}` : ''}`);
const open = computed(() => paneMenu.value === 'level');
const at = ref({ x: 0, y: 0 });
/** A document to hang the menu in (the render test tier has none, and draws it in place). */
const hasBody = typeof document !== 'undefined' && !!(document as { body?: unknown }).body;
const error = ref<string | null>(null);

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
		paneMenu.value = null;
		await loadHost();
	} catch (err) {
		error.value = (err as Error).message;
	}
}

const away = () => { if (open.value) paneMenu.value = null; };
watch(open, (on) => {
	if (on) window.addEventListener('click', away);
	else window.removeEventListener('click', away);
});
onUnmounted(() => window.removeEventListener('click', away));
</script>

<template>
	<button
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
	<Teleport to="body" :disabled="!hasBody">
		<div v-if="open" class="dt-pane-menu dt-pane-level__menu" role="menu" :style="{ left: `${at.x}px`, top: `${at.y}px` }" @click.stop>
			<p v-if="notice" class="dt-pane-menu__notice">{{ notice }}</p>
			<p v-if="error" class="dt-pane-menu__error" role="alert">{{ error }}</p>
			<button v-for="l in lowers" :key="l" type="button" role="menuitem" class="dt-pane-level__lower" :data-level="l" @click.stop="lower(l)">{{ levelWord(l) }}</button>
			<p class="dt-pane-menu__hint">To raise it, ask in the chat</p>
		</div>
	</Teleport>
</template>

<style scoped>
.dt-pane-level[data-level='admin'] { color: var(--dt-warning); }
.dt-pane-level[aria-expanded='true'] { background: var(--dt-bg-hover); }
</style>
