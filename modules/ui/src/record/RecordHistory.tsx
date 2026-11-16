/**
 * REVISIONS — one record's git history (ported from the Vue ui's ItemHistory.vue): `GET /history/:c/*id`,
 * one row per commit (subject, author, when, short hash). `diff` fetches that commit's diff of the record's file
 * against its parent (`GET /history-diff`) and colours it per line (`lib/diff-lines.ts`). `restore` asks, then
 * `POST /collections/:c/records-revert/*id {hash}`: the server restores the record's CONTENT as of that commit,
 * validated against today's schema, as a pending write (`dt revert`) — and a refusal is shown in the dialog, verbatim.
 *
 * Restore is DISABLED on a compiled collection, with the engine's reason as its tooltip
 * (`lib/readonly-source.ts`): there is no record revision to restore, and a refusal after the click is worse
 * than a control that says why first. Restore is an admin route, so a pane below admin does not offer it.
 */
import { useState } from "react"
import { getHistory, getHistoryDiff, revertRecord, type HistoryEntry } from "../api/client.ts"
import { useApp, useAsync, useSignal } from "../app-context.tsx"
import { Dialog } from "../components/Dialog.tsx"
import { classifyDiffLines, type ClassifiedDiffLine } from "../lib/diff-lines.ts"
import { hostInfo, isAdmin } from "../lib/host.ts"
import { revertRefused, revertRefusedSentence } from "../lib/readonly-source.ts"
import { relativeTime } from "../lib/relative-time.ts"

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
    <section className="dt-history" data-history>
      {history.loading && !history.data && <p className="dt-subtle">Loading…</p>}
      {history.error && <p className="dt-error">{history.error}</p>}
      {!history.loading && !history.error && entries.length === 0 && <p className="dt-subtle">No history yet.</p>}
      <ul className="dt-history-list">
        {entries.map(entry => {
          const diff = diffs[entry.hash]
          return (
            <li key={entry.hash} className="dt-history-entry" data-hash={entry.hash}>
              <div className="dt-history-subject" title={entry.subject}>
                {entry.subject || "(no message)"}
              </div>
              <div className="dt-history-meta">
                <span>{entry.author}</span>
                <span title={entry.date}>{when(entry.date)}</span>
                <code>{entry.hash.slice(0, 7)}</code>
                <button type="button" className="dt-link-button dt-link" onClick={() => toggleDiff(entry)}>
                  {diff?.open ? "hide diff" : "diff"}
                </button>
                {mayRestore && (
                  <button
                    type="button"
                    className="dt-link-button dt-link"
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
                <div className="dt-diff">
                  {diff.loading && <p className="dt-subtle">Loading diff…</p>}
                  {diff.error && <p className="dt-error">{diff.error}</p>}
                  {diff.lines && diff.lines.length === 0 && <p className="dt-subtle">No changes.</p>}
                  {diff.lines && diff.lines.length > 0 && (
                    <pre className="dt-diff-pre">
                      {diff.lines.map((line, i) => (
                        <span key={i} className={`dt-diff-line is-${line.kind}`}>
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
          <p className="dt-subtle">
            This writes the record&rsquo;s content as of <code>{asking.hash.slice(0, 7)}</code> back as a pending change
            — commit it to publish. Unsaved edits on the page aren&rsquo;t affected.
          </p>
          {revertError && <p className="dt-error">{revertError}</p>}
          <div className="dt-dialog-actions">
            <button type="button" className="dt-button" onClick={() => setAsking(null)}>
              Cancel
            </button>
            <button type="button" className="dt-button is-danger" disabled={reverting} onClick={() => void restore()}>
              {reverting ? "Restoring…" : "Restore"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
