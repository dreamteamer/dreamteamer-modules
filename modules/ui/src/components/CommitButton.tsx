/**
 * THE COMMIT GESTURE — the app's half of `dt commit` (ported from the Vue ui's CommitButton.vue). Record
 * writes no longer commit themselves, so a session's edits sit on disk until something publishes them; this is
 * that something.
 *
 * It owns no count: `POST /commit {dryRun: true}` IS the pending count, sampled again on every navigation and
 * every invalidation, so a record committed from a terminal simply stops being counted. Hidden at zero — which
 * also covers a workspace still committing on write and a host without the route — and below admin, where the
 * route is refused.
 *
 * Where an edit commits is said HERE: the button reads *Commit to <repo>* (the workspace's own name for `.`),
 * and when pending edits span several repos it is a menu, one row per repo with its count, each scoped with the
 * engine's `only`.
 */
import { useEffect, useState } from "react"
import { commit, type CommitPlan } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { usePopover } from "../browse/use-popover.ts"
import { hostInfo, isAdmin } from "../lib/host.ts"
import { commitRepoLabel, pendingByRepo } from "../lib/sources.ts"
import { Icon } from "./Icon.tsx"
import {
  button,
  buttonSize,
  buttonTone,
  cx,
  menu as menuCls,
  menuItem,
  menuLabel,
  popoverAnchor,
  subtle,
} from "../styles/classes.ts"

export function CommitButton({
  onCommitted,
  sample = 0,
}: {
  onCommitted?: () => void
  /** Moved by the caller after a write of its own, so the count is sampled again at once. */
  sample?: number
}) {
  const { route, version } = useApp()
  const host = useSignal(hostInfo)
  const [plan, setPlan] = useState<CommitPlan[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [sampled, setSampled] = useState(0)
  const menu = usePopover()
  const may = isAdmin(host)

  useEffect(() => {
    if (!may) {
      setPlan([])
      return
    }
    let live = true
    commit({ dryRun: true }).then(
      data => live && setPlan(data ?? []),
      () => live && setPlan([])
    )
    return () => {
      live = false
    }
  }, [may, route, version, sampled, sample])

  const repos = pendingByRepo(plan)
  const pending = repos.reduce((n, r) => n + r.count, 0)
  const label = (repo: string) => commitRepoLabel(repo, host?.workspace?.name)

  const run = async (only?: string[]) => {
    if (busy) return
    setBusy(true)
    menu.setOpen(false)
    setNote("")
    try {
      const data = await commit(only ? { only } : {})
      // a repo can be blocked while another commits: per repo, the engine's own sentence
      setNote(
        (data ?? [])
          .map(r => r.blocked ?? r.warning ?? "")
          .filter(Boolean)
          .join(" · ")
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setSampled(n => n + 1)
      onCommitted?.()
    }
  }

  if (!pending && !note) return null
  const s = pending === 1 ? "" : "s"
  return (
    <div className={cx(popoverAnchor, "gap-2 items-center")} ref={menu.anchor} data-commit>
      {note && (
        <span className="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-fg-subtle" title={note}>
          {note}
        </span>
      )}
      {repos.length === 1 && (
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          disabled={busy}
          data-repo={repos[0]!.repo}
          title={`Commit ${pending} pending record change${s} to ${label(repos[0]!.repo)}`}
          onClick={() => void run()}
        >
          <Icon name="git-commit" /> Commit to {label(repos[0]!.repo)} · {pending}
        </button>
      )}
      {repos.length > 1 && (
        <>
          <button
            type="button"
            className={cx(button, buttonTone[menu.open ? "active" : "default"], buttonSize.default)}
            disabled={busy}
            title={`${pending} pending record change${s} across ${repos.length} repos`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={() => menu.setOpen(!menu.open)}
          >
            <Icon name="git-commit" /> Commit {pending} <Icon name="chevron-down" />
          </button>
          {menu.open && (
            <div className={menuCls} role="menu" aria-label="Commit to">
              {repos.map(r => (
                <button
                  key={r.repo}
                  type="button"
                  className={menuItem}
                  role="menuitem"
                  data-repo={r.repo}
                  onClick={() => void run(r.only)}
                >
                  <span className={menuLabel}>Commit to {label(r.repo)}</span>
                  <span className={subtle}>{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
