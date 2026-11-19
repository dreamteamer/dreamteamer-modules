/**
 * REVISIONS — one record's git history (ported from the Vue ui's ItemHistory.vue): `GET /history/:c/*id`,
 * one row per commit (subject, author, when, short hash). `diff` fetches that commit's diff of the record's file
 * against its parent (`GET /history-diff`) and colours it per line (`lib/classifyDiffLines.ts`). `restore` asks, then
 * `POST /collections/:c/records-revert/*id {hash}`: the server restores the record's CONTENT as of that commit,
 * validated against today's schema, as a pending write (`dt revert`) — and a refusal is shown in the dialog, verbatim.
 *
 * Restore is DISABLED on a compiled collection, with the engine's reason as its tooltip
 * (`lib/readonlySource.ts`): there is no record revision to restore, and a refusal after the click is worse
 * than a control that says why first. Restore is an admin route, so a pane below admin does not offer it.
 */
import { useState } from "react"
import { getHistory, getHistoryDiff, revertRecord, type HistoryEntry } from "../api/client.ts"
import { useApp, useAsync, useSignal } from "../AppContext.tsx"
import { Dialog } from "../components/Dialog.tsx"
import { classifyDiffLines, type ClassifiedDiffLine } from "../lib/classifyDiffLines.ts"
import { hostInfo, isAdmin } from "../lib/host.ts"
import { revertRefused, revertRefusedSentence } from "../lib/readonlySource.ts"
import { relativeTime } from "../lib/relativeTime.ts"
import { button, buttonSize, buttonTone, cx, dialogActions, error, subtle } from "../styles/classes.ts"
import { linkAction } from "./looks.ts"

/** A diff line's colour by its kind: added green, removed red, the hunk headers quiet. */
const DIFF_LINE: Partial<Record<ClassifiedDiffLine["kind"], string>> = {
  add: "text-chart-green",
  remove: "text-danger",
  meta: "text-fg-subtle",
}

interface DiffState {
  open: boolean
  loading: boolean
  error: string | null
  lines: ClassifiedDiffLine[] | null
}

const when = (date: string) => {
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? date : relativeTime(d)
}

export function RecordHistory({
  collection,
  id,
  onReverted,
}: {
  collection: string
  id: string
  onReverted: () => void
}) {
  const { schema, version, editable } = useApp()
  const host = useSignal(hostInfo)
  const [reloads, setReloads] = useState(0)
  const history = useAsync(() => getHistory(collection, id), [collection, id, version, reloads])
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({})
  const [asking, setAsking] = useState<HistoryEntry | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)

  const row = schema.collection(collection)
  const refused = revertRefused(row)
  const mayRestore = editable && isAdmin(host)
  const restoreHint = revertRefusedSentence(collection, row) || "Restore this version"

  const toggleDiff = (entry: HistoryEntry) => {
    const was = diffs[entry.hash]
    if (was?.open || was?.lines) {
      setDiffs(d => ({ ...d, [entry.hash]: { ...d[entry.hash]!, open: !was.open } }))
      return
    }
    setDiffs(d => ({ ...d, [entry.hash]: { open: true, loading: true, error: null, lines: null } }))
    getHistoryDiff(collection, id, entry.hash).then(
      answer =>
        setDiffs(d => ({
          ...d,
          [entry.hash]: { open: true, loading: false, error: null, lines: classifyDiffLines(answer?.diff ?? "") },
        })),
      (err: unknown) =>
        setDiffs(d => ({
          ...d,
          [entry.hash]: {
            open: true,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            lines: null,
          },
        }))
    )
  }

  const restore = async () => {
    if (!asking) return
    setReverting(true)
    setRevertError(null)
    try {
      await revertRecord(collection, id, asking.hash)
      setAsking(null)
      setDiffs({}) // the worktree just changed under every open diff
      setReloads(n => n + 1)
      onReverted()
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err))
    } finally {
      setReverting(false)
    }
  }

  const entries = history.data ?? []
  return (
    <section data-history>
      {history.loading && !history.data && <p className={subtle}>Loading…</p>}
      {history.error && <p className={error}>{history.error}</p>}
      {!history.loading && !history.error && entries.length === 0 && <p className={subtle}>No history yet.</p>}
      <ul className="list-none m-0 p-0">
        {entries.map(entry => {
          const diff = diffs[entry.hash]
          return (
            <li key={entry.hash} className="py-2 px-0 border-b border-border last:border-b-0" data-hash={entry.hash}>
              <div className="overflow-hidden text-ellipsis whitespace-nowrap" title={entry.subject}>
                {entry.subject || "(no message)"}
              </div>
              <div className="flex flex-wrap items-baseline gap-2 text-small text-fg-subtle">
                <span>{entry.author}</span>
                <span title={entry.date}>{when(entry.date)}</span>
                <code>{entry.hash.slice(0, 7)}</code>
                <button type="button" className={linkAction} onClick={() => toggleDiff(entry)}>
                  {diff?.open ? "hide diff" : "diff"}
                </button>
                {mayRestore && (
                  <button
                    type="button"
                    className={linkAction}
                    disabled={refused}
                    title={restoreHint}
                    onClick={() => {
                      setRevertError(null)
                      setAsking(entry)
                    }}
                  >
                    restore
                  </button>
                )}
              </div>
              {diff?.open && (
                <div>
                  {diff.loading && <p className={subtle}>Loading diff…</p>}
                  {diff.error && <p className={error}>{diff.error}</p>}
                  {diff.lines && diff.lines.length === 0 && <p className={subtle}>No changes.</p>}
                  {diff.lines && diff.lines.length > 0 && (
                    <pre className="mt-1.5 mx-0 mb-0 p-1.5 max-h-80 overflow-auto rounded-dt bg-bg font-mono text-small leading-[1.5]">
                      {diff.lines.map((line, i) => (
                        <span key={i} className={DIFF_LINE[line.kind]}>
                          {line.text}
                          {"\n"}
                        </span>
                      ))}
                    </pre>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {asking && (
        <Dialog title="Restore this version?" onClose={() => setAsking(null)}>
          <p className={subtle}>
            This writes the record&rsquo;s content as of <code>{asking.hash.slice(0, 7)}</code> back as a pending change
            — commit it to publish. Unsaved edits on the page aren&rsquo;t affected.
          </p>
          {revertError && <p className={error}>{revertError}</p>}
          <div className={dialogActions}>
            <button
              type="button"
              className={cx(button, buttonTone.default, buttonSize.default)}
              onClick={() => setAsking(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cx(button, buttonTone.danger, buttonSize.default)}
              disabled={reverting}
              onClick={() => void restore()}
            >
              {reverting ? "Restoring…" : "Restore"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
