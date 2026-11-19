/**
 * THE LOOKS SEVERAL SHARED COMPONENTS DRAW WITH — Tailwind class strings over the tokens in styles/app.css, beside
 * the app-wide ones in styles/classes.ts. Each names the old `dt-*` rule it replaced.
 */

/** A 24 px icon button in the nav's toolbar (Back, Forward, the arrange lock, the pane level). (was dt-nav-tool) */
export const navTool =
  "relative flex-none inline-flex items-center justify-center w-6 h-6 p-0 border-0 rounded-dt bg-transparent text-fg-subtle enabled:hover:bg-bg-hover enabled:hover:text-fg disabled:opacity-45 aria-pressed:bg-accent-tint aria-pressed:text-accent [transition:background-color_var(--dt-dur-fast)_ease,transform_var(--dt-dur-fast)_var(--dt-ease)] enabled:active:scale-[0.97]"

/** A menu a nav toolbar button opens, portalled to the body and placed fixed. (was dt-pane-menu) */
export const paneMenu =
  "fixed w-[220px] max-w-[calc(100vw-8px)] flex flex-col p-1 border border-(color:--dt-menu-border) rounded-menu bg-bg shadow-menu z-(--dt-z-menu) outline-none"
/** One entry of a pane menu, and one entry of `paneMenuItemPlace`. (was dt-pane-menu > button) */
export const paneMenuItem =
  "overflow-hidden text-ellipsis whitespace-nowrap text-left bg-transparent text-fg px-2 pb-1 hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none aria-checked:font-semibold"
/** Where an entry sits: among the choices, or the last row, ruled off from them. */
export const paneMenuItemPlace = {
  default: "border-0 pt-1 rounded-dt",
  footer: "border-x-0 border-b-0 border-t border-border mt-0.5 pt-1.5 rounded-none",
} as const satisfies Record<string, string>
/** A quiet line in a pane menu. (was dt-pane-menu-hint / -muted / -notice) */
export const paneMenuQuiet = "text-fg-subtle m-0"
/** A refusal shown inside a pane menu. (was dt-pane-menu-error) */
export const paneMenuError = "m-0 px-2 py-1 text-danger"

/** An edit control's frame: the input's background and border, the focus colour while anything inside has focus.
 *  (the frame dt-tags-edit, dt-relation-control and dt-markdown-edit shared) */
export const controlFrame = "bg-input-bg border border-input-border rounded-dt focus-within:border-focus"

/** A dropdown panel: the quick-input widget's colours, a deeper shadow. (dt-dd-panel, dt-relation-popover) */
export const dropPanel =
  "text-fg bg-[var(--vscode-quickInput-background,var(--vscode-editorWidget-background,var(--dt-bg)))] border border-[var(--vscode-widget-border,var(--dt-border))] rounded-menu shadow-menu"

/** A text input that sits inside a frame: no frame of its own. */
export const bareInput = "min-h-0 border-0 outline-none bg-transparent"

/** The row list a dropdown draws its options in. (was dt-dd-list / dt-relation-list) */
export const plainList = "list-none m-0 p-0 overflow-y-auto"

/** A dropdown's closed control: an input-like button; add its border colour (input-border, or focus while open).
 *  (was dt-dd-control) */
export const ddControl =
  "flex items-center gap-1.5 w-full min-h-[30px] px-2 py-1 text-left text-fg bg-input-bg border rounded-dt cursor-pointer disabled:cursor-default disabled:opacity-60"
