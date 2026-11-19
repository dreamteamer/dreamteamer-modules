/**
 * The toast stack (cr-modules-022): bottom-right of the window, newest last. A card with a tinted icon tile, the
 * sentence, the host's own words beneath it for an error, and a close button. Drawn only by the browser shell.
 * Ported from the Vue ui's ToastHost.vue.
 */
import { useSignal } from "../AppContext.tsx"
import { dismissToast, toasts, type ToastKind } from "../lib/toasts.ts"
import { cx, iconButton } from "../styles/classes.ts"
import { Icon } from "./Icon.tsx"

const ICON: Record<ToastKind, string> = { success: "check", error: "error", info: "info" }
const TILE: Record<ToastKind, string> = {
  success: "bg-[color-mix(in_srgb,var(--dt-success)_16%,transparent)] text-success",
  error: "bg-[color-mix(in_srgb,var(--dt-danger)_14%,transparent)] text-danger",
  info: "bg-accent-tint text-accent",
}

const stackCls = "fixed right-4 bottom-4 z-[calc(var(--dt-z-menu)+1)] flex flex-col items-end gap-2 pointer-events-none"
const toastCls =
  "pointer-events-auto flex items-start gap-3 w-[min(360px,calc(100vw-32px))] p-3 bg-surface rounded-xl shadow-menu text-fg [transition:transform_var(--dt-dur-med)_var(--dt-ease),opacity_var(--dt-dur-med)_var(--dt-ease)] starting:translate-y-2 starting:opacity-0"
const tileCls = "flex-none inline-flex items-center justify-center w-7 h-7 rounded-lg"

export function ToastHost() {
  const list = useSignal(toasts)
  return (
    <div className={stackCls} aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={toastCls} role={t.kind === "error" ? "alert" : "status"} data-toast={t.kind}>
          <span className={cx(tileCls, TILE[t.kind])}>
            <Icon name={ICON[t.kind]} />
          </span>
          <div className="flex-1 min-w-0 pt-[5px]">
            <p className="m-0 font-medium leading-tight">{t.text}</p>
            {t.detail && <p className="mt-1 mb-0 text-fg-subtle text-sm [overflow-wrap:anywhere]">{t.detail}</p>}
          </div>
          <button
            type="button"
            className={cx(iconButton, "flex-none")}
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}
