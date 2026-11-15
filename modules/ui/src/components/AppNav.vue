<script setup lang="ts">
/**
 * The nav as App draws it under a host with no native tree (dt web): NavSidebar and, on a pane host (GET /host
 * answered a workspace id; reading 3: never in the editor), the pane's two controls in its toolbar — the workspace
 * name becomes the switcher, and the level is an icon at the toolbar's right end, after the arrange lock (the
 * 2026-11-14 16:30 revision of cr-modules-017: no bar above the page). Off a pane host the name is plain text and
 * there is no level.
 *
 * Arranging needs Edit: at Read the arrange lock is disabled with that reason, and a lower to Read while the nav is
 * unlocked locks it (NavSidebar locks whenever `arrangeBlocked` turns on).
 */
import { computed } from "vue"
import NavSidebar from "./NavSidebar.vue"
import PaneSwitcher from "./PaneSwitcher.vue"
import PaneLevel from "./PaneLevel.vue"
import { hostInfo, paneHost } from "../lib/host-boot"

/** The sentence the disabled arrange lock says at Read. */
const NEEDS_EDIT = "Arranging the nav needs Edit"

const pane = computed(() => paneHost())
const blocked = computed(() => (pane.value && (hostInfo.value?.level ?? "read") === "read" ? NEEDS_EDIT : null))
</script>

<template>
  <NavSidebar :arrange-blocked="blocked">
    <template v-if="pane" #name="{ label }"><PaneSwitcher :label="label" /></template>
    <template v-if="pane" #end><PaneLevel /></template>
  </NavSidebar>
</template>
