/**
 * THE FIELD DRAWER's decisions, pure (ported from the Vue ui's components/designer/FieldDrawer.vue, whose
 * watchers become functions of the draft here): the type vocabulary and the `relation-list` display id, what
 * changing the type / the Edit / the View drops from the draft, the relation read as the drawer's questions (where
 * the link is kept, two-way, at most one, the delete rule), the far field's suggested name and its live check
 * against the other collection's real fields.
 *
 * ⚠ NOTHING HERE NAMES A DESCRIPTOR KEYWORD. `link_side` / `far_field` / `unique` / `on_delete` on the def are the
 * drawer's vocabulary; `lib/field-def.ts` turns them into the one v2 relation spelling and
 * `lib/designer-state.ts` writes the other collection's field too.
 */
import type { FieldRow } from "../api/types.ts"
import { isMirrorField, isRelationField, isRelationList } from "./field-row.ts"
import {
  baseNameOf,
  defaultForeignKeyName,
  defaultInverseName,
  defaultLinkSide,
  singularOf,
  type LinkSide,
} from "./relation-meta.ts"

type Def = Record<string, unknown>

/** The descriptor types the drawer offers. `relation-list` is a DISPLAY id: the def stays `{type: list, of:
 *  relation}`, which is what field-def reads. */
export const FIELD_TYPES: { id: string; label: string }[] = [
  { id: "string", label: "String" },
  { id: "markdown", label: "Markdown" },
  { id: "number", label: "Number" },
  { id: "integer", label: "Integer" },
  { id: "boolean", label: "Boolean" },
  { id: "date", label: "Date" },
  { id: "datetime", label: "Datetime" },
  { id: "relation", label: "Relation" },
  { id: "relation-list", label: "Relation (many)" },
  { id: "list", label: "List" },
  { id: "object", label: "Object" },
]

/** The wire type the registries' `types` arrays key on: a relation and a list's items travel as strings. */
export function wireOf(type: string): string {
  return (
    ({ relation: "string", "relation-list": "string", list: "string", tags: "string" } as Record<string, string>)[
      type
    ] ?? type
  )
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function holdsRelations(def: Def): boolean {
  const of = def["of"]
  return of === "relation" || (isMap(of) && of["type"] === "relation")
}

/** The type the Type control shows. */
export function typeOf(def: Def): string {
  const raw = typeof def["type"] === "string" ? def["type"] : "string"
  return raw === "list" && holdsRelations(def) ? "relation-list" : raw
}

export const isRelationType = (type: string): boolean => type === "relation" || type === "relation-list"

/** The draft after the Type control changes: leaving a relation drops the link with the target it described; a
 *  NEW relation offers the side its shape usually takes until the operator moves the radio (`sideTouched`). */
export function withType(def: Def, next: string, opts: { editing: boolean; sideTouched: boolean }): Def {
  const out: Def = { ...def }
  if (next === "relation-list") {
    out["type"] = "list"
    out["of"] = "relation"
  } else {
    out["type"] = next
    if (next !== "list") delete out["of"]
  }
  if (!isRelationType(next) && next !== "list") {
    delete out["target"]
    for (const k of ["far_field", "unique", "on_delete", "link_side"]) delete out[k]
    const vo = out["viewer_options"]
    if (isMap(vo) && "template" in vo) {
      const rest = { ...vo }
      delete rest["template"]
      if (Object.keys(rest).length) out["viewer_options"] = rest
      else delete out["viewer_options"]
    }
  }
  if (isRelationType(next) && !opts.editing && !opts.sideTouched)
    out["link_side"] = defaultLinkSide(next === "relation-list")
  if (next === "relation-list" && out["link_side"] !== "target") delete out["unique"]
  return out
}

/** A different Edit owns a different option shape: its options go. */
export function withEditor(def: Def, editor: string): Def {
  const out: Def = { ...def }
  if (editor) out["editor"] = editor
  else delete out["editor"]
  delete out["editor_options"]
  return out
}

/** A different View drops its options — but the relation's display `template` belongs to the Relationship tab. */
export function withViewer(def: Def, viewer: string): Def {
  const out: Def = { ...def }
  if (viewer) out["viewer"] = viewer
  else delete out["viewer"]
  const vo = def["viewer_options"]
  const template = isMap(vo) ? vo["template"] : undefined
  if (typeof template === "string" && template) out["viewer_options"] = { template }
  else delete out["viewer_options"]
  return out
}

/** Set (or, for an empty object, remove) one of the two option blocks. */
export function withOptions(def: Def, key: "editor_options" | "viewer_options", value: Record<string, unknown>): Def {
  const out: Def = { ...def }
  if (Object.keys(value).length) out[key] = value
  else delete out[key]
  return out
}

export const targetOf = (def: Def): string =>
  typeof def["target"] === "string" ? def["target"].replace(/^\//, "") : ""
export const sideOf = (def: Def): LinkSide => (def["link_side"] === "target" ? "target" : "here")
export const isTwoWay = (def: Def): boolean => sideOf(def) === "target" || typeof def["far_field"] === "string"

/** The name to prefill for the field on the other collection: a derived field takes this collection's name, a key
 *  this collection's singular. Null without a named target. */
export function suggestedFarField(def: Def, collection: string): string | null {
  const target = targetOf(def)
  if (!target || target === "*") return null
  if (sideOf(def) === "target") return defaultForeignKeyName(collection, target)
  return defaultInverseName(collection, target, def["unique"] === true)
}

/**
 * Apply a relation change and move the far field's suggestion with it — while the operator has not typed a
 * name of their own (the field is empty, or still the last suggestion).
 */
export function withRelation(def: Def, patch: Def, collection: string): Def {
  const before = suggestedFarField(def, collection)
  const out: Def = { ...def, ...patch }
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete out[k]
  if (isTwoWay(out) && !("far_field" in patch)) {
    const now = typeof out["far_field"] === "string" ? out["far_field"] : ""
    if (now === "" || now === before) out["far_field"] = suggestedFarField(out, collection) ?? ""
  }
  return out
}

/** Moving the radio: the two sides mean different things by the far name and by "at most one". */
export function withSide(def: Def, side: LinkSide, collection: string): Def {
  const out: Def = { ...def, link_side: side }
  if (side === "target") delete out["unique"]
  out["far_field"] = suggestedFarField(out, collection) ?? ""
  return out
}

/** Two-way on: the far field takes the suggestion. Off: `unique` and the delete rule go with the link. */
export function withTwoWay(def: Def, on: boolean, collection: string): Def {
  const out: Def = { ...def }
  if (on) out["far_field"] = suggestedFarField(out, collection) ?? ""
  else for (const k of ["far_field", "unique", "on_delete"]) delete out[k]
  return out
}

/** "at most one": a flag on the key when the key is here, this field's own type when it is not. */
export function atMostOne(def: Def): boolean {
  return sideOf(def) === "target" ? typeOf(def) !== "relation-list" : def["unique"] === true
}

export function withAtMostOne(def: Def, on: boolean, collection: string): Def {
  if (sideOf(def) === "target") {
    const out: Def = { ...def }
    if (on) {
      out["type"] = "relation"
      delete out["of"]
    } else {
      out["type"] = "list"
      out["of"] = "relation"
    }
    return out // the key's name does not depend on this field's cardinality
  }
  return withRelation(def, { unique: on ? true : undefined }, collection)
}

/** The far field's problem as a sentence, or "" — checked against the other collection's real fields (`far`). */
export function farFieldError(def: Def, collection: string, far: readonly FieldRow[], self: string): string {
  const type = typeOf(def)
  const target = targetOf(def)
  if (!isRelationType(type) || !target || target === "*" || !isTwoWay(def)) return ""
  const name = (typeof def["far_field"] === "string" ? def["far_field"] : "").trim()
  const T = baseNameOf(target)
  if (!name)
    return sideOf(def) === "target"
      ? `Name the field on ${T} that points back here.`
      : `Name the field this adds on ${T}.`
  if (/[.\/\s]/.test(name)) return "A field name carries no dots, slashes or spaces."
  if (sideOf(def) === "here") {
    // a mirror on the target that already names THIS field is this field's own far side, not a collision
    const taken = far.filter(f => !(isMirrorField(f) && f.mirror_of === self)).map(f => f.field)
    return taken.includes(name) ? `${T} already has a field called ${name}.` : ""
  }
  const existing = far.find(f => f.field === name)
  if (!existing) return ""
  if (!isRelationField(existing)) return `${T}.${name} already exists and is not a reference — pick another name.`
  if (isRelationList(existing) && type !== "relation-list")
    return `${T}.${name} holds a list, so it cannot point at just one ${singularOf(baseNameOf(collection))}.`
  if (isMirrorField(existing)) return `${T}.${name} is itself derived from another link — pick another name.`
  return ""
}
