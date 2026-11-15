/**
 * What every View draws for no value — one quiet dash, so an empty cell and an empty record row read alike.
 */
export const Empty = () => <span className="ui2-empty">—</span>

export const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)

/** A cell's truncation budget: a string column and a markdown column clip at the same place. */
export const CELL_MAX = 80
