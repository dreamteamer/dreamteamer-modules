/**
 * THE SCHEMA — the display contract (`GET /presentation`) read once into what every page asks of it: a
 * collection's resolved row (title, list and record display, form sections, record title template), its field
 * rows in order, and where a reference field points. The engine resolves the display, so nothing here
 * re-derives a default: a field's surfaces are its `hidden` list, its choices its `editor_options.choices`,
 * its editor and viewer its own ids (resolved by the registry).
 *
 * Pure: no React, no transport — `buildSchema` is handed the answer.
 */
import type { Presentation, Relation } from "../api/client.ts"
import { collectionRows } from "../api/collectionRows.ts"
import type { CollectionRow, FieldRow } from "../api/types.ts"
import { drawnOn, hasControl, isBodyField, isRelationField } from "./field-row.ts"
import { titleOf } from "./record-title.ts"
import { templateFields, tryRenderDisplay, type RenderOptions } from "./template.ts"

export interface Schema {
  /** Every collection row, in the order the host sent them. */
  collections: CollectionRow[]
  /** Every collection name, runtime ones included. */
  names: string[]
  collection(name: string): CollectionRow | undefined
  /** A collection's field rows, in field order; [] for an unknown collection. */
  fields(name: string): FieldRow[]
  field(collection: string, name: string): FieldRow | undefined
  /** Where a reference field points, or null for any other field. */
  target(field: FieldRow): { collection: string; list: boolean } | null
}

export const EMPTY_SCHEMA: Schema = buildSchema({ collections: [], fields: {}, relations: [] })

export function buildSchema(p: Presentation): Schema {
  const collections = collectionRows(p.collections ?? [])
  const byName = new Map(collections.map(c => [c.collection, c]))
  const fields = new Map(
    Object.entries(p.fields ?? {}).map(([c, rows]) => [c, rows.map(r => ({ ...r, collection: c }))])
  )
  const relations = new Map<string, Relation>((p.relations ?? []).map(r => [`${r.collection}\u0000${r.field}`, r]))
  return {
    collections,
    names: collections.map(c => c.collection),
    collection: name => byName.get(name),
    fields: name => fields.get(name) ?? [],
    field: (c, name) => fields.get(c)?.find(f => f.field === name),
    target(field) {
      if (!isRelationField(field) || !field.collection) return null
      const r = relations.get(`${field.collection}\u0000${field.field}`)
      return r ? { collection: r.related_collection, list: r.list } : null
    },
  }
}

/** What a record is called: the collection's `record_title` template over the record, else its title or name
 *  field, else its id. `opts` resolves a reference in the template to its target's own title. */
export function recordLabel(
  row: CollectionRow | undefined,
  record: Record<string, unknown>,
  id: string,
  opts?: RenderOptions
): string {
  const rendered = row?.record_title ? tryRenderDisplay(row.record_title, { id, ...record }, opts)?.trim() : ""
  return rendered || titleOf({ ...record, id }) || id
}

/** A list's columns: the collection's authored `list.columns` in that order when it names some, else every
 *  field drawn on the list surface bar the body and the position — the fields its record title names first, so
 *  a row leads with what the record is called. */
export function listColumns(row: CollectionRow | undefined, fields: readonly FieldRow[]): FieldRow[] {
  const named = row?.list.columns
  if (named?.length) {
    const byName = new Map(fields.map(f => [f.field, f]))
    return named.map(n => byName.get(n)).filter((f): f is FieldRow => f !== undefined)
  }
  const shown = fields.filter(f => drawnOn(f, "list") && !isBodyField(f) && f.type !== "position")
  const titled = new Set(templateFields(row?.record_title ?? ""))
  return [...shown.filter(f => titled.has(f.field)), ...shown.filter(f => !titled.has(f.field))]
}

/** The fields a record form draws (the form surface), and which of them it offers a control for. */
export function formFields(fields: readonly FieldRow[], create: boolean): { field: FieldRow; control: boolean }[] {
  return fields
    .filter(f => drawnOn(f, "form") && !f.deprecated && f.type !== "position")
    .map(field => ({ field, control: hasControl(field, { create }) }))
}

/** The engine's facts about a record, read-only beside its form: fields the form surface leaves out but the
 *  record surface draws (`created`, `last_modified`, …). */
export function recordFacts(fields: readonly FieldRow[]): FieldRow[] {
  return fields.filter(f => !drawnOn(f, "form") && drawnOn(f, "record"))
}

/** `projects/northwind-launch` → `{ collection, id }`, resolved against the collection names (a name may hold
 *  `/`), longest first. A leading `/` (the canonical form some hosts send) is dropped. */
export function splitRef(ref: string, names: readonly string[]): { collection: string; id: string } | null {
  const r = ref.replace(/^\//, "")
  const sorted = [...names].sort((a, b) => b.length - a.length)
  for (const c of sorted)
    if (r.startsWith(`${c}/`) && r.length > c.length + 1) return { collection: c, id: r.slice(c.length + 1) }
  return null
}

/** The fields whose value changed between two snapshots — what a PATCH sends. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(after)) {
    const was = before[k] ?? null
    if (JSON.stringify(was) !== JSON.stringify(v ?? null)) out[k] = v ?? null
  }
  return out
}
