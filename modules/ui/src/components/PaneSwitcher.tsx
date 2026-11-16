/**
 * THE WORKSPACE SWITCHER (cr-modules-017 §7; the 2026-11-14 16:30 revision moved it into the nav's toolbar), ported
 * from the Vue ui's PaneSwitcher.vue. On a pane host the toolbar's name is this button; its menu lists the
 * workspaces `dt web open` registered on this machine (`GET /_dt/workspaces`), and a pick asks this server to hand
 * the whole pane to that workspace's server (`POST /_dt/handoff`), then goes to the URL it answers. Its last entry,
 * Settings, opens the workspace settings (the name's click off a pane host). A refusal shows inside the menu.
 */
import { useState } from "react"
import { createPortal } from "react-dom"
import { useApp, useSignal } from "../app-context.tsx"
import { hostInfo } from "../lib/host.ts"
import { paneFetch } from "../lib/pane-api.ts"
import { usePaneMenu } from "./use-pane-menu.ts"
import { cx } from "../styles/classes.ts"
import { paneMenu, paneMenuError, paneMenuQuiet } from "./looks.ts"

interface WorkspaceRow {
  id: string
  name: string
  running: boolean
  current: boolean
}

/** A quiet line under the workspaces. (was dt-pane-menu-hint) */
const PANE_HINT = "px-2 py-1 border-t border-border"

/** The workspace settings — the toolbar name's click off a pane host. */
export const SETTINGS_ROUTE = "/settings/schema/activity"

/** `label` is the nav's workspace label — drawn only when the host names no workspace: the host's name is the one
 *  the switcher's own list (and `dt web list`) shows, which a folder-named nav label need not be. */
export function PaneSwitcher({ label }: { label?: string }) {
  const { navigate } = useApp()
  const host = useSignal(hostInfo)
  const name = host?.workspace?.name || label || ""
  const m = usePaneMenu("switch", "start")
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  // the list always holds the current workspace once `dt web open` registered it: the line says there is no other
  const others = workspaces.some(w => !w.current)

  const toggle = async () => {
    if (!m.toggle()) return
    setError(null)
    setWorkspaces([])
    setLoading(true)
    try {
      const rows = await paneFetch("GET", "/_dt/workspaces")
      setWorkspaces(Array.isArray(rows) ? (rows as WorkspaceRow[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    m.keys.opened()
  }

  const pick = async (w: WorkspaceRow) => {
    if (w.current || busy) {
      m.keys.done()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const answer = (await paneFetch("POST", "/_dt/handoff", { id: w.id })) as { url?: unknown } | null
      if (typeof answer?.url === "string") {
        m.close()
        window.location.href = answer.url
      } else m.keys.done()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={m.button}
        type="button"
        className="inline-flex items-center gap-0.5 flex-[0_1_auto] min-w-[30px] max-w-full h-6 px-1 py-0 border-0 rounded-dt bg-transparent text-fg font-[inherit] text-[length:inherit] leading-[inherit] font-semibold hover:bg-bg-hover aria-expanded:bg-bg-hover"
        title={`${name} — switch workspace`}
        data-pane-switch
        aria-haspopup="menu"
        aria-expanded={m.open}
        onClick={e => {
          e.stopPropagation()
          void toggle()
        }}
      >
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
        <i className="codicon codicon-chevron-down flex-none text-[12px]! text-fg-subtle" aria-hidden="true" />
      </button>
      {m.open &&
        createPortal(
          <div
            ref={m.menu}
            className={paneMenu}
            role="menu"
            tabIndex={-1}
            style={{ left: m.at.x, top: m.at.y }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => m.keys.keydown(e)}
            onFocus={e => m.keys.focusin(e)}
          >
            {error && (
              <p className={paneMenuError} role="alert">
                {error}
              </p>
            )}
            {workspaces.map(w => (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                data-id={w.id}
                aria-checked={w.current}
                onClick={() => void pick(w)}
              >
                {w.name} {!w.current && !w.running && <span className={paneMenuQuiet}>starts when opened</span>}
              </button>
            ))}
            {loading ? (
              <p className={cx(paneMenuQuiet, PANE_HINT)} role="status">
                Loading…
              </p>
            ) : (
              !others &&
              !error && <p className={cx(paneMenuQuiet, PANE_HINT)}>No other workspace was opened on this machine</p>
            )}
            <button
              type="button"
              role="menuitem"
              className="border-t! border-border mt-0.5 pt-1.5! rounded-none!"
              onClick={() => {
                m.close()
                navigate(SETTINGS_ROUTE)
              }}
            >
              Settings
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
