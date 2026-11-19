/**
 * THE COLLECTION DESIGNER as a record-scoped layout (ported from the Vue ui's DataModelRecord.vue): a record of
 * `collections` IS a descriptor, so the designer is how one is drawn — registered as `data-model` on both
 * registries with `scope: "record"`, picked by `display.record.layout: data-model` on `collections` or a
 * record-scope view of it. It only translates the contract: the record's name (its id) is the collection.
 */
import type { RecordLayoutProps } from "../registry/props.ts"
import { DataModelDetail } from "../settings/DataModelDetail.tsx"
import { subtle } from "../styles/classes.ts"

export function DataModelRecord({ record }: RecordLayoutProps) {
  const name = String(record?.["name"] ?? record?.["id"] ?? "").trim()
  if (!name)
    return (
      <p className={subtle}>
        no collection on this record — the designer draws records of <code>collections</code>
      </p>
    )
  return <DataModelDetail collection={name} embedded />
}
