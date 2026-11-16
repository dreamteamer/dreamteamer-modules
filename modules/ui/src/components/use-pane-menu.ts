/**
 * One of the nav toolbar's hanging menus (the switcher, the level): open while `openMenu` names it — so opening any
 * other nav menu closes it — closed by a click anywhere else, placed under its button inside the window, with
 * lib/menu-keys.ts's keyboard. The button and the menu stop their own clicks.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useSignal } from "../app-context.tsx"
import { menuKeys } from "../lib/menu-keys.ts"
import { menuUnder, rectOf, viewportWidth } from "../lib/menu-place.ts"
import { openMenu } from "../lib/open-menu.ts"

/** The width the pane menus are placed for (`.dt-pane-menu`). */
export const PANE_MENU_WIDTH = 220

export function usePaneMenu(id: string, align: "start" | "end") {
  const open = useSignal(openMenu) === id
  const [at, setAt] = useState({ x: 0, y: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const keys = useMemo(
    () =>
      menuKeys({
        items: () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])],
        menu: () => menu.current,
        button: () => button.current,
        close: () => openMenu.set(null),
      }),
    []
  )
  useEffect(() => {
    if (!open) return
    const away = () => openMenu.set(null)
    window.addEventListener("click", away)
    return () => window.removeEventListener("click", away)
  }, [open])
  return {
    open,
    at,
    button,
    menu,
    keys,
    /** Open under the button (returns true), or close an open one (false). */
    toggle(): boolean {
      if (open) {
        openMenu.set(null)
        return false
      }
      setAt(menuUnder(rectOf(button.current), align, PANE_MENU_WIDTH, viewportWidth()))
      openMenu.set(id)
      return true
    },
    close: () => {
      if (openMenu.get() === id) openMenu.set(null)
    },
  }
}
