/**
 * THE PANE'S LEVEL (cr-modules-017 §4; the 2026-11-14 16:30 revision made it an icon at the nav toolbar's right end),
 * ported from the Vue ui's PaneLevel.vue: `eye` Read, `edit` Edit, `shield` Admin (in the warning colour), the
 * tooltip naming the level and, while a raise holds, since when. Its menu LOWERS the level (`POST /_dt/level`) and
 * never raises it — the last line sends a person to the chat, where `dt web open --edit|--admin` is. A raise in force
 * is said at the menu's top; a refused lower shows inside the menu. Drawn only on a pane host.
 */
import { useState } from "react"
import { createPortal } from "react-dom"
import { request } from "../api/client.ts"
import { useSignal } from "../app-context.tsx"
import { hostInfo, loadHost } from "../lib/host.ts"
import { paneFetch } from "../lib/pane-api.ts"
import { levelWord, lowerChoices, raiseNotice, type PaneLevel as Level } from "../lib/pane-level.ts"
import { Icon } from "./Icon.tsx"
import { usePaneMenu } from "./use-pane-menu.ts"

const ICONS: Record<Level, string> = { read: "eye", edit: "edit", admin: "shield" }

export function PaneLevel() {
  const host = useSignal(hostInfo)
  const level: Level = host?.level ?? "read"
  const notice = host ? raiseNotice({ level, raisedAt: host.raisedAt }) : null
  const m = usePaneMenu("level", "end")
  const [error, setError] = useState<string | null>(null)

  const lower = async (to: Level) => {
    setError(null)
    try {
      await paneFetch("POST", "/_dt/level", { level: to })
      m.keys.done()
      await loadHost(request)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <button
        ref={m.button}
        type="button"
        className="dt-nav-tool dt-pane-level"
        data-level={level}
        title={`Level: ${levelWord(level)}${notice ? ` — ${notice}` : ""}`}
        aria-label={`Level: ${levelWord(level)}`}
        aria-haspopup="menu"
        aria-expanded={m.open}
        onClick={e => {
          e.stopPropagation()
          setError(null)
          if (m.toggle()) m.keys.opened()
        }}
      >
        <Icon name={ICONS[level]} />
      </button>
      {m.open &&
        // in the body, so no ancestor of the nav (its toolbar, its overflow) can clip or cover it
        createPortal(
          <div
            ref={m.menu}
            className="dt-pane-menu"
            role="menu"
            tabIndex={-1}
            style={{ left: m.at.x, top: m.at.y }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => m.keys.keydown(e)}
            onFocus={e => m.keys.focusin(e)}
          >
            {notice && <p className="dt-pane-menu-notice">{notice}</p>}
            {error && (
              <p className="dt-pane-menu-error" role="alert">
                {error}
              </p>
            )}
            {lowerChoices(level).map(l => (
              <button key={l} type="button" role="menuitem" data-level={l} onClick={() => void lower(l)}>
                {levelWord(l)}
              </button>
            ))}
            <p className="dt-pane-menu-hint">To raise it, ask in the chat</p>
          </div>,
          document.body
        )}
    </>
  )
}
