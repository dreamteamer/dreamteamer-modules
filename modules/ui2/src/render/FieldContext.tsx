/**
 * "Which collection's fields am I configuring?" — provided by whoever draws an options form for a collection
 * (a list's layout options, later), read by the Edits that OFFER fields rather than have them typed in
 * (`field-select`, `field-multi-select`, `display-template`). A context rather than a prop: OptionsForm and
 * RenderEdit have no business knowing about collections, and threading one through them to reach a leaf Edit
 * would put collection awareness in the generic form machinery.
 *
 * Absence is a normal state: an EditList row or a bare options form has no collection, and those Edits fall back
 * to a plain text input — a name can still be typed.
 */
import { createContext, useContext } from "react"
import type { FieldRow } from "../api/types.ts"

export interface FieldContextValue {
  /** The collection whose fields these are. */
  collection: string
  /** Its selectable fields, already filtered to what a person should see. */
  fields: FieldRow[]
}

export const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext)
}
