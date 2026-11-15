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
  /** The record the value belongs to, pending edits applied — what a currency's code is read from
   *  (`unit_field`). Absent where there is no record (a layout option, a filter value). */
  record?: Record<string, unknown>
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

/**
 * The props a RECORD-SCOPED Edit or View receives — a whole record page's body (`properties`, `form`, `doc`, or
 * a module's own): @dreamteamer/ui's ItemProperties/ItemForm props, with ui's `item` composable spelled out as
 * the record as read, the pending edits and the one write path. The layout applies each field's `hidden` for
 * its surface itself (`record` on the read, `form` while editing or creating), because only it knows the mode.
 */
export interface RecordLayoutProps {
  collection: string
  /** The fields a record page draws (`lib/record-page-fields.ts`), unfiltered by surface. */
  fields: FieldRow[]
  /** The record as read; null on the create form. */
  record: Record<string, unknown> | null
  /** The pending edits, by field. */
  edits: Record<string, unknown>
  /** The one write path: a value equal to the read one drops the edit. */
  setField(field: string, value: unknown): void
  /** View mode: every field draws its View. */
  readonly: boolean
  /** The create form: an `editable: create` field gets its control here and nowhere else. */
  create: boolean
  mode: "view" | "edit"
  /** The record display's `options` (`display.record.options`, or a record-scope view's) — where
   *  `relation_views` is authored. */
  options: Record<string, unknown>
}
