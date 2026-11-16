/**
 * A CARD'S DISPLAY TEMPLATE, compiled — the pure half of `render/DisplayTemplate.tsx` (ported from
 * the Vue ui's components/render/DisplayTemplate.vue, which did both halves in one render function).
 *
 * A template is MARKDOWN whose `{{ field }}` tokens keep their own Views. Substituting the tokens into text first
 * would print a status as `todo` instead of its chip; drawing them as components first would split `**` from its
 * closing `**`. So each bare token becomes a `slotToken` placeholder in the markdown source, and the renderer
 * splices the field's View in where the placeholder lands (`lib/render-md.ts`): `**{{ name }}**` comes out bold AND
 * `{{ status }}` as its chip.
 *
 * Only a BARE token naming a field is a slot; a token carrying a filter (`{{ due | date:DD/MM }}`) asked for a
 * format a View would ignore, so it is the grammar's text, as is a token naming no field (the engine renders it
 * empty too). An unknown filter typed live renders nothing rather than taking the card down. A value that is a
 * FILE-CODEC reference is drawn as its picture, never spelled (`file: true`) — decided by the value against the
 * host's file-base list, so there is no heuristic to be wrong about.
 */
import type { FieldRow } from "../api/types.ts"
import { fileRecordRef } from "./file-record.ts"
import { respectLineBreaks, slotToken } from "./render-md.ts"
import { parseTemplate, renderToken } from "./template.ts"

export interface TemplateSlot {
  field: FieldRow
  value: unknown
  /** The value as plain text — used where markup cannot go (a code span, a link's href). */
  text: string
  /** The value is a file-codec reference: draw the file, not the field's View. */
  file: boolean
}

export interface CompiledTemplate {
  /** Markdown with one `slotToken(i)` per slot, line breaks kept (`respectLineBreaks`). */
  source: string
  slots: TemplateSlot[]
}

export function compileTemplate(
  template: string,
  record: Record<string, unknown>,
  fields: readonly FieldRow[]
): CompiledTemplate {
  const slots: TemplateSlot[] = []
  let source = ""
  for (const part of parseTemplate(template)) {
    if ("text" in part) {
      source += part.text
      continue
    }
    const field = part.filters.length ? undefined : fields.find(f => f.field === part.field)
    if (!field) {
      try {
        source += renderToken(part, record)
      } catch {
        // an unknown filter: nothing, rather than no card
      }
      continue
    }
    const value = record[field.field]
    source += slotToken(slots.length)
    slots.push({
      field,
      value,
      text: renderToken({ field: field.field, filters: [] }, record),
      file: typeof value === "string" && fileRecordRef(value) !== null,
    })
  }
  return { source: respectLineBreaks(source), slots }
}

/** A layout's template option: the string when it says anything, else null (the built-in card). */
export function templateOption(options: Record<string, unknown>, key = "card_title"): string | null {
  const raw = options[key]
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null
}
