/**
 * THE BROWSE'S SHARED LOOKS — class strings several browse files draw with, over the tokens in styles/app.css (what
 * the whole app shares lives in styles/classes.ts). Each names the old `dt-*` rule it replaced.
 */
import { cx } from "../styles/classes.ts"

/** A panel beside the list: Layout options, Commands. Under the list when the window is narrow.
 *  (was dt-layout-options) */
export const sidePanel =
  "flex-[0_0_340px] min-h-0 overflow-y-auto flex flex-col gap-4 px-3 pt-0 pb-3 border border-border rounded-dt bg-bg-subtle max-[900px]:basis-auto"
/** The side panel's title bar, stuck to its top while it scrolls. (was dt-lo-head) */
export const panelHead =
  "flex flex-wrap items-center gap-1 sticky top-0 z-[3] -mx-3 py-1.5 pr-2 pl-3 border-b border-border bg-bg-subtle"
/** The side panel's title. (was dt-lo-title) */
export const panelTitle = "whitespace-nowrap flex-1 font-semibold"
/** A small capitalised label over a block, without its margin. */
export const capsLabel = "text-small font-semibold tracking-[0.04em] uppercase text-fg-subtle"
/** …with it. (was dt-lo-label) */
export const panelLabel = cx(capsLabel, "mt-0 mx-0 mb-0.5")
/** A floating panel under its anchor. (the dt-filter-panel, dt-lo-pop shadow and frame) */
export const floatingPanel = "bg-bg border border-border rounded-dt shadow-[0_8px_24px_rgb(0_0_0/0.16)]"
/** A source's colour dot; its colour is set inline. (was dt-source-dot) */
export const sourceDot = "inline-block flex-none w-2 h-2 mr-1 rounded-full"
