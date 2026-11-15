/**
 * The record form's SECTIONS for one rendering, and which COLLAPSED ones the person has opened — shared by both
 * record layouts (`RecordProperties`, `RecordForm`) so the two cannot disagree about what a section holds or
 * what is shut (ported from @dreamteamer/ui's composables/form-sections.ts and section-disclosure.ts).
 *
 * The surface is the mode's: the read skips a field hidden from `record`, the (edit or create) form one hidden
 * from `form`. Disclosure is page-local on purpose: a fresh record page starts with the provenance block shut.
 */
import { useState } from "react"
import type { FieldRow } from "../api/types.ts"
import { useApp } from "../app-context.tsx"
import { drawnOn, formSections, isBodyField, type FormSection } from "../lib/field-row.ts"

export function useSections(collection: string, fields: readonly FieldRow[], readonly: boolean) {
  const { schema } = useApp()
  const drawn = fields.filter(f => drawnOn(f, readonly ? "record" : "form"))
  const sections = formSections(drawn, schema.collection(collection)?.form?.sections)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  return {
    sections,
    bodyFields: drawn.filter(isBodyField),
    isShut: (s: FormSection) => s.collapsed === true && !opened.has(s.title),
    toggle: (s: FormSection) =>
      setOpened(o => {
        const n = new Set(o)
        if (n.has(s.title)) n.delete(s.title)
        else n.add(s.title)
        return n
      }),
  }
}
