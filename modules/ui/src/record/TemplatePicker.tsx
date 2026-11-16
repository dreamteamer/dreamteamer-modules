/**
 * "START FROM EXISTING…" — the create form's templates (ported from the Vue ui's TemplatePicker.vue). The
 * engine has no template files, so a template is any existing record of the collection: a quiet button reveals
 * a picker of its first 25 records, and the chosen one's values go through `prefillFromRecord` (exactly the
 * fields the create form offers a control for) and the form's own write path, as if typed. One-shot: the picker
 * closes once a record is picked. Nothing is drawn for a collection with no records.
 */
import { useState } from "react"
import { listRecords } from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Select } from "../components/Select.tsx"
import { recordLabel } from "../lib/schema.ts"
import { prefillFromRecord } from "../lib/template-prefill.ts"
import { button, buttonSmall, cx } from "../styles/classes.ts"

export function TemplatePicker({
  collection,
  fields,
  onPick,
}: {
  collection: string
  fields: FieldRow[]
  onPick: (values: Record<string, unknown>) => void
}) {
  const { schema } = useApp()
  const page = useAsync(() => listRecords(collection, { limit: 25 }), [collection])
  const [open, setOpen] = useState(false)
  const records = page.data?.records ?? []
  if (!records.length) return null
  const row = schema.collection(collection)
  const pick = (id: unknown) => {
    setOpen(false)
    const record = records.find(r => r.id === id)
    if (record) onPick(prefillFromRecord(record, fields))
  }
  return (
    <div data-template-picker>
      {!open ? (
        <button type="button" className={cx(button, buttonSmall)} onClick={() => setOpen(true)}>
          <Icon name="copy" /> Start from existing…
        </button>
      ) : (
        <Select
          value=""
          choices={records.map(r => ({ text: recordLabel(row, r, r.id), value: r.id }))}
          placeholder="Choose a record to duplicate…"
          onChange={pick}
        />
      )}
    </div>
  )
}
