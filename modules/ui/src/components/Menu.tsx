/**
 * THE ONE MENU. Every dropdown and context menu in the app is drawn by this component: the ⋯ menus on a record and on
 * a field, the row density and commit menus, the new-record menu, the source picker, the nav's row menu and toolbar
 * asks, the pane's switcher and level menus — and the panel of the two combobox dropdowns (Select, the relation
 * picker), which keep their own keyboard because focus stays in their search field. Ported from the Vue ui's DtMenu.
 *
 * One surface: `menuSurface` (styles/classes.ts) — the background, `--dt-menu-border`, `--dt-menu-radius`,
 * `--dt-shadow-menu` and `--dt-z-menu` — so each host's look comes from its tokens. No animation: a menu appears and
 * goes, so prefers-reduced-motion has nothing to stop.
 *
 * One keyboard (`keys`, lib/menuKeys.ts): on open focus goes to the first item (or the menu itself when it has none);
 * arrows, Tab, Home/End and type-ahead move among the items, skipping disabled ones; Escape closes. A combobox passes
 * `keys={false}` and keeps its own.
 *
 * One dismissal (`dismiss`): Escape anywhere and a press outside the menu and its trigger call `onClose` (once,
 * however many listeners see the same key); focus then goes back to the trigger — unless the press outside put it
 * somewhere else. The caller owns whether the menu is drawn and what a pick does.
 *
 * Placement: ALWAYS `position: fixed`, so no scrolling or `overflow: hidden` ancestor clips it, on `--dt-z-menu`.
 * Without `at` the menu hangs under its parent element (the box that holds the trigger — the trigger itself when
 * portalled), on its start or `end` edge (lib/menuPlace.ts `placeMenu`): FLIPPED above it when there is no room below,
 * and kept inside the window horizontally. It is placed again on every scroll (any scroller, capture phase) and
 * resize, so it stays with its trigger. `at` is a fixed point in the viewport (a context menu, a menu hung from a
 * toolbar button — computed with `menuUnder`), flipped above its trigger and clamped the same way, but not moved on
 * scroll: a point has nothing to follow. `portal` hangs it in <body>.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import { MENU_ITEM_SELECTOR, menuMove, typeahead, typeaheadIndex, typedChar } from "../lib/menuKeys.ts"
import { placeMenu, type Box } from "../lib/menuPlace.ts"
import { cx, menuSurface } from "../styles/classes.ts"

export type MenuCloseReason = "escape" | "outside"

/** What a caller may ask of an open menu. */
export interface MenuHandle {
  /** Focus the first item — for a menu whose items arrive after it opened (the workspace switcher's list). */
  focusFirst(): void
  el: HTMLDivElement | null
}

export interface MenuProps {
  /** The menu's accessible name. */
  label?: string
  /** `menu` (actions, choices), `listbox` (a list of options — the source picker), or `presentation` for a combobox's
   *  panel, whose own list carries the listbox role. */
  role?: "menu" | "listbox" | "presentation"
  multiselectable?: boolean
  /** A fixed point in the viewport; absent, the menu hangs under its parent element. */
  at?: { x: number; y: number } | null
  /** Which edge of the parent an anchored menu lines up with. */
  align?: "start" | "end"
  /** `none`: the caller positions the panel itself (a combobox measuring its control). */
  anchor?: "below" | "none"
  /** The control that opened it: a press on it is not "outside", and focus goes back to it. Absent, the element that
   *  had focus when the menu opened. */
  trigger?: HTMLElement | null | { current: HTMLElement | null }
  /** Hang it in <body>. */
  portal?: boolean
  /** The menu keyboard and focus handling; false for a combobox that keeps focus in its own field. */
  keys?: boolean
  /** Escape and a press outside close it; false when the caller does both itself. */
  dismiss?: boolean
  /** On open (with `keys`): focus the first item (true), the menu itself (`"menu"`), or nothing. */
  autofocus?: boolean | "menu"
  minWidth?: number
  /** An anchored menu as wide as the box it hangs from (a combobox's panel under its control). */
  matchWidth?: boolean
  className?: string
  style?: CSSProperties
  onClose?: (reason: MenuCloseReason) => void
  /** A click inside (a menu inside something that closes on any click stops it here). */
  onClick?: MouseEventHandler<HTMLDivElement>
  /** A key inside, after the menu's own keyboard (a combobox that keeps its own: `keys={false}`). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
  ref?: Ref<MenuHandle>
  [data: `data-${string}`]: string | boolean | undefined
}

const isDisabled = (x: Element) => x.hasAttribute("disabled") || x.getAttribute("aria-disabled") === "true"

export function Menu({
  label,
  role = "menu",
  multiselectable = false,
  at = null,
  align = "start",
  anchor = "below",
  trigger,
  portal = false,
  keys = true,
  dismiss = true,
  autofocus = true,
  minWidth,
  matchWidth = false,
  className,
  style,
  onClose,
  onClick,
  onKeyDown: onKeyDownProp,
  children,
  ref,
  ...data
}: MenuProps) {
  const el = useRef<HTMLDivElement | null>(null)
  const [placed, setPlaced] = useState<{ left: number; top: number; flipped: boolean; width?: number } | null>(null)
  const cursor = useRef(-1)
  const typed = useRef(typeahead())
  // the element that had focus when the menu opened: where focus goes back without a trigger
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  const closing = useRef(false)
  const closedBy = useRef<MenuCloseReason | null>(null)
  const onCloseNow = useRef(onClose)
  onCloseNow.current = onClose

  const triggerEl = useCallback((): HTMLElement | null => {
    if (!trigger) return null
    return trigger instanceof HTMLElement ? trigger : trigger.current
  }, [trigger])

  const items = useCallback((): HTMLElement[] => {
    const list = el.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)
    return list ? Array.from(list).filter(x => !isDisabled(x)) : []
  }, [])

  const focusAt = useCallback(
    (i: number, list = items()) => {
      if (!list.length || i < 0) {
        cursor.current = -1
        el.current?.focus()
        return
      }
      cursor.current = Math.min(i, list.length - 1)
      list[cursor.current]!.focus()
    },
    [items]
  )

  useImperativeHandle(
    ref,
    () => ({
      focusFirst: () => requestAnimationFrame(() => focusAt(0)),
      get el() {
        return el.current
      },
    }),
    [focusAt]
  )

  const close = useCallback((reason: MenuCloseReason) => {
    // the same key can reach the menu and the document: one close
    if (closing.current) return
    closing.current = true
    closedBy.current = reason
    onCloseNow.current?.(reason)
    void Promise.resolve().then(() => {
      closing.current = false
    })
  }, [])

  /** The box an anchored menu hangs from: its parent element in place, the trigger when portalled. */
  const anchorBox = useCallback((): Element | null => {
    if (portal) return triggerEl()
    return el.current?.parentElement ?? triggerEl()
  }, [portal, triggerEl])

  /** Place the menu inside the window (see the header): measured, so only where there is layout. */
  const place = useCallback(() => {
    if (anchor === "none" || typeof window === "undefined") return
    const r = el.current?.getBoundingClientRect()
    if (!r || !(r.width || r.height)) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const size = { width: r.width, height: r.height }
    if (at) {
      // a point: under it as asked, above the trigger (or the point) when that does not fit
      const t = triggerEl()?.getBoundingClientRect()
      const box: Box = { left: at.x, right: at.x + r.width, top: t && t.height ? t.top : at.y, bottom: at.y }
      setPlaced(placeMenu(box, size, viewport, "start", 0))
      return
    }
    const a = anchorBox()?.getBoundingClientRect()
    if (!a) return
    if (matchWidth) size.width = a.width
    setPlaced({ ...placeMenu(a, size, viewport, align), ...(matchWidth ? { width: a.width } : {}) })
  }, [anchor, at, align, matchWidth, anchorBox, triggerEl])

  // before the first paint: an anchored menu never shows at the window's corner first
  useLayoutEffect(() => {
    place()
  }, [place])

  useEffect(() => {
    if (anchor === "none") return
    // a scroll: an anchored menu follows its trigger; a point menu stays where it is
    const onScroll = () => {
      if (!at) place()
    }
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", place)
    }
  }, [anchor, at, place])

  useEffect(() => {
    if (!dismiss) return
    const within = (box: Element | null | undefined, target: EventTarget | null) =>
      !!box && target instanceof Node && box.contains(target)
    const onDown = (e: MouseEvent) => {
      const a = triggerEl() ?? (at || portal ? null : (el.current?.parentElement ?? null))
      if (within(el.current, e.target) || within(a, e.target)) return
      close("outside")
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      close("escape")
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [dismiss, at, portal, triggerEl, close])

  // focus on open, and back to the trigger on close
  useEffect(() => {
    if (keys && autofocus) requestAnimationFrame(() => focusAt(autofocus === "menu" ? -1 : 0))
    const self = el
    return () => {
      if (!keys || closedBy.current === "outside") return
      // focus goes back only when it was in the menu (or nowhere): a press elsewhere keeps its own
      const active = document.activeElement
      if (active && active !== document.body && !self.current?.contains(active)) return
      ;(triggerEl() ?? opener.current)?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [])

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const i = items().indexOf(e.target as HTMLElement)
    if (i >= 0) cursor.current = i
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    ownKeys(e)
    if (!e.isPropagationStopped()) onKeyDownProp?.(e)
  }

  const ownKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (!dismiss) return
      e.preventDefault()
      // one Escape closes one layer: not the drawer or the filter panel behind the menu as well
      e.stopPropagation()
      close("escape")
      return
    }
    if (!keys) return
    const list = items()
    // keys typed into a field inside the menu (the nav's asks, an icon search) are the field's own
    if (e.target !== el.current && !list.includes(e.target as HTMLElement)) return
    const to = menuMove(e.key, cursor.current, list.length, e.shiftKey)
    if (to !== null) {
      e.preventDefault()
      focusAt(to, list)
      return
    }
    const ch = typedChar(e)
    if (!ch) return
    const i = typeaheadIndex(
      list.map(x => x.textContent ?? ""),
      typed.current(ch),
      cursor.current
    )
    if (i >= 0) {
      e.preventDefault()
      focusAt(i, list)
    }
  }

  const pos: CSSProperties = { ...style }
  if (placed) {
    pos.left = placed.left
    pos.top = placed.top
    if (placed.width !== undefined) pos.width = placed.width
  } else if (at) {
    pos.left = at.x
    pos.top = at.y
  } else if (anchor === "below") {
    // not measured yet: drawn out of sight for the one frame before placement
    pos.visibility = "hidden"
  }
  if (minWidth) pos.minWidth = minWidth

  const node = (
    <div
      ref={el}
      {...data}
      className={cx(menuSurface, className)}
      style={pos}
      role={role}
      aria-label={label}
      aria-multiselectable={role === "listbox" && multiselectable ? true : undefined}
      data-menu-flipped={placed?.flipped || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={onClick}
    >
      {children}
    </div>
  )
  return portal && typeof document !== "undefined" ? createPortal(node, document.body) : node
}
