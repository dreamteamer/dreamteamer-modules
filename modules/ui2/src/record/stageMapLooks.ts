/**
 * THE STAGE MAP'S LOOKS (record/StageMap.tsx) — kept apart so test/stage-map-css.test.ts can read them without a
 * DOM. The map is two lines: a non-wrapping row of stage chips and one sentence under it; a card opens under a
 * chip. The map is a size container, and two widths shorten the chips to their index — the current stage keeps
 * its title until the narrower one — never reaching into the card. (was dt-stages, dt-stage-*)
 */
import { cx } from "../styles/classes.ts"

export type StageMark = "passed" | "current" | "ahead" | "skipped"

/** The map: the container the widths are measured on, and the box the card is placed against. */
export const stagesCls = "@container relative mb-4 pb-2 border-b border-border"
/** Line 1: the stages, one row that never wraps. */
export const stagesListCls =
  "flex flex-nowrap items-center gap-1 m-0 p-0 list-none whitespace-nowrap overflow-hidden @max-[400px]:gap-0.5"
/** One stage, a short rule before every one but the first. Not positioned: the row would clip the card. */
export const stageCls =
  "flex items-center shrink-0 gap-1 not-first:before:content-[''] not-first:before:inline-block not-first:before:w-3 not-first:before:h-px not-first:before:bg-border @max-[400px]:not-first:before:hidden"
/** A stage's chip; a stage not reached or passed over is muted. */
export const stageChipCls = (mark: StageMark) =>
  cx(
    "inline-flex items-center gap-1 py-0.5 px-1 border-0 rounded-dt bg-transparent cursor-default",
    "hover:bg-[var(--vscode-toolbar-hoverBackground,var(--dt-bg-hover))] aria-expanded:bg-[var(--vscode-toolbar-hoverBackground,var(--dt-bg-hover))]",
    "focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-1",
    "@max-[400px]:gap-0.5 @max-[400px]:px-px",
    mark === "ahead" || mark === "skipped" ? "text-fg-subtle" : "text-inherit"
  )
/** The chip's mark: a passed stage's tick in the testing colour, the current one's in the accent. */
export const stageIconCls = (mark: StageMark) =>
  mark === "passed"
    ? "[color:var(--vscode-testing-iconPassed,var(--dt-accent))]"
    : mark === "current"
      ? "text-accent"
      : undefined
/** The chip's title, capitalised; hidden at the narrow width (but the current stage's) and at the narrowest. */
export const stageTitleCls = (current: boolean) =>
  cx("capitalize @max-[400px]:hidden", current ? "font-semibold" : "@max-[560px]:hidden")
/** Line 2: one sentence, one line, its height kept while it loads. */
export const stagesNextCls =
  "mt-0.5 mx-0 mb-0 min-h-[1.4em] whitespace-nowrap overflow-hidden text-ellipsis text-small text-fg-subtle"
/** The next command, copied on a click. */
export const stagesCmdCls = "p-0 border-0 bg-transparent text-accent cursor-pointer hover:underline"
/** A stage's card, under the map, in the editor's hover-widget colours; its text wraps. */
export const stageCardCls =
  "absolute top-full z-20 w-[min(360px,100%)] max-h-[60vh] overflow-auto box-border p-2 whitespace-normal border rounded-dt [border-color:var(--vscode-editorHoverWidget-border,var(--dt-border))] [background-color:var(--vscode-editorHoverWidget-background,var(--dt-bg))] [color:var(--vscode-editorHoverWidget-foreground,inherit)] shadow-[0_2px_8px_var(--vscode-widget-shadow,rgb(0_0_0/0.16))]"
export const stageCardTitleCls = "capitalize font-semibold"
