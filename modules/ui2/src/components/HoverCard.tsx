/**
 * AN INSTANT HOVER CARD (ported from @dreamteamer/ui's HoverCard.vue, cr-vscode-013). The browser's `title`
 * tooltip shows after a delay a page cannot shorten; this card opens the moment the pointer enters. It is drawn
 * `position: fixed` against the trigger's rect (`lib/hover-place.ts`) — first at a provisional size, then, in a
 * layout effect (after the DOM update, before paint), at its MEASURED size, so a wrapped line never pushes it off
 * the bottom edge. `pointer-events: none`: it never takes the pointer from the row beneath it. A trigger wrapped
 * here must carry no `title` of its own, or the slow native copy follows the instant one.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { hoverPlace } from "../lib/hover-place.ts"

export interface HoverLine {
  text: string
  kind?: "title" | "body" | "code"
}

const PROVISIONAL = { width: 360, height: 120 }

export function HoverCard({
  lines,
  children,
  className,
}: {
  lines: HoverLine[]
  children: ReactNode
  className?: string
}) {
  const id = `ui2-hover-${useId()}`
  const shown = lines.filter(l => l.text.trim() !== "")
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState({ top: 0, left: 0 })
  const root = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)

  const place = (size: { width: number; height: number }) => {
    const el = root.current
    if (!el) return
    const { top, left } = hoverPlace(el.getBoundingClientRect(), size, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setAt({ top, left })
  }

  useLayoutEffect(() => {
    if (!open || !card.current || card.current.offsetWidth <= 0) return
    place({ width: card.current.offsetWidth, height: card.current.offsetHeight })
  }, [open, lines.map(l => l.text).join("\n")])

  return (
    <span
      ref={root}
      className={className}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => {
        if (!shown.length) return
        place(PROVISIONAL)
        setOpen(true)
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <div id={id} ref={card} role="tooltip" className="ui2-hover-card" style={{ top: at.top, left: at.left }}>
          {shown.map((l, i) => (
            <div key={i} className={`ui2-hover-line is-${l.kind ?? "body"}`}>
              {l.text}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
