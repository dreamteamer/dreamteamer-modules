/**
 * THE SCHEMA DESIGNER'S STATE AND WRITE PATH, pure — ported from the Vue ui's composables/designer-state.ts with
 * the Vue refs taken out: `loadDesigner` reads a collection's fields into an ordered `StagedField[]`, the page edits
 * that array in memory (the drawer's Apply, the grid's hide/delete), and `saveDesigner` diffs it against what was
 * loaded and writes one op per added, changed or removed field. The React page (settings/DataModelDetail.tsx)
 * holds the arrays; this file holds every decision, so the requests a save sends are a unit test.
 *
 * WRITE PATH: the engine has PER-FIELD ops (`POST /fields/:c`, `PATCH`/`DELETE /fields/:c/:f`), each a
 * compile-gated descriptor source write that commits — so a save is a diff, each op a WHOLE v2 field built by
 * `lib/field-def.ts` over the field as its source authored it. What a v2 field has no place for (a note, a new
 * object's sub-fields, pure reordering) is skipped with a returned warning instead of being silently eaten.
 *
 * ⚠ A RELATION IS AUTHORED FROM WHICHEVER SIDE THE OPERATOR IS LOOKING AT. Which collection stores the key is a
 * question in the drawer (`def.link_side`), so the field on the other collection is written here too, and named in
 * a notice. The order is the mechanism: the KEY must exist before anything derives from it, so a mirror's write
 * always comes last; the other collection's field is written with FLAGS, which restate only what they name.
 *
 * ⚠ ONE FIELD'S FAILURE DOES NOT TAKE THE BATCH DOWN: each field is attempted, its failure reported against its
 * name, and every op is compile-gated on its own, so what lands always compiles.
 */
import {
  createField,
  createFieldFlags,
  deleteField,
  getCollectionSource,
  getPresentation,
  updateField,
  updateFieldFlags,
  type Presentation,
  type Relation,
} from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { fieldFromDef, SURFACES } from "./field-def.ts"
import { isBodyField, isMirrorField, isReferenceField, isRelationField } from "./field-row.ts"
import { isGeneratedDescription, mirrorOwnerOf, type MirrorOwner } from "./relation-meta.ts"

export interface StagedField {
  /** Field name. */
  key: string
  /** The drawer's vocabulary for the field (type/required/target/editor/viewer/display keys/the relation). */
  def: Record<string, unknown>
  /** Locked block (engine-held, the body, a synthetic): never carries a PRESENTATION edit. */
  implicit: boolean
  /** Set only on a field DERIVED from a key on another collection — the `<collection>.<field>` that key is. */
  mirror?: MirrorOwner
}

/** Has this staged field a descriptor of its own to write? True for every ordinary field, and for a derived
 *  relation field — whose relation this collection may perfectly well declare. */
export function authored(f: StagedField): boolean {
  return !f.implicit || f.mirror !== undefined
}

/** A locked-block field: one the engine owns (`kind`), the markdown body, or a `$`-prefixed synthetic. The lock is
 *  on PRESENTATION only — the relation a mirror describes is editable from here. */
export function isLockedRow(row: FieldRow): boolean {
  return row.kind !== undefined || isBodyField(row) || row.field.startsWith("$")
}

export interface SaveOutcome {
  warnings: string[]
  notices: string[]
  errors: string[]
}

/** One display-contract row → the drawer's def. Reconstructs the LOGICAL type (relation / list / tags), carries the
 *  display keys (the authored block where the source has one, else the row's) and the default, so a save
 *  round-trips what it did not touch. */
export function rowToStaged(
  row: FieldRow,
  target: string | undefined,
  keyRule: "restrict" | "set-null" | undefined,
  farField: string | undefined,
  authoredDisplay: Record<string, unknown> = {}
): StagedField {
  const def: Record<string, unknown> = {}
  if (isRelationField(row)) {
    if (row.many) {
      def["type"] = "list"
      def["of"] = "relation"
    } else def["type"] = "relation"
  } else if (row.many && row.type !== "object") {
    // a list of scalars is the drawer's `tags`; `of` keeps its element type
    def["type"] = "tags"
    def["of"] = row.type
  } else {
    def["type"] = row.type
    if (row.many) def["many"] = true
  }
  if (target) def["target"] = `/${target}`
  def["required"] = row.required
  if (row.editor !== undefined) def["editor"] = row.editor
  if (row.viewer !== undefined) def["viewer"] = row.viewer
  if (row.editor_options !== undefined) def["editor_options"] = row.editor_options
  if (row.viewer_options !== undefined) def["viewer_options"] = row.viewer_options
  // ⚠ the authored block is asked FIRST: a deprecated field's row carries no form_section, its source may
  const hidden = (Array.isArray(authoredDisplay["hidden"]) ? authoredDisplay["hidden"] : (row.hidden ?? [])) as string[]
  if (SURFACES.every(x => hidden.includes(x))) def["hidden"] = true
  else if (hidden.length) def["hidden"] = SURFACES.filter(x => hidden.includes(x))
  const editable = authoredDisplay["editable"] ?? (row.kind ? true : row.editable)
  if (editable === false || editable === "create") def["editable"] = editable
  for (const k of ["form_section", "placeholder", "unit", "unit_field", "direction", "width"] as const) {
    const v = authoredDisplay[k] ?? (row as unknown as Record<string, unknown>)[k]
    if (v !== undefined && v !== null && v !== "") def[k] = v
  }
  // ONE fact decides the relation: which collection stores the key
  const owner = mirrorOwnerOf(row, target)
  if (owner) {
    def["link_side"] = "target"
    def["far_field"] = owner.field
    if (keyRule !== undefined) def["on_delete"] = keyRule
  } else if (isReferenceField(row)) {
    def["link_side"] = "here"
    // a key nothing mirrors is a ONE-WAY reference: no far field at all (ui stated `""`, which the drawer read as
    // two-way with an unnamed far field — an error that blocked Apply on every plain reference)
    if (farField) def["far_field"] = farField
    if (row.unique) def["unique"] = true
    if (row.on_delete !== undefined) def["on_delete"] = row.on_delete
  }
  // never the sentence compile stamps on a derived field — writing it back launders engine wording into a source
  if (typeof row.description === "string" && !isGeneratedDescription(row.description))
    def["description"] = row.description
  if (row.default !== undefined && row.default !== null) def["default"] = row.default
  return { key: row.field, def, implicit: isLockedRow(row), ...(owner ? { mirror: owner } : {}) }
}

// ---- the relation, read off a staged def -------------------------------------------------------------------

export interface FarSide {
  target: string
  /** The field on the other collection; empty = none (a one-way reference). */
  field: string
  side: "here" | "target"
  list: boolean
  unique: boolean
  onDelete: "restrict" | "set-null"
}

/** The far side of the relation a def describes, or null when there is none to write. */
export function farSideOf(def: Record<string, unknown> | undefined): FarSide | null {
  if (!def) return null
  const type = def["type"]
  const of = def["of"]
  const isRelation =
    type === "relation" ||
    (type === "list" && (of === "relation" || (of as Record<string, unknown> | null)?.["type"] === "relation"))
  if (!isRelation) return null
  const target = typeof def["target"] === "string" ? def["target"].replace(/^\//, "") : ""
  if (!target || target === "*") return null
  const side = def["link_side"] === "target" ? "target" : "here"
  const field = typeof def["far_field"] === "string" ? def["far_field"] : ""
  if (side === "target" && !field) return null
  return {
    target,
    field,
    side,
    list: type === "list",
    unique: side === "here" && def["unique"] === true,
    onDelete: def["on_delete"] === "set-null" ? "set-null" : "restrict",
  }
}

// ---- load ------------------------------------------------------------------------------------------------------

export interface Loaded {
  fields: StagedField[]
  /** The loaded defs of every authored field, by key — what a save diffs against. */
  defs: Record<string, Record<string, unknown>>
  /** Each field as its source authored it — what a whole-field write is built over. */
  sources: Record<string, Record<string, unknown>>
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const rowsOf = (p: Presentation, collection: string): FieldRow[] =>
  (p.fields?.[collection] ?? []).map(r => ({ ...r, collection }))

export async function loadDesigner(collection: string): Promise<Loaded> {
  const [p, source] = await Promise.all([getPresentation(), getCollectionSource(collection).catch(() => ({}))])
  const own = (source as Record<string, unknown>)["fields"]
  const sources = (isMap(own) ? own : {}) as Record<string, Record<string, unknown>>
  const relations: Relation[] = p.relations ?? []
  const targets = new Map<string, string>()
  for (const rel of relations)
    if (rel.collection === collection && rel.related_collection) targets.set(rel.field, rel.related_collection)
  const rows = rowsOf(p, collection)
  // both halves of a relation are stated ONE collection over: a mirror's delete rule is on the key's row, a key's
  // mirror is the target's field whose `mirror_of` names it
  const keyRules = new Map<string, "restrict" | "set-null">()
  const farFields = new Map<string, string>()
  for (const row of rows) {
    const target = targets.get(row.field)
    if (!target || (!isMirrorField(row) && !isReferenceField(row))) continue
    const far = rowsOf(p, target)
    const owner = mirrorOwnerOf(row, target)
    if (owner) {
      keyRules.set(
        row.field,
        far.find(r => r.field === owner.field)?.on_delete === "set-null" ? "set-null" : "restrict"
      )
    } else {
      const mirror = far.find(
        r =>
          isMirrorField(r) &&
          r.mirror_of === row.field &&
          relations.some(
            rel => rel.collection === target && rel.field === r.field && rel.related_collection === collection
          )
      )
      if (mirror) farFields.set(row.field, mirror.field)
    }
  }
  const defs: Record<string, Record<string, unknown>> = {}
  const fields = rows.map(row => {
    const display = sources[row.field]?.["display"]
    const staged = rowToStaged(
      row,
      targets.get(row.field),
      keyRules.get(row.field),
      farFields.get(row.field),
      isMap(display) ? display : {}
    )
    if (authored(staged)) defs[staged.key] = clone(staged.def)
    return staged
  })
  return { fields, defs, sources }
}

// ---- edits on the staged array ----------------------------------------------------------------------------------

/** The drawer's Apply: an existing key's def is REPLACED (a cleared attribute drops), a new key is appended. */
export function applyStaged(fields: StagedField[], field: StagedField): StagedField[] {
  return fields.some(f => f.key === field.key)
    ? fields.map(f => (f.key === field.key ? { ...f, def: field.def } : f))
    : [...fields, field]
}

export function patchStaged(fields: StagedField[], key: string, patch: Record<string, unknown>): StagedField[] {
  return fields.map(f => (f.key === key ? { ...f, def: { ...f.def, ...patch } } : f))
}

export function moveStaged(fields: StagedField[], from: number, to: number): StagedField[] {
  if (from < 0 || from >= fields.length || to < 0 || to >= fields.length || from === to) return fields
  const next = fields.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

export const isDirty = (fields: StagedField[], loaded: Loaded): boolean =>
  JSON.stringify(fields) !== JSON.stringify(loaded.fields)

// ---- save -------------------------------------------------------------------------------------------------------

const fieldsOf = async (collection: string): Promise<FieldRow[]> => rowsOf(await getPresentation(), collection)

/** The far side's writes for one field, in order (see the header). */
function farOps(here: string, key: string, next: FarSide | null, previous: FarSide | null): (() => Promise<void>)[] {
  if (next && next.side === "target") {
    return [
      async () => {
        const exists = (await fieldsOf(next.target)).some(r => r.field === next.field)
        // `restrict` is the engine's default: stated only to CLEAR a `set-null` that was there
        const rule =
          next.onDelete === "set-null" ? "set-null" : previous?.onDelete === "set-null" ? "restrict" : undefined
        const withRule = rule ? { "on-delete": rule } : {}
        if (exists) await updateFieldFlags(next.target, next.field, { unique: !next.list, ...withRule })
        else
          await createFieldFlags(next.target, {
            name: next.field,
            type: here,
            ...(next.list ? {} : { unique: true }),
            ...withRule,
          })
      },
    ]
  }
  if (next && next.field) {
    return [
      async () => {
        const flags = { type: here, "mirror-of": key }
        if ((await fieldsOf(next.target)).some(r => r.field === next.field))
          await updateFieldFlags(next.target, next.field, flags)
        else await createFieldFlags(next.target, { name: next.field, ...flags })
      },
    ]
  }
  // going one-way: the far mirror turned off goes — unless it went with this field's own write
  if (previous?.side === "here" && previous.field) {
    const gone = previous
    return [
      async () => {
        if ((await fieldsOf(gone.target)).some(r => r.field === gone.field)) await deleteField(gone.target, gone.field)
      },
    ]
  }
  return []
}

/** What a removal did to the records, or null when it touched none. */
export function clearedNote(collection: string, field: string, cleared: number | undefined): string | null {
  if (!cleared) return null
  const subject = cleared === 1 ? `1 ${collection} record` : `${cleared} ${collection} records`
  return `${collection}.${field} removed; its values went with it from ${subject} (the previous version is in git).`
}

/** "meetings.summary ↔ meeting-summaries.meeting — the link is kept on …": both fields named, because one did not
 *  exist a moment ago and it is on a collection the operator was not looking at. */
export function relationNotice(here: string, key: string, far: FarSide | null): string | null {
  if (!far || !far.field) return null
  const stored = far.side === "here" ? `${here}.${key}` : `${far.target}.${far.field}`
  return `${here}.${key} ↔ ${far.target}.${far.field} — the link is kept on ${stored}`
}

export async function saveDesigner(here: string, loaded: Loaded, fields: StagedField[]): Promise<SaveOutcome> {
  const warnings: string[] = []
  const notices: string[] = []
  const errors: string[] = []
  let ops = 0
  const staged = fields.filter(authored)
  const stagedKeys = new Set(staged.map(f => f.key))
  const fail = (key: string, err: unknown) =>
    errors.push(`'${key}': ${err instanceof Error ? err.message : String(err)}`)
  const note = (n: string | null) => n && notices.push(n)

  // removed fields first, so a remove + re-add doesn't trip "already exists"
  for (const key of Object.keys(loaded.defs)) {
    if (stagedKeys.has(key)) continue
    try {
      const out = await deleteField(here, key)
      ops++
      note(clearedNote(here, key, out?.cleared))
    } catch (err) {
      fail(key, err)
    }
  }

  for (const f of staged) {
    const was = loaded.defs[f.key]
    const base = loaded.sources[f.key] ?? {}
    const next = fieldFromDef(f.def, base)
    const far = farSideOf(f.def)
    const farWas = farSideOf(was)
    if (next.unsaved.length && (!was || JSON.stringify(f.def) !== JSON.stringify(was)))
      warnings.push(`'${f.key}': ${next.unsaved.join("; ")} — a v2 field has no place for it, so it was not stored.`)
    try {
      if (!was) {
        if (!next.field) {
          warnings.push(
            `'${f.key}': an object field's sub-fields can't be created here yet — edit the collection descriptor instead.`
          )
          continue
        }
        // the key goes in first when it is on the other collection
        if (far?.side === "target") for (const op of farOps(here, f.key, far, null)) await op()
        await createField(here, f.key, next.field)
        if (far?.side !== "target") for (const op of farOps(here, f.key, far, null)) await op()
        ops++
        note(relationNotice(here, f.key, far))
        continue
      }
      if (JSON.stringify(f.def) === JSON.stringify(was)) continue
      const before = fieldFromDef(was, base)
      if (!next.field || !before.field) {
        warnings.push(`'${f.key}': this field's schema is structured — edit the collection descriptor to change it.`)
        continue
      }
      const ownChanged = JSON.stringify(next.field) !== JSON.stringify(before.field)
      const farChanged = JSON.stringify(far) !== JSON.stringify(farWas)
      if (!ownChanged && !farChanged) continue
      const later = farChanged ? farOps(here, f.key, far, farWas) : []
      if (far?.side === "target") for (const op of later) await op()
      if (ownChanged) await updateField(here, f.key, next.field)
      if (far?.side !== "target") for (const op of later) await op()
      ops++
      note(relationNotice(here, f.key, far))
    } catch (err) {
      fail(f.key, err)
    }
  }

  if (!ops && !warnings.length && !errors.length && isDirty(fields, loaded))
    warnings.push("Field order isn’t persisted by the server yet — reordering stays local to this session.")
  return { warnings, notices, errors }
}

// ---- enum values ------------------------------------------------------------------------------------------------

/** The stored values of a staged def's enum (its choice rows), in order — what Rename value… offers. */
export function enumValues(def: Record<string, unknown>): string[] {
  const options = def["editor_options"]
  const choices = isMap(options) ? options["choices"] : undefined
  if (!Array.isArray(choices)) return []
  return choices
    .map(c => (isMap(c) ? c["value"] : c))
    .filter(v => v !== undefined && v !== null && v !== "")
    .map(String)
}

/** Why `to` cannot be a new name next to `taken` (a field's or an enum value's), or null. */
export function renameProblem(
  from: string,
  to: string,
  taken: readonly string[],
  what: "field" | "value"
): string | null {
  const name = to.trim()
  if (!name) return `Name the ${what}.`
  if (name === from) return `That is the ${what}'s name now.`
  if (what === "field" && /[.\/\s]/.test(name)) return "A field name carries no dots, slashes or spaces."
  if (taken.includes(name))
    return what === "field" ? `A field named ${name} already exists.` : `${name} is already a value.`
  return null
}

// ---- the rename plans -----------------------------------------------------------------------------------------

/** A rename's `?dry-run=true` answer, as one sentence: how many records and which source places it rewrites. */
export function renamePlanLine(plan: Record<string, unknown> | null | undefined): string {
  if (!plan) return "Nothing to rewrite."
  const records = typeof plan["records"] === "number" ? plan["records"] : 0
  const positions = Array.isArray(plan["positions"]) ? (plan["positions"] as Array<Record<string, unknown>>) : []
  const files = new Set(positions.map(p => String(p["rel"] ?? "")).filter(Boolean))
  const parts = [`${records} record${records === 1 ? "" : "s"}`]
  if (positions.length)
    parts.push(
      `${positions.length} place${positions.length === 1 ? "" : "s"} in ${files.size} source file${files.size === 1 ? "" : "s"}`
    )
  return `Rewrites ${parts.join(" and ")}.`
}

/** The source files a plan touches, each once, in order — drawn under the sentence. */
export function planFiles(plan: Record<string, unknown> | null | undefined): string[] {
  const positions = Array.isArray(plan?.["positions"]) ? (plan["positions"] as Array<Record<string, unknown>>) : []
  return [...new Set(positions.map(p => String(p["rel"] ?? "")).filter(Boolean))]
}
