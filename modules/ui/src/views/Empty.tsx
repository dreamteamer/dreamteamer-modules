/**
 * What every View draws for no value — one quiet dash, so an empty cell and an empty record row read alike.
 */
import { subtle } from "../styles/classes.ts"

export const Empty = () => <span className={subtle}>—</span>

export const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)

/** A cell's truncation budget: a string column and a markdown column clip at the same place. */
export const CELL_MAX = 80
