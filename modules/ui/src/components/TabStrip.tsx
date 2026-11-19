/**
 * The browser shell's TAB STRIP (cr-modules-022): pill tabs in a 32px row at the top of the sheet — the nav toolbar's
 * height, so the two still read as one band. A tab's × space is always reserved (the × only shows on hover and on the
 * open tab), so a tab never changes width under the pointer. × or a middle click closes; closing the open tab opens its
 * neighbour. Tabs shrink to a minimum before the strip scrolls sideways (a wheel scrolls it too, and the open tab is
 * always scrolled into view); it fades at its end when the tabs outrun it. At most TAB_CAP tabs (lib/tabs.ts).
 *
 * A RELOAD restores the tabs and the selected one: the list and the selected path are kept (lib/tabs.ts), the page's
 * own address wins when it names a page, and a page that FIRST opens on the home route (a fresh `dt web open`) goes to
 * the tab that was selected instead. Ported from the Vue ui's TabStrip.vue.
 */
import { useEffect, useRef, type MouseEvent } from "react"
import { useApp, useSignal } from "../AppContext.tsx"
import {
  closeTab,
  isTransit,
  openTab,
  restoreActive,
  restoreTabs,
  saveActive,
  saveTabs,
  startTabs,
  tabPath,
  tabs as tabList,
} from "../lib/tabs.ts"
import { cx } from "../styles/classes.ts"
import { Icon } from "./Icon.tsx"

/** The strip: the end fades when the tabs outrun it (a mask's opacity, never a colour anyone sees). */
const stripCls =
  "flex-none flex items-center gap-1 h-8 pt-1 px-3 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]"
/** One tab: shrinks first (the label ellipsises, the × keeps its room), scrolls only past the minimum. */
const tabCls =
  "group/tab relative flex-[0_1_200px] min-w-[72px] max-w-[200px] h-[26px] flex items-center rounded-pill [transition:background-color_var(--dt-dur-fast)_var(--dt-ease),color_var(--dt-dur-fast)_var(--dt-ease)]"
const tabIdle = "text-fg-subtle hover:bg-ink-2 hover:text-fg"
const tabActive = "bg-ink-4 text-fg font-medium"
/** The × is laid over the right end: its 22px are reserved here whether it shows or not. */
const openCls =
  "flex-1 min-w-0 h-full flex items-center gap-1.5 pr-[26px] pl-2.5 border-0 rounded-[inherit] bg-transparent text-inherit text-left cursor-default [&_.codicon]:flex-none"
const closeCls =
  "absolute right-1 top-1/2 -translate-y-1/2 w-[18px] h-[18px] inline-flex items-center justify-center p-0 border-0 rounded-pill bg-transparent text-fg-subtle cursor-default opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 hover:bg-ink-4 hover:text-fg [&_.codicon]:text-sm!"

export function TabStrip() {
  const { route, navigate } = useApp()
  const list = useSignal(tabList)
  const strip = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const activePath = tabPath(route)

  useEffect(() => {
    if (first.current) {
      restoreTabs()
      startTabs()
    }
    const isFirst = first.current
    first.current = false
    if (isFirst && isTransit(route)) {
      // a fresh page: back to the tab that was selected, when there still is one
      const kept = restoreActive()
      const tab = kept ? tabList.get().find(t => t.path === kept) : undefined
      if (tab && tab.route !== route) return navigate(tab.route)
    }
    openTab(route)
    // the open tab is never scrolled out of sight
    requestAnimationFrame(() =>
      strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
    )
  }, [route, navigate])

  // a vertical wheel over the strip scrolls it sideways (non-passive, so the page does not scroll as well)
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const close = (path: string) => {
    const { tabs: rest, next } = closeTab(tabList.get(), path, activePath)
    tabList.set(rest)
    saveTabs()
    if (next) navigate(next)
    else if (!rest.length) saveActive("")
  }
  const onAux = (e: MouseEvent, path: string) => {
    if (e.button !== 1) return
    e.preventDefault()
    close(path)
  }

  return (
    <div ref={strip} className={stripCls} role="tablist" aria-label="Open pages">
      {list.map(t => {
        const on = t.path === activePath
        return (
          <div
            key={t.path}
            className={cx(tabCls, on ? tabActive : tabIdle)}
            role="tab"
            aria-selected={on}
            title={t.title}
            data-tab={t.path}
            onMouseDown={e => e.button === 1 && e.preventDefault()}
            onAuxClick={e => onAux(e, t.path)}
          >
            <button type="button" className={openCls} tabIndex={on ? 0 : -1} onClick={() => navigate(t.route)}>
              {t.icon && <Icon name={t.icon} />}
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t.title}</span>
            </button>
            <button
              type="button"
              className={cx(closeCls, on && "opacity-100")}
              aria-label={`Close ${t.title}`}
              title="Close"
              onClick={e => {
                e.stopPropagation()
                close(t.path)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
