/**
 * THE RECORD PAGE'S SIDE PANEL — Commands, Info and Revisions as tabs (ported from the Vue ui's
 * RightSidebar.vue, which the record page fills with CommandsSection, InfoSection and ItemHistory). Inline and
 * non-modal: the page narrows, nothing is trapped. Collapsed it is a slim rail of icons (one per tab, a click
 * opens on that tab); the open state and the tab survive navigation — it is a working surface, not a dialog.
 */
import type { ReactNode } from "react"
import { useSignal } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { signal } from "../lib/signal.ts"
import { cx, iconButton } from "../styles/classes.ts"

// the panel: a fixed-width column beside the body; under 900px it drops below the body, full width
const panel =
  "flex flex-col min-h-0 bg-bg-subtle border-l border-border max-[900px]:basis-auto max-[900px]:border-l-0 max-[900px]:border-t"
const panelOpen = "flex-[0_0_320px]"
// collapsed: a slim rail of icons (a row under 900px)
const panelRail = "flex-[0_0_36px] items-center pt-1.5 gap-1 max-[900px]:flex-row max-[900px]:p-1"
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
  if (!tabs.length) return null
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
    </aside>
  )
}
