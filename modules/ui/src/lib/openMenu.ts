/**
 * Which menu of the nav is open — ONE at a time across all of them: a nav row's menu and the toolbar's New folder /
 * Show hidden… asks (`'nav'`), and on a pane host the workspace switcher (`'switch'`) and the level (`'level'`).
 * Opening any one sets this, and every other reads it and closes. Ported from the Vue ui's lib/open-menu.ts.
 */
import { signal } from "./signal.ts"

export const openMenu = signal<string | null>(null)
