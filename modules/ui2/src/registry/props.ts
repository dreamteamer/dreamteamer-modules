/**
 * The props every registered Edit and View receives — the same contract @dreamteamer/ui hands its Vue
 * components (`value`, `field`, `options`), with the write side as a callback instead of an event.
 * A module's own Edit or View registers against these.
 */
import type { FieldComponentOptions, FieldRow } from "../api/types.ts"

export interface EditProps {
  field: FieldRow
  value: unknown
  /** The new value; `null` clears the field. */
  onChange(value: unknown): void
  /** `field.editor_options`. */
  options?: FieldComponentOptions
  /** The input's DOM id, so the form's label points at it. */
  id: string
  /** True on the new-record form. */
  create?: boolean
}

export interface ViewProps {
  field: FieldRow
  value: unknown
  /** `field.viewer_options`. */
  options?: FieldComponentOptions
  /** `cell` (a list, a card: one tight line) or `record` (the record page: the whole value). */
  context: "cell" | "record"
  /** The row the value belongs to. */
  record?: Record<string, unknown>
}

/**
 * The props every registered List receives — the same set @dreamteamer/ui's BrowseView hands its Lists. A built-in
 * reads the browse's whole `state` (rows, columns, grouping options, selection, paging); a module's List may read
 * only the documented three and fetch for itself: the collection, the query the browse is asking
 * (`filter` is the effective one, ready for the records API), and the options its view or preset gave it.
 */
export interface ListProps {
  state: import("../browse/browse-state.ts").BrowseState
  collection: string
  query: { search: string; filter: Record<string, unknown> | undefined; sort: string }
  options: Record<string, unknown>
}
