/**
 * WHAT EXTENSIONS SAY ABOUT THIS RECORD (cr-vscode-005; ported from @dreamteamer/ui's NextNotes.vue +
 * NoteText.vue) — under the record header, one line per note `GET /notes/<collection>?ids=<id>` answers: the
 * glyph, the sentence with each reference this workspace holds linked to its record, and the extension's name.
 * Core's lines are a session holding the record ("in session by …"). Where the host read sessions from is said
 * always, note or not; no note and no sessions collection draws nothing. A failed read draws nothing either —
 * a note is context, never the page.
 */
import { getNotes } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { textParts, type NextNote } from "../lib/next-notes.ts"

function NoteText({ note }: { note: NextNote }) {
  const parts = note.error ? [{ text: `${note.by}: ${note.text}` }] : textParts(note)
  return (
    <span className="ui2-next-notes-text">
      {parts.map((p, i) =>
        "ref" in p && p.ref ? (
          <Link key={i} to={`/content/${p.ref}`}>
            {p.text}
          </Link>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

export function NextNotes({ collection, id }: { collection: string; id: string }) {
  const { version } = useApp()
  const answer = useAsync(() => getNotes(collection, [id]).catch(() => null), [collection, id, version])
  const notes = Array.isArray(answer.data?.notes) ? answer.data.notes : []
  const from = answer.data?.sessionsFrom ?? null
  if (!notes.length && !from) return null
  return (
    <div className="ui2-next-notes" aria-label="Notes from extensions">
      {notes.map((n, i) => (
        <p key={i} className={`ui2-next-notes-line${n.error ? " is-error" : ""}`}>
          <Icon name={n.error ? "warning" : "broadcast"} />
          <NoteText note={n} />
          {!n.error && <span className="ui2-subtle">{n.by}</span>}
        </p>
      ))}
      {from && (
        <p className="ui2-subtle" data-sessions-from>
          {"roots" in from
            ? `Sessions read from: ${from.roots.join(", ")}`
            : `Sessions not read on this machine: ${from.unavailable}`}
        </p>
      )}
    </div>
  )
}
