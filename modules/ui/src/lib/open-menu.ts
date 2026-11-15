/**
 * Which menu of the nav is open — ONE at a time across all of them: a nav row's menu and the toolbar's New folder /
 * Show hidden… asks (`'nav'`), and on a pane host the workspace switcher (`'switch'`) and the level (`'level'`).
 * Opening any one sets this, and every other watches it and closes.
 */
import { ref } from "vue"

export const openMenu = ref<string | null>(null)
