/**
 * An anchored panel's open state, closed by a mousedown outside its anchor or by Escape — the filter panel's,
 * the density menu's and the source picker's one pattern (ported from @dreamteamer/ui's BrowseView and
 * DensityMenu). Not a portal: the panel sits in flow under its trigger, so there is no z-index or placement math
 * to get wrong.
 */
import { useEffect, useRef, useState, type RefObject } from "react"

export function usePopover<T extends HTMLElement = HTMLDivElement>(
  controlled?: [boolean, (open: boolean) => void]
): { open: boolean; setOpen: (open: boolean) => void; anchor: RefObject<T | null> } {
  const own = useState(false)
  const [open, setOpen] = controlled ?? own
  const anchor = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, setOpen])
  return { open, setOpen, anchor }
}
