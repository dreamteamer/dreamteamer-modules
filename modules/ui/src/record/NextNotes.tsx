/**
 * WHAT EXTENSIONS SAY ABOUT THIS RECORD (cr-vscode-005; ported from the Vue ui's NextNotes.vue +
 * NoteText.vue) — under the record header, one line per note `GET /notes/<collection>?ids=<id>` answers: the
 * glyph, the sentence with each reference this workspace holds linked to its record, and the extension's name.
 * Core's lines are a session holding the record ("in session by …"). Where the host read sessions from is said
 * always, note or not; no note and no sessions collection draws nothing. A failed read draws nothing either —
 * a note is context, never the page.
 */
import { getNotes } from "../api/client.ts"
import { useApp, useAsync } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { textParts, type NextNote } from "../lib/nextNotes.ts"
import { subtle } from "../styles/classes.ts"

function NoteText({ note }: { note: NextNote }) {
  const parts = note.error ? [{ text: `${note.by}: ${note.text}` }] : textParts(note)
  return (
    <span>
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
    <div
      className="grid gap-0.5 pt-1 px-6 pb-1.5 text-[12px] [&_p]:m-0 [&_p]:flex [&_p]:items-baseline [&_p]:gap-1.5"
      aria-label="Notes from extensions"
    >
      {notes.map((n, i) => (
        <p key={i} className={n.error ? "[&_.codicon]:text-chart-orange" : "[&_.codicon]:text-chart-blue"}>
          <Icon name={n.error ? "warning" : "broadcast"} />
          <NoteText note={n} />
          {!n.error && <span className={subtle}>{n.by}</span>}
        </p>
      ))}
      {from && (
        <p className={subtle} data-sessions-from>
          {"roots" in from
            ? `Sessions read from: ${from.roots.join(", ")}`
            : `Sessions not read on this machine: ${from.unavailable}`}
        </p>
      )}
    </div>
  )
}
