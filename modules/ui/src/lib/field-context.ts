/**
 * Which of a collection's fields an option should OFFER — the pure half of the Vue ui's
 * lib/field-context.ts. The ambient "whose fields am I configuring?" itself is a React context
 * (`render/FieldContext.tsx`); the `field-select`, `field-multi-select` and `display-template` Edits read it,
 * and fall back to typing a name where nobody provided one (an EditList row, a bare options form).
 */
import type { FieldRow } from "../api/types.ts"
import { choicesOf } from "./field-row.ts"

/** True when `field` declares a fixed vocabulary — a natural board/group axis. */
export function hasChoices(field: FieldRow): boolean {
  return choicesOf(field) !== null
}

/**
 * Fields an option should offer, honoring three `editor_options` knobs an option may declare:
 *   `types`  — keep only these wire types (`['date','datetime']` for a calendar's date field)
 *   `roles`  — keep only fields playing one of these roles (`['reference','reference_many']`)
 *   `prefer` — `'choices'` floats enum-ish fields to the top (a kanban's group-by axis) without hiding the rest
 * Order is otherwise the schema's own field order, which is the order the reader sees everywhere else.
 */
export function selectableFields(fields: readonly FieldRow[], options?: Record<string, unknown>): FieldRow[] {
  const types = options?.["types"]
  const wanted = Array.isArray(types) ? types.map(String) : null
  let filtered = wanted ? fields.filter(f => wanted.includes(f.type)) : [...fields]

  const roles = options?.["roles"]
  if (Array.isArray(roles) && roles.length) {
    const wantedRoles = roles.map(String)
    filtered = filtered.filter(f => f.role !== undefined && wantedRoles.includes(f.role))
  }

  if (options?.["prefer"] !== "choices") return filtered
  return filtered.sort((a, b) => Number(hasChoices(b)) - Number(hasChoices(a)))
}
