/**
 * THE ACTIVITY PAGE — the Schema tab's first row and where the workspace row in the nav lands (ported from
 * @dreamteamer/ui's pages/ActivityPane.vue): git history as named entries, newest first, grouped by day — who, when,
 * the message, and the records it touched, named by their titles and linked (`GET /activity`). Unnarrowed, every
 * module's history merged, each entry marked with its repo's source mark; narrowed to a module (`?module=`), that
 * module's; `?source=` scopes it to one record layer. An npm-installed module has no history here, and says so.
 *
 * A commit opens the way Source Control opens one, through the host (`dt:command dreamteamer.viewCommit`) — a
 * browser host that knows no such command ignores it. Paged 20 at a time; the host says whether an older page
 * exists. The page does not wait for the slowest repo: the host answers with the repos that are in, names the
 * rest `pending`, and the page asks again with what it has (`settled`) until none is.
 *
 * A module's PAGE view (`lib/page-view.ts#modulePageView`) is drawn instead of this page when one names the module
 * (SchemaTab); a page view's `activity` panel draws this one `embedded` — no heading, the panel has the title.
 */
import { useEffect, useRef, useState } from "react"
import { getActivity, notify } from "../api/client.ts"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import { byDay, entryRest, type Activity, type ActivityEntry } from "../lib/activity.ts"
import { recordRoute } from "../lib/route.ts"

const PAGE = 20
const SHOWN = 8
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ActivityPane({
  module,
  moduleTitle,
  source,
  embedded = false,
}: {
  module?: string
  moduleTitle?: string
  source?: string | undefined
  /** Drawn inside a page view's panel, which carries the title: no heading, no page padding. */
  embedded?: boolean
}) {
  const [page, setPage] = useState(0)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    let live = true
    setLoading(true)
    setError(null)
    // one page; then, for the repos still pending, the same page again with what has settled
    const ask = async (settled?: number) => {
      try {
        const answer = await getActivity({ module, source, limit: PAGE, offset: page * PAGE, settled })
        if (!live || mine !== seq.current) return
        setActivity(answer)
        setLoading(false)
        if (answer.pending?.length) void ask(answer.settled)
      } catch (err) {
        if (!live || mine !== seq.current) return
        setError(message(err))
        setLoading(false)
      }
    }
    void ask()
    return () => {
      live = false
    }
  }, [module, source, page])

  const open = (e: ActivityEntry) =>
    notify("dt:command", { command: "dreamteamer.viewCommit", arg: { repo: e.repo, sha: e.sha } })
  const noHistory = activity !== null && activity.scopes.length === 0
  const pending = activity?.pending ?? []
  const failed = activity?.failed ?? []

  let body
  if (error) body = <p className="ui2-error">{error}</p>
  else if (!activity) body = <p className="ui2-subtle">Loading…</p>
  else if (noHistory && source) body = <p className="ui2-subtle">Nothing of this module's is kept in {source}.</p>
  else if (noHistory)
    body = <p className="ui2-subtle">This module is installed from npm — it has no git history here.</p>
  else if (!activity.entries.length && !pending.length) body = <p className="ui2-subtle">No commits yet.</p>
  else
    body = byDay(activity.entries, dayOf).map(group => (
      <section key={group.day} className="ui2-activity-day">
        <h2 className="ui2-section-label">{group.day}</h2>
        {group.entries.map(e => {
          const rest = entryRest(e, SHOWN)
          const title = `Open commit ${e.sha.slice(0, 7)} in Source Control`
          return (
            <article key={`${e.repo} ${e.sha}`} className="ui2-activity-entry" data-sha={e.sha}>
              <div className="ui2-activity-line">
                <Icon name="git-commit" className="ui2-subtle" />
                <span className="ui2-activity-author">{e.author}</span>
                <button type="button" className="ui2-activity-subject" title={title} onClick={() => open(e)}>
                  {e.subject}
                </button>
                {!module && <SourceMark name={e.source} />}
                <button type="button" className="ui2-link-button ui2-mono" title={title} onClick={() => open(e)}>
                  {e.sha.slice(0, 7)}
                </button>
                <span className="ui2-subtle" title={e.date}>
                  {timeOf(e.date)}
                </span>
              </div>
              {(e.records.length > 0 || e.files > 0) && (
                <div className="ui2-activity-records">
                  {e.records.slice(0, SHOWN).map(r => (
                    <Link key={`${r.collection}/${r.id}`} to={recordRoute(r.collection, r.id)} className="ui2-chip">
                      <span className="ui2-subtle">{r.collection}</span> {r.title ?? r.id}
                    </Link>
                  ))}
                  {rest.more > 0 && <span className="ui2-subtle">+{rest.more} more</span>}
                  {rest.other > 0 && (
                    <span className="ui2-subtle">
                      {rest.other} other file{rest.other === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </section>
    ))

  return (
    <section className={embedded ? "ui2-activity is-embedded" : "ui2-page ui2-activity"}>
      {!embedded && (
        <header className="ui2-page-head">
          <div>
            <h1>Activity</h1>
            <p className="ui2-subtle">
              {module
                ? `Commits to ${moduleTitle ?? module}, newest first.`
                : "Commits across every module, newest first."}
            </p>
          </div>
        </header>
      )}
      {pending.length > 0 && <p className="ui2-subtle">Still reading {pending.join(", ")}…</p>}
      {failed.length > 0 && <p className="ui2-error">Could not read {failed.join(", ")} — git took too long.</p>}
      {body}
      {activity && activity.entries.length > 0 && (page > 0 || activity.hasMore) && (
        <footer className="ui2-pager">
          <span className="ui2-subtle">
            {page * PAGE + 1}–{page * PAGE + activity.entries.length}
          </span>
          <button
            type="button"
            className="ui2-button is-icon is-small"
            title="Newer"
            disabled={page === 0 || loading}
            onClick={() => setPage(p => p - 1)}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="ui2-button is-icon is-small"
            title="Older"
            disabled={!activity.hasMore || loading}
            onClick={() => setPage(p => p + 1)}
          >
            <Icon name="chevron-right" />
          </button>
        </footer>
      )}
    </section>
  )
}
