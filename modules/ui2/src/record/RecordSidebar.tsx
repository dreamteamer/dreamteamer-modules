/**
 * THE RECORD PAGE'S SIDE PANEL — Commands, Info and Revisions as tabs (ported from the Vue ui's
 * RightSidebar.vue, which the record page fills with CommandsSection, InfoSection and ItemHistory). Non-modal: nothing
 * is trapped. Collapsed it is a slim rail of icons (one per tab, a click opens on that tab); the open state and the
 * tab survive navigation — it is a working surface, not a dialog.
 *
 * SLIDE-OVER, in the browser shell only (lib/appShell.ts): the rail stays in the row, and the open panel is laid OVER
 * the sheet's right edge instead of taking a column, so opening it never changes the page's width (a table keeps its
 * columns). Still non-modal — no overlay, no focus trap — because the Commands tab reads the table's ticks while it is
 * open. Escape closes it, unless a menu or a dialog is open and the Escape is theirs. It opens below the tab strip
 * (`--dt-rsb-top`, set by the shell). In an editor it is the inline column it always was.
 */
import { useEffect, type ReactNode } from "react"
import { useSignal } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { appShell } from "../lib/appShell.ts"
import { signal } from "../lib/signal.ts"
import { cx, iconButton } from "../styles/classes.ts"

// the panel: a fixed-width column beside the body; under 900px it drops below the body, full width
const panel =
  "flex flex-col min-h-0 bg-bg-subtle border-l border-border max-[900px]:basis-auto max-[900px]:border-l-0 max-[900px]:border-t"
const panelOpen = "flex-[0_0_320px]"
// collapsed: a slim rail of icons (a row under 900px)
const panelRail = "flex-[0_0_36px] items-center pt-1.5 gap-1 max-[900px]:flex-row max-[900px]:p-1"
// the slide-over's aside: a 36px rail on the canvas — no ground, no line
const overRail = "flex flex-col flex-[0_0_36px] items-center pt-1.5 gap-1 min-h-0 bg-transparent"
const overRailButton = "hover:bg-ink-3"
const overRailActive = "bg-accent-tint text-accent hover:bg-accent-tint"
// the slide-over's panel: fixed over the sheet's right edge, below the shell's top inset (or the tab strip)
const overPanel =
  "fixed z-40 top-(--dt-rsb-top,8px) right-9 bottom-0 w-[min(380px,calc(100vw-72px))] flex flex-col min-h-0 bg-surface rounded-tl-xl shadow-panel overflow-hidden [transition:transform_var(--dt-dur-med)_var(--dt-ease),opacity_var(--dt-dur-med)_var(--dt-ease)] starting:translate-x-4 starting:opacity-0"
const head = "flex items-center gap-1 pr-1.5 border-b border-border"
const tab = "py-2 px-2.5 border-x-0 border-t-0 border-b-2 bg-transparent cursor-pointer"
const tabIdle = "text-fg-subtle border-b-transparent"
const tabActive = "text-fg border-b-accent"
const body = "flex-[1_1_auto] min-h-0 overflow-auto px-3.5 py-3"

export interface SidebarTab {
  id: string
  title: string
  icon: string
  body: ReactNode
}

const open = signal(true)
const active = signal("commands")

export function RecordSidebar({ tabs }: { tabs: SidebarTab[] }) {
  const isOpen = useSignal(open)
  const activeId = useSignal(active)
  const current = tabs.find(t => t.id === activeId) ?? tabs[0]

  useEffect(() => {
    if (!appShell || !isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
      open.set(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen])

  if (!tabs.length) return null

  const panelBody = (
    <>
      <header className={head}>
        <nav className="flex flex-1" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === current?.id}
              className={cx(tab, t.id === current?.id ? tabActive : tabIdle)}
              onClick={() => active.set(t.id)}
            >
              {t.title}
            </button>
          ))}
        </nav>
        <button type="button" className={iconButton} title="Collapse panel" onClick={() => open.set(false)}>
          <Icon name="chevron-right" />
        </button>
      </header>
      <div className={body} role="tabpanel">
        {current?.body}
      </div>
    </>
  )

  if (appShell)
    return (
      <aside className={overRail} aria-label="Record panel">
        {tabs.map(t => {
          const on = isOpen && t.id === current?.id
          return (
            <button
              key={t.id}
              type="button"
              className={cx(iconButton, on ? overRailActive : overRailButton)}
              aria-pressed={on}
              title={`${t.title} — click to ${on ? "close" : "expand"}`}
              onClick={() => {
                if (on) return open.set(false)
                active.set(t.id)
                open.set(true)
              }}
            >
              <Icon name={t.icon} />
            </button>
          )
        })}
        {isOpen && (
          <div className={overPanel} role="complementary" aria-label="Page panel">
            {panelBody}
          </div>
        )}
      </aside>
    )

  if (!isOpen)
    return (
      <aside className={cx(panel, panelRail)} aria-label="Record panel">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className={iconButton}
            title={`${t.title} — click to expand`}
            onClick={() => {
              active.set(t.id)
              open.set(true)
            }}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </aside>
    )
  return (
    <aside className={cx(panel, panelOpen)} aria-label="Record panel">
      {panelBody}
    </aside>
  )
}
