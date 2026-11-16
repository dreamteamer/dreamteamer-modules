/**
 * THE LISTS' SHARED LOOKS — what several built-in Lists draw with, over the tokens in styles/app.css (what the whole
 * app shares lives in styles/classes.ts). Each names the old `dt-*` rule it replaced.
 */
import { cx } from "../styles/classes.ts"

/**
 * ONE CARD SURFACE for the board, the grid and the carousel, so radius, padding, hover and wrapping cannot drift
 * apart. A card is clickable whether or not it may be dragged, so it draws the pointer and nothing a board adds
 * sets a cursor of its own (a locked board's card still opens its record). `overflow-wrap: anywhere`: a long id
 * or url in a template breaks rather than widens. A TINTED card (a `tint` rule matched; `--dt-tint` and
 * `--dt-tint-bg` set inline) wears its colour as a left bar and a wash, the bar kept on hover. (was dt-record-card)
 */
export const recordCard = (tinted: boolean) =>
  cx(
    "relative border border-border rounded-dt py-2.5 px-3 cursor-pointer text-ui text-fg overflow-hidden [overflow-wrap:anywhere]",
    "[transition:box-shadow_0.12s_ease,border-color_0.1s_ease] hover:shadow-[0_1px_4px_color-mix(in_srgb,var(--dt-fg)_12%,transparent)]",
    "hover:border-t-input-border hover:border-r-input-border hover:border-b-input-border",
    tinted
      ? "border-l-[3px] border-l-(--dt-tint) bg-[color-mix(in_srgb,var(--dt-tint-bg)_8%,var(--dt-bg))]"
      : "bg-bg hover:border-l-input-border"
  )

/** A card's footer: its source mark, right-aligned, at the bottom. (was dt-record-card-foot) */
export const cardFoot =
  "flex flex-wrap items-center justify-end gap-1.5 mt-auto pt-1.5 text-small min-w-0 [&>*]:shrink-0 [&>*]:max-w-full [&>*]:overflow-hidden"
