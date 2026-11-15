/**
 * `source` — the `$source` column's mark: drawn for a record read from a layer or a module, NOTHING for one from
 * the workspace's own root (mark only the exception, so a mixed table's own rows stay plain). Which name is the
 * workspace's own, the sources and their writability ride on the field row's `viewer_options`
 * (`lib/sources.ts#sourceFieldRow`). A row that shadows a stub, or IS one, says so beside its mark.
 */
import type { SourceEntry } from "../api/types.ts"
import { SourceMark, StubNote } from "../components/SourceMark.tsx"
import { stubNoteOf } from "../lib/sources.ts"
import type { ViewProps } from "../registry/props.ts"

export function ViewSource({ value, options, context, record }: ViewProps) {
  const name = typeof value === "string" ? value : ""
  const own = typeof options?.["own"] === "string" ? options["own"] : null
  const sources = Array.isArray(options?.["sources"]) ? (options["sources"] as SourceEntry[]) : []
  const entry = sources.find(s => s.name === name)
  const foreign = !!name && name !== own
  const stub = stubNoteOf(record)
  if (!foreign && !stub) return <span className="ui2-source-own" aria-hidden="true" />
  return (
    <span className="ui2-source-cell">
      {foreign && (
        <SourceMark
          name={name}
          record={entry?.record ?? null}
          context={context}
          access={entry?.access}
          via={entry?.via}
          note={entry?.note}
        />
      )}
      {stub && <StubNote stubs={stub.stubs} self={stub.self} winner={stub.winner} sources={sources} />}
    </span>
  )
}
