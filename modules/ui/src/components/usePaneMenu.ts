/**
 * One of the nav toolbar's hanging menus (the switcher, the level): open while `openMenu` names it — so opening any
 * other nav menu closes it — placed under its button inside the window, and drawn by components/Menu.tsx, which owns
 * the keyboard, the dismissal and focus going back to the button. The button and the menu stop their own clicks.
 */
import { useEffect, useRef, useState } from "react"
import { useSignal } from "../AppContext.tsx"
import { menuUnder, rectOf, viewportWidth } from "../lib/menuPlace.ts"
import { openMenu } from "../lib/openMenu.ts"
import type { MenuHandle } from "./Menu.tsx"

/** The width the pane menus are placed for (`paneMenu` in looks.ts). */
export const PANE_MENU_WIDTH = 220

export function usePaneMenu(id: string, align: "start" | "end") {
  const open = useSignal(openMenu) === id
  const [at, setAt] = useState({ x: 0, y: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<MenuHandle>(null)
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
