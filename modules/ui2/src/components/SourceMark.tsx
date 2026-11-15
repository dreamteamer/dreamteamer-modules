/**
 * THE SOURCE MARK — `● name`: a dot in a colour hashed from the name, and the name, always together; with
 * `access`, one trailing glyph saying whether a write lands there (a pencil or a lock). The ONE component every
 * surface draws a record's source with, so a layer is the same colour and word wherever it appears
 * (`lib/sources.ts`). When a `repos` record matches the root's remote, the name links to it in a `record`
 * context, and stays inert text in a cell, where the row is already the click target. Ported from
 * @dreamteamer/ui's SourceMark.vue, with StubNote.vue beside it.
 */
import type { SourceAccess, SourceEntry, SourceVia } from "../api/types.ts"
import { recordRoute } from "../lib/route.ts"
import { splitRef } from "../lib/schema.ts"
import {
  ACCESS_GLYPH,
  ALSO_STUB_WORDS,
  SELF_STUB_WORDS,
  markTitle,
  sourceColor,
  sourceEntry,
  yieldsWords,
} from "../lib/sources.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "./Icon.tsx"
import { Link } from "./Link.tsx"

export function SourceMark({
  name,
  record,
  context = "cell",
  access,
  via,
  note,
}: {
  name: string
  record?: string | null
  context?: "cell" | "record"
  access?: SourceAccess
  via?: SourceVia
  note?: string
}) {
  const { schema } = useApp()
  const at = context === "record" && record ? splitRef(record, schema.names) : null
  return (
    <span
      className="ui2-source-mark"
      title={markTitle(name, { via, access, note, record })}
      data-source={name}
      data-access={access}
    >
      <span className="ui2-source-dot" style={{ background: sourceColor(name) }} aria-hidden="true" />
      {at ? <Link to={recordRoute(at.collection, at.id)}>{name}</Link> : <span>{name}</span>}
      {access && <Icon name={ACCESS_GLYPH[access]} className="ui2-source-access" />}
    </span>
  )
}

/** Stubs, in the source vocabulary: the roots holding stubs the shown record shadows, or that it IS one. */
export function StubNote({
  stubs,
  self,
  winner,
  sources,
}: {
  stubs: string[]
  self?: boolean
  winner: string | null
  sources?: readonly SourceEntry[]
}) {
  return (
    <span className="ui2-stub-note" data-stub-note>
      {self && (
        <span
          className="ui2-stub-item ui2-subtle"
          title="This record is a stub (stub: true): any non-stub of its id, in any root, is read instead — none is read here"
        >
          {SELF_STUB_WORDS}
        </span>
      )}
      {stubs.map(name => {
        const entry = sourceEntry(sources, name)
        return (
          <span
            key={name}
            className="ui2-stub-item"
            data-stub-root={name}
            title={
              self
                ? `${name} also holds a stub of this id — this one, read first, shadows it`
                : `${name} holds a stub of this record (stub: true) — it yields to ${winner ?? "the copy shown"}`
            }
          >
            <SourceMark name={name} access={entry?.access} via={entry?.via} />
            <span className="ui2-subtle">{self ? ALSO_STUB_WORDS : yieldsWords(winner)}</span>
          </span>
        )
      })}
    </span>
  )
}
