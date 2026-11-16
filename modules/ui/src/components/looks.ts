/**
 * THE LOOKS SEVERAL SHARED COMPONENTS DRAW WITH — Tailwind class strings over the tokens in styles/app.css, beside
 * the app-wide ones in styles/classes.ts. Each names the old `dt-*` rule it replaced.
 */

/** A 24 px icon button in the nav's toolbar (Back, Forward, the arrange lock, the pane level). (was dt-nav-tool) */
export const navTool =
  "relative flex-none inline-flex items-center justify-center w-6 h-6 p-0 border-0 rounded-dt bg-transparent text-fg-subtle enabled:hover:bg-bg-hover enabled:hover:text-fg disabled:opacity-45 aria-pressed:bg-bg-active aria-pressed:text-accent"

/** A menu a nav toolbar button opens, portalled to the body and placed fixed. (was dt-pane-menu) */
export const paneMenu =
  "fixed z-60 w-[220px] max-w-[calc(100vw-8px)] flex flex-col p-1 border border-border rounded-dt bg-bg shadow-[0_8px_24px_rgb(0_0_0/0.16)] outline-none [&>button]:overflow-hidden [&>button]:text-ellipsis [&>button]:whitespace-nowrap [&>button]:text-left [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-fg [&>button]:px-2 [&>button]:py-1 [&>button]:rounded-dt [&>button:hover]:bg-bg-hover [&>button:focus-visible]:bg-bg-hover [&>button:focus-visible]:outline-none [&>button[aria-checked=true]]:font-semibold"
/** A quiet line in a pane menu. (was dt-pane-menu-hint / -muted / -notice) */
export const paneMenuQuiet = "text-fg-subtle m-0"
/** A refusal shown inside a pane menu. (was dt-pane-menu-error) */
export const paneMenuError = "m-0 px-2 py-1 text-danger"

/** An edit control's frame: the input's background and border, the focus colour while anything inside has focus.
 *  (the frame dt-tags-edit, dt-relation-control and dt-markdown-edit shared) */
export const controlFrame = "bg-input-bg border border-input-border rounded-dt focus-within:border-focus"

/** A dropdown panel: the quick-input widget's colours, a deeper shadow. (dt-dd-panel, dt-relation-popover) */
export const dropPanel =
  "text-fg bg-[var(--vscode-quickInput-background,var(--vscode-editorWidget-background,var(--dt-bg)))] border border-[var(--vscode-widget-border,var(--dt-border))] rounded-dt shadow-[0_8px_24px_rgb(0_0_0/22%)]"

/** A text input that sits inside a frame: no frame of its own. */
export const bareInput = "min-h-0 border-0 outline-none bg-transparent"

/** The row list a dropdown draws its options in. (was dt-dd-list / dt-relation-list) */
export const plainList = "list-none m-0 p-0 overflow-y-auto"
