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
      <aside className="dt-rsb is-rail" aria-label="Record panel">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className="dt-icon-button"
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
    <aside className="dt-rsb" aria-label="Record panel">
      <header className="dt-rsb-head">
        <nav className="dt-rsb-tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === current?.id}
              className={`dt-rsb-tab${t.id === current?.id ? " is-active" : ""}`}
              onClick={() => active.set(t.id)}
            >
              {t.title}
            </button>
          ))}
        </nav>
        <button type="button" className="dt-icon-button" title="Collapse panel" onClick={() => open.set(false)}>
          <Icon name="chevron-right" />
        </button>
      </header>
      <div className="dt-rsb-body" role="tabpanel">
        {current?.body}
      </div>
    </aside>
  )
}
