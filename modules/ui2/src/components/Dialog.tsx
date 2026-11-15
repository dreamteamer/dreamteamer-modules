/**
 * A CONFIRMING DIALOG — the record page's delete, rename and restore ask before they write (@dreamteamer/ui draws
 * these with reka-ui's AlertDialog). A plain overlay and box: Escape or a click on the overlay cancels, the
 * first control in the box takes the focus. The box stays mounted while its action runs, so a refusal is shown
 * in it — reka's dialog closed on click and lost the engine's sentence before it could paint.
 */
import { useEffect, useRef, type ReactNode } from "react"
import { Icon } from "./Icon.tsx"

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
    box.current?.querySelector<HTMLElement>("input, textarea, button.is-primary, button.is-danger")?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div className="ui2-dialog-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="ui2-dialog" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <header className="ui2-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="ui2-icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
