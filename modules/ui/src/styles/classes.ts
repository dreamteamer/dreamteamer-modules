/**
 * THE SHARED LOOKS — the Tailwind class strings every part of the app draws its common pieces with, so a button is
 * one button wherever it appears. A component styles what is its own with utilities in place; what several share
 * (a button, a menu, a hint, a notice, a chip, a page frame, a form row) comes from here. Each string is the old
 * `dt-*` rule it replaced, written as utilities over the tokens in app.css.
 *
 * `cx(...)` joins class names, dropping false, null and undefined: `cx(button, primary && buttonPrimary)`.
 *
 * A MODIFIER (buttonPrimary, menuItemDanger, noticeOk, invalid, …) marks the properties it overrides `!important`:
 * two utilities that set one property are ordered by the stylesheet, never by the class list, so without it
 * `cx(button, buttonPrimary)` could draw a plain button. The old rules won the same way, by a compound selector.
 */
export const cx = (...parts: Array<string | false | null | undefined | 0>): string => parts.filter(Boolean).join(" ")

// ---- text ----------------------------------------------------------------------------------------------------------
/** Secondary text. (was dt-subtle, dt-empty) */
export const subtle = "text-fg-subtle"
/** A small secondary line under a control. (was dt-hint) */
export const hint = "text-small text-fg-subtle [&_code]:font-mono [&_code]:text-fg"
/** …the same in the error colour. (was dt-hint.is-error) */
export const hintError = "text-small text-danger"
/** Ids, paths, code. (was dt-mono) */
export const mono = "font-mono text-[12px] break-all"
/** A value that keeps its line breaks and wraps anywhere. (was dt-wrap) */
export const wrap = "whitespace-pre-wrap [overflow-wrap:anywhere]"
/** The required mark after a label. (was dt-required) */
export const required = "text-danger"

// ---- messages ------------------------------------------------------------------------------------------------------
/** A failure the host or the engine answered, in its own words. (was dt-error) */
export const error =
  "text-danger border border-[color-mix(in_srgb,var(--dt-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--dt-danger)_8%,transparent)] rounded-dt px-3 py-2 whitespace-pre-wrap"
/** A quiet line with an icon. (was dt-note) */
export const note = "m-0 flex items-center gap-1.5 text-fg-subtle"
/** A boxed notice; add one of the tones. (was dt-notice) */
export const notice = "flex items-start gap-2 max-w-[920px] mb-1.5 px-3 py-[7px] border border-border rounded-dt"
export const noticeOk =
  "border-[color-mix(in_srgb,var(--dt-color-charts-green)_40%,transparent)]! bg-[color-mix(in_srgb,var(--dt-color-charts-green)_9%,transparent)] font-mono text-[12px] [&_.codicon]:text-chart-green"
export const noticeWarning =
  "border-[color-mix(in_srgb,var(--dt-warning)_40%,transparent)]! bg-[color-mix(in_srgb,var(--dt-warning)_9%,transparent)] [&_.codicon]:text-warning"
export const noticeError =
  "border-[color-mix(in_srgb,var(--dt-danger)_40%,transparent)]! bg-[color-mix(in_srgb,var(--dt-danger)_9%,transparent)] [&_.codicon]:text-danger"
/** A list or page with nothing to show: centred, quiet. (was dt-list-empty) */
export const listEmpty = "flex flex-col items-center justify-center gap-2 px-4 py-10 text-fg-subtle [&_p]:m-0"

// ---- page frame ----------------------------------------------------------------------------------------------------
/** A page's padding. (was dt-page) */
export const page = "px-6 py-5"
/** A page's header: title on the left, toolbar on the right. (was dt-page-head) */
export const pageHead = "flex items-start justify-between gap-4 flex-wrap mb-4 [&_p]:mt-1 [&_p]:mb-0"
/** A row of controls. (was dt-toolbar) */
export const toolbar = "flex gap-2 items-center flex-wrap"
/** A dialog's buttons. (was dt-dialog-actions) */
export const dialogActions = "flex justify-end gap-2"
/** Children stacked with a small gap. (was dt-stack) */
export const stack = "grid gap-1"

// ---- buttons -------------------------------------------------------------------------------------------------------
/** The ordinary button. (was dt-button) */
export const button =
  "inline-flex items-center gap-1.5 h-[30px] px-3 py-0 border border-input-border rounded-dt bg-bg text-fg cursor-pointer enabled:hover:bg-bg-hover disabled:opacity-50 disabled:cursor-default"
/** …the one action of a form or dialog. (was dt-button.is-primary) — use with `button`. */
export const buttonPrimary =
  "bg-accent! border-accent! text-accent-fg! enabled:hover:bg-[color-mix(in_srgb,var(--dt-accent)_88%,black)]!"
/** …destructive. (was dt-button.is-danger) */
export const buttonDanger = "text-danger!"
/** …small. (was dt-button.is-small) */
export const buttonSmall = "h-6! px-2! text-small!"
/** …an icon only. (was dt-button.is-icon) */
export const buttonIcon = "px-2!"
/** …pressed / open; hovering still shows the hover ground. (was dt-button.is-active) */
export const buttonActive = "border-focus! bg-bg-active! enabled:hover:bg-bg-hover!"
/** A round icon button with no frame. (was dt-icon-button) */
export const iconButton =
  "inline-flex items-center justify-center w-[22px] h-[22px] p-0 border-0 rounded-full bg-transparent text-fg-subtle cursor-pointer hover:bg-bg-hover hover:text-fg"
/** A button that reads as text. (was dt-link-button) */
export const linkButton =
  "inline-flex items-center gap-1 bg-transparent border-0 p-0 text-inherit [text-transform:inherit] [letter-spacing:inherit] cursor-pointer"

// ---- menus and popovers --------------------------------------------------------------------------------------------
/** The relative box a popover hangs from. (was dt-popover-anchor) */
export const popoverAnchor = "relative inline-flex"
/** A menu hanging under its anchor. (was dt-menu) */
export const menu =
  "absolute top-[calc(100%+4px)] right-0 z-20 min-w-[180px] max-w-[min(360px,calc(100vw-32px))] p-1 flex flex-col bg-bg border border-border rounded-dt shadow-[0_8px_24px_rgb(0_0_0/0.16)] [&>p]:mx-2 [&>p]:my-1"
/** One entry of a menu. (was dt-menu-item) */
export const menuItem =
  "flex items-center gap-2 px-2 py-[5px] border-0 rounded bg-transparent text-fg text-left cursor-pointer whitespace-nowrap hover:bg-bg-hover"
/** …one that cannot be picked. (was dt-menu-item.is-absent) */
export const menuItemAbsent = "opacity-55 cursor-default!"
/** …destructive. (was dt-menu-item.is-danger) */
export const menuItemDanger = "text-danger!"
/** The tick column of a menu entry. (was dt-menu-check) */
export const menuCheck = "w-4 inline-flex"
/** The label of a menu entry. (was dt-menu-label) */
export const menuLabel = "flex-1 min-w-0"

// ---- forms ---------------------------------------------------------------------------------------------------------
/** A labelled control: label above, control below. (was dt-form-row) */
export const formRow =
  "grid gap-1 min-w-0 m-0 p-0 border-0 [&>span]:font-semibold [&>span]:p-0 [&>span]:mb-1 [&>legend]:font-semibold [&>legend]:p-0 [&>legend]:mb-1"
/** A full-width text input. (was dt-input) */
export const input = "w-full"
/** A full-width textarea. (was dt-textarea) */
export const textarea = "w-full"
/** A checkbox with its label beside it. (was dt-check) */
export const check = "flex items-start gap-2 [&_input]:mt-0.5 [&_input]:mb-0 [&_input]:mx-0"
/** A control showing an invalid value. (was is-invalid) */
export const invalid = "text-danger! border-danger!"

// ---- values --------------------------------------------------------------------------------------------------------
/** Key–value pairs: a nested object, a list row opened. (was dt-kv) */
export const kv =
  "grid grid-cols-[minmax(90px,max-content)_1fr] gap-x-3.5 gap-y-1 m-0 [&>div]:contents [&_dt]:text-fg-subtle [&_dd]:m-0 [&_dd]:whitespace-pre-wrap [&_dd]:[overflow-wrap:anywhere]"
/** A row of chips, labels or references; a table cell keeps it on one line by its `data-items`. (was dt-chips) */
export const items = "inline-flex flex-wrap gap-1"
/** A value chip; set `--chip` (and optionally `--chip-bg`) inline for its colour. (was dt-chip) */
export const chip =
  "[--chip:var(--dt-unknown-color)] [--chip-bg:color-mix(in_srgb,var(--chip)_14%,transparent)] inline-flex items-center gap-1 px-2 py-px rounded-full text-small text-(--chip) bg-(--chip-bg) border border-[color-mix(in_srgb,var(--chip)_35%,transparent)] whitespace-nowrap"
