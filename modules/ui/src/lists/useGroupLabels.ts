/**
 * A band's NAME, PICTURE and SUMMARY when its value is a reference — the fetching half of the Vue ui's
 * lib/groupLabel.ts `useGroupLabels`, as a hook (the pure half is lib/groupLabel.ts). The gantt asks it for
 * every band value; it reads each referenced record through the shared record cache and renders the band's
 * templates against it. A value missing from a map means "no better answer than the fallback".
 *
 * Keyed on the app's `version`: an invalidation re-asks every band (the cache drops its records on a new
 * version), and the old answers stay drawn until the new ones land. An answer from an older version or for a
 * value set that has since changed is dropped.
 */
import { useEffect, useState } from "react"
import type { FieldRow } from "../api/types.ts"
import { useApp } from "../AppContext.tsx"
import { bandTitleTemplate, iconOf, idFor } from "../lib/groupLabel.ts"
import { UNGROUPED } from "../lib/grouping.ts"
import { fetchRecord } from "../lib/recordCache.ts"
import { tryRenderDisplay } from "../lib/template.ts"

export interface GroupLabels {
  labels: Record<string, string>
  icons: Record<string, string>
  summaries: Record<string, string>
}

const NONE: GroupLabels = { labels: {}, icons: {}, summaries: {} }
const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

export function useGroupLabels(source: {
  values: readonly string[]
  field: FieldRow | null
  /** The view's own `group_title`. */
  template: string | null
  /** The view's `group_summary`, rendered against the same record — one line beside the name. */
  summaryTemplate: string | null
  /** The view's `group_icon`: a field on the TARGET record; blank probes avatar, icon, image. */
  iconField: string | null
}): GroupLabels {
  const { schema, version } = useApp()
  const [out, setOut] = useState<GroupLabels>(NONE)
  const { field, template, summaryTemplate, iconField } = source
  const target = field ? (schema.target(field)?.collection ?? null) : null
  const values = source.values.filter(v => v && v !== UNGROUPED)
  const key = values.join("\n")

  useEffect(() => {
    if (!target || !values.length) return
    let live = true
    const titleTemplate = bandTitleTemplate(template, schema.collection(target))
    void Promise.all(
      values.map(v => fetchRecord(target, idFor(v, target), version).then(rec => [v, rec] as const))
    ).then(answers => {
      if (!live) return
      const next: GroupLabels = { labels: {}, icons: {}, summaries: {} }
      for (const [value, rec] of answers) {
        // a dangling reference keeps its de-slugged name
        if (!rec) continue
        const record = { id: rec.id, ...rec.fields }
        const label = titleTemplate ? oneLine(tryRenderDisplay(titleTemplate, record)) : ""
        if (label) next.labels[value] = label
        const icon = iconOf(record, iconField)
        if (icon) next.icons[value] = icon
        const summary = summaryTemplate ? oneLine(tryRenderDisplay(summaryTemplate, record)) : ""
        if (summary) next.summaries[value] = summary
      }
      setOut(next)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [target, key, template, summaryTemplate, iconField, schema, version])

  return target ? out : NONE
}
