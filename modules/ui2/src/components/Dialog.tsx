/**
 * A CONFIRMING DIALOG — the record page's delete, rename and restore ask before they write (the Vue ui draws
 * these with reka-ui's AlertDialog). A plain overlay and box: Escape or a click on the overlay cancels, the
 * first control in the box takes the focus. The box stays mounted while its action runs, so a refusal is shown
 * in it — reka's dialog closed on click and lost the engine's sentence before it could paint.
 */
import { useEffect, useRef, type ReactNode } from "react"
import { Icon } from "./Icon.tsx"
import { iconButton } from "../styles/classes.ts"

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  // the caller's handler is a fresh closure each render: read it through a ref, so the focus is taken once
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current()
    }
    document.addEventListener("keydown", onKey)
    // the first field takes the focus; a dialog with none focuses its action — the last button, after Cancel
    const el = box.current
    const first =
      el?.querySelector<HTMLElement>("[data-autofocus], input, textarea") ??
      [...(el?.querySelectorAll<HTMLElement>("button") ?? [])].at(-1)
    first?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-backdrop"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[min(440px,100%)] grid gap-3 px-[18px] py-4 bg-bg text-fg border border-border rounded-lg shadow-menu [&_p]:m-0"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
      >
        <header className="flex items-center justify-between">
          <h2 className="m-0 text-heading">{title}</h2>
          <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
