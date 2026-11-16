/**
 * THE SCHEMA TAB'S SHARED LOOKS — class strings several settings files draw with, over the tokens in app.css
 * (the shared app-wide ones are in styles/classes.ts). Each names the old `dt-*` rule it replaced.
 */
import { cx, hintError } from "../styles/classes.ts"

/** A small uppercase heading over a block. (was dt-section-label) */
export const sectionLabel = "mt-[18px] mx-0 mb-2 text-small font-semibold tracking-[0.06em] uppercase text-fg-subtle"

/** A plain data table: header row tinted, rows hover. (was dt-table) */
export const table = cx(
  "w-full border-collapse",
  "[&_th]:text-left [&_th]:px-3 [&_th]:py-[7px] [&_th]:border-b [&_th]:border-border [&_th]:whitespace-nowrap [&_th]:max-w-[320px] [&_th]:overflow-hidden [&_th]:text-ellipsis",
  "[&_td]:text-left [&_td]:px-3 [&_td]:py-[7px] [&_td]:border-b [&_td]:border-border [&_td]:whitespace-nowrap [&_td]:max-w-[320px] [&_td]:overflow-hidden [&_td]:text-ellipsis",
  "[&_th]:text-small [&_th]:uppercase [&_th]:tracking-[0.04em] [&_th]:text-fg-subtle [&_th]:font-semibold [&_th]:bg-bg-subtle",
  "[&_tbody_tr]:cursor-pointer [&_tbody_tr:hover]:bg-bg-hover [&_tbody_tr:last-child_td]:border-b-0"
)
/** A number column of a table. (was dt-table .is-num) — `!` beats the table's `[&_td]:text-left`. */
export const num = "text-right! tabular-nums"

/** A dialog's form: its rows stacked, no paragraph margins. (was dt-dialog-form) */
export const dialogForm = "grid gap-3 [&_p]:m-0"
/** A drawer tab's rows, the display keys, the relationship block. (was dt-drawer-panel, dt-display-keys, dt-rel) */
export const panel = "grid gap-3"
/** Two form rows side by side, wrapping when narrow. (was dt-form-pair) */
export const formPair = "grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
/** Checkboxes in a wrapping row. (was dt-checks) */
export const checks = "flex flex-wrap gap-x-4 gap-y-1"
/** An error hint whose `<code>` keeps the hint's code look. (was dt-hint.is-error) */
export const hintErr = cx(hintError, "[&_code]:font-mono [&_code]:text-fg")
