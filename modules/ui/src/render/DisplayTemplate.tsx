/**
 * A card's DISPLAY TEMPLATE, drawn: markdown whose `{{ field }}` tokens keep their own Views (ported from
 * the Vue ui's components/render/DisplayTemplate.vue). The compile — which token is a slot, what each slot's
 * text is, the line breaks a card keeps — is pure, in `lib/display-template.ts`; this only draws the result, each
 * slot as the field's View or, for a file-codec reference, as the file itself.
 *
 * One grammar, no plain-text mode: the `{{ field | filter }}` of `lib/template.ts` (the collection's
 * `record_title` grammar), rendered through the markdown renderer every time. Layout-agnostic and stateless: the
 * kanban card and the card grid both draw it. `context="record"` is what a card wants — the whole value, wrapped;
 * `cell` is table semantics and clips a value at a 270px column's edge.
 */
import { useMemo } from "react"
import type { FieldRow } from "../api/types.ts"
import { FileThumb } from "../components/FileThumb.tsx"
import { MdNodes, mdTemplate } from "../components/Markdown.tsx"
import { compileTemplate } from "../lib/display-template.ts"
import { renderMd } from "../lib/render-md.ts"
import { RenderView } from "./Render.tsx"

export function DisplayTemplate({
  template,
  record,
  fields,
  context = "cell",
}: {
  template: string
  record: Record<string, unknown>
  fields: readonly FieldRow[]
  context?: "cell" | "record"
}) {
  const compiled = useMemo(() => compileTemplate(template, record, fields), [template, record, fields])
  const nodes = useMemo(
    () =>
      renderMd(
        compiled.source,
        compiled.slots.map(s => s.text)
      ),
    [compiled]
  )
  return (
    <div className={mdTemplate}>
      <MdNodes
        nodes={nodes}
        slot={i => {
          const s = compiled.slots[i]
          if (!s) return null
          return s.file ? (
            <FileThumb value={s.value as string} />
          ) : (
            <RenderView field={s.field} value={s.value} context={context} record={record} />
          )
        }}
      />
    </div>
  )
}
