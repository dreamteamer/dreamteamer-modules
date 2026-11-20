/**
 * INFO — a small facts panel beside the record (ported from the Vue ui's sidebar/InfoSection.vue, with the
 * facts ui's first record page drew): the collection and id, the engine's record-surface facts (`created`,
 * `last_modified`, …), who created and last changed it and the last commit, where it is read from when that is
 * not this workspace (the source mark), the duplicate id when two roots hold it, the attachments a folder-shape
 * record carries, and the file.
 */
import type { FieldRow, SourceEntry } from "../api/types.ts"
import { SourceMark } from "../components/SourceMark.tsx"
import { formatFilesize } from "../lib/formatFilesize.ts"
import { SOURCE_FIELD, SOURCE_KIND_FIELD, isOwnSource } from "../lib/sources.ts"
import { RenderView } from "../render/Render.tsx"
import { mono, subtle } from "../styles/classes.ts"
import { computed } from "./looks.ts"

const META: [string, string][] = [
  ["$created-by", "Created by"],
  ["$last-modified-by", "Last changed by"],
  ["$last-commit-message", "Last commit"],
]

/** A record's value for a field, whichever spelling the host used (`last_modified` / `last-modified`). */
const valueOf = (record: Record<string, unknown>, name: string) => record[name] ?? record[name.replace(/_/g, "-")]

export function RecordInfo({
  collection,
  id,
  record,
  facts,
  sources,
  path,
}: {
  collection: string
  id: string
  record: Record<string, unknown>
  /** The fields the record surface draws and the form leaves out (`lib/schema.ts#recordFacts`). */
  facts: FieldRow[]
  sources?: SourceEntry[]
  path?: string
}) {
  const sourceName = record[SOURCE_FIELD]
  const foreign = typeof sourceName === "string" && sourceName && !isOwnSource(sourceName, sources) ? sourceName : null
  const entry = foreign ? sources?.find(s => s.name === foreign) : undefined
  const kind = typeof record[SOURCE_KIND_FIELD] === "string" ? (record[SOURCE_KIND_FIELD] as string) : ""
  const attachments = (Array.isArray(record["attachments"]) ? record["attachments"] : []).filter(
    (a): a is { name: string; size?: number } =>
      a !== null && typeof a === "object" && typeof (a as { name?: unknown }).name === "string"
  )
  return (
    <dl
      className="m-0 grid gap-2.5 [&_dt]:text-small [&_dt]:uppercase [&_dt]:tracking-[0.04em] [&_dt]:text-fg-subtle [&_dd]:mt-0.5 [&_dd]:mx-0 [&_dd]:mb-0 [&_dd]:[overflow-wrap:anywhere]"
      data-info
    >
      <div>
        <dt>Collection</dt>
        <dd title={collection}>{collection}</dd>
      </div>
      <div>
        <dt>Id</dt>
        <dd title={id} className={mono}>
          {id}
        </dd>
      </div>
      {facts
        .filter(f => f.field !== "id")
        .map(f => (
          <div key={f.field}>
            <dt title={f.description}>{f.title}</dt>
            <dd>
              <RenderView field={f} value={valueOf(record, f.field)} context="record" record={record} />
            </dd>
          </div>
        ))}
      {META.filter(([k]) => record[k]).map(([k, label]) => (
        <div key={k}>
          <dt>{label}</dt>
          <dd>{String(record[k])}</dd>
        </div>
      ))}
      {foreign && (
        <div data-field="source">
          <dt>Source</dt>
          <dd className={computed} title={`read from ${foreign}${kind ? ` (${kind})` : ""}`}>
            <SourceMark name={foreign} access={entry?.access} via={entry?.via} note={entry?.note} />
          </dd>
        </div>
      )}
      {attachments.length > 0 && (
        <div>
          <dt>Attachments</dt>
          <dd>
            <ul className="m-0 p-0 list-none">
              {attachments.map(a => (
                <li key={a.name}>
                  <span title={a.name}>{a.name}</span>{" "}
                  {typeof a.size === "number" && <span className={subtle}>{formatFilesize(a.size)}</span>}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      {path && (
        <div>
          <dt>File</dt>
          <dd className={mono}>{path}</dd>
        </div>
      )}
    </dl>
  )
}
