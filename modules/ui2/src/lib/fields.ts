/**
 * FIELDS — what a descriptor says about its records, read one way for every page: the collection's title,
 * its fields in order, which of them a list shows and a form edits, and how a value reads as text.
 *
 * The compiled descriptor (`compiled.fields`) is the authority when the host sends one — compile has merged
 * mixins and overlays and added the engine's own fields (`id`, `created`, `last_modified`); the authored
 * `fields` are the fallback. A field whose `type` names a collection is a relation; its value is
 * `<collection>/<id>` (or a list of them when `many`).
 */
import type { Descriptor, FieldDef } from "../api/client.ts"

export interface Field extends FieldDef {
  name: string
}

/** Field types the engine knows as scalars; any other type names a collection. */
const SCALARS = new Set([
  "string",
  "text",
  "markdown",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "url",
  "email",
  "position",
  "file",
  "json",
])

export function fieldsOf(d: Descriptor | undefined): Field[] {
  const map = d?.compiled?.fields ?? d?.fields ?? {}
  return Object.entries(map).map(([name, def]) => ({ name, ...def }))
}

export function titleOf(d: Descriptor | undefined, fallback = ""): string {
  return d?.compiled?.defaults?.title ?? (d?.name ? humanize(d.name.split("/").pop() ?? d.name) : fallback)
}

export function singularOf(d: Descriptor | undefined): string {
  return d?.compiled?.defaults?.singular ?? "record"
}

/** `last_modified` → `Last modified`. */
export function humanize(name: string): string {
  const s = name.replace(/[-_]+/g, " ").trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const labelOf = (f: Field): string => f.title ?? humanize(f.name)

/** The engine fills these; a form shows them read-only and never sends them. */
export const isComputed = (f: Field): boolean => Boolean(f.virtual || f.derived)

/** A list's columns: the authored fields bar the body, the position and what the title column already shows
 *  (`name`, `title`), then `created` — the one engine field worth a column. */
export function columnsOf(fields: Field[]): Field[] {
  const own = fields.filter(
    f => !isComputed(f) && !f.body && f.type !== "position" && f.name !== "name" && f.name !== "title"
  )
  return [...own, ...fields.filter(f => f.name === "created")]
}

/** The fields a form edits: authored ones, the body last. */
export function editableOf(fields: Field[]): Field[] {
  const own = fields.filter(f => !isComputed(f) && f.type !== "position")
  return [...own.filter(f => !f.body), ...own.filter(f => f.body)]
}

export function enumValues(f: Field): string[] | null {
  if (Array.isArray(f.enum)) return f.enum
  if (f.enum && typeof f.enum === "object") return Object.keys(f.enum)
  return null
}

/** The collection a relation points at, or null for a scalar. */
export function relationTarget(f: Field, collections: readonly string[]): string | null {
  if (SCALARS.has(f.type)) return null
  return collections.includes(f.type) ? f.type : null
}

/** `projects/northwind-launch` → `{ collection: "projects", id: "northwind-launch" }`, resolved against the
 *  collection names (a name may hold `/`), longest first. */
export function splitRef(ref: string, collections: readonly string[]): { collection: string; id: string } | null {
  const names = [...collections].sort((a, b) => b.length - a.length)
  for (const c of names)
    if (ref.startsWith(`${c}/`) && ref.length > c.length + 1) return { collection: c, id: ref.slice(c.length + 1) }
  return null
}

/** What a record is called: its `name`, else its `title`, else its id. */
export function recordTitle(fields: Record<string, unknown>, id: string): string {
  for (const k of ["name", "title"]) {
    const v = fields[k]
    if (typeof v === "string" && v.trim()) return v
  }
  return id
}

/** A value as one line of text. Dates read in the viewer's locale; lists join with commas. */
export function formatValue(value: unknown, f?: Pick<Field, "type">): string {
  if (value === null || value === undefined || value === "") return ""
  if (Array.isArray(value)) return value.map(v => formatValue(v, f)).join(", ")
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (f?.type === "datetime" && typeof value === "string") {
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  }
  if (f?.type === "date" && typeof value === "string") {
    const d = new Date(`${value}T00:00:00`)
    return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { dateStyle: "medium" })
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** A form input's text back into the value the field stores; "" clears it (null). */
export function parseInput(text: string, f: Pick<Field, "type" | "many">): unknown {
  if (f.many) {
    const parts = text
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
    return parts.length ? parts : null
  }
  if (text === "") return null
  if (f.type === "number" || f.type === "integer") {
    const n = Number(text)
    return Number.isFinite(n) ? n : text
  }
  return text
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
