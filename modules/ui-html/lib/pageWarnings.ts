// pageWarnings — every page of a workspace, read for what the desktop app's frame will not run or load.
//
// A page is the string a record holds over an html field (lib/htmlFields.ts). Each construct htmlWarnings
// finds in one becomes a line that names the record's file and the field. Two more lines are about the field
// and not about a page: one for an html field that declares no maxLength, and one for a collection whose
// records could not be read. Nothing here refuses anything, and nothing here is counted by dt check.
import path from "node:path"
import { htmlFieldsOf } from "./htmlFields.ts"
import { htmlWarnings } from "./htmlWarnings.ts"

/** The longest page that is read, in the units a string's length counts. A longer one is one line. */
export const CEILING = 2_000_000
/** How many constructs of one page are listed before the rest are counted in one line. */
export const LINES_PER_PAGE = 50

/** One line: where it is, what it is about, and the sentence printed. */
export interface PageWarning {
  /** the record's file, or the collection's compiled descriptor, from the workspace root */
  file: string
  /** `<collection>/<id>`, or the collection's name for a line about a field or a collection */
  ref: string
  /** the html field, or "" for a line about a whole collection */
  field: string
  construct: string
  effect: string
  detail: string
  /** `<field>: <construct> <effect> (<detail>)` */
  message: string
}

/** What to read: everything, one collection, or one record of it. */
export interface Scope {
  collection?: string
  id?: string
}

/** The part of the engine's API this reads with, so a test can hand it a small one. */
export interface PageReader {
  ws: { root: string }
  dt: {
    Store: new (ws: any) => {
      descriptors: Map<string, any>
      readAll(collection: string): Iterable<{ id: string; file: string; fields: Record<string, unknown> }>
    }
    fieldsOf(descriptor: any): Record<string, any>
    isRuntime(descriptor: any): boolean
    isBinary(descriptor: any): boolean
  }
}

const reason = (err: unknown): string => {
  try {
    const text = err instanceof Error ? err.message : String(err)
    return typeof text === "string" && text !== "" ? text.split("\n")[0].slice(0, 200) : "no reason given"
  } catch {
    return "no reason given"
  }
}

/**
 * The pages in `scope` and their lines. `pages` counts the non-empty string values read over html fields;
 * collections are read in the order of their names, records in the order of their ids, fields in the order
 * the collection declares them. System collections and collections of files hold no page.
 */
export function readPages({ ws, dt }: PageReader, scope: Scope = {}): { pages: number; warnings: PageWarning[] } {
  const warnings: PageWarning[] = []
  let pages = 0
  const line = (file: string, ref: string, field: string, construct: string, effect: string, detail: string) => {
    const said = `${construct} ${effect} (${detail})`
    warnings.push({ file, ref, field, construct, effect, detail, message: field ? `${field}: ${said}` : said })
  }
  const fromRoot = (file: string) => path.relative(ws.root, file).split(path.sep).join("/")

  const store = new dt.Store(ws)
  const names = [...store.descriptors.keys()].filter(n => scope.collection === undefined || n === scope.collection)
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const name of names) {
    const descriptor = store.descriptors.get(name)
    if (dt.isRuntime(descriptor) || dt.isBinary(descriptor)) continue
    const declared = dt.fieldsOf(descriptor)
    const fields = htmlFieldsOf(declared)
    if (!fields.length) continue
    const descriptorFile = `.dreamteamer/collections/${name}.collection.yaml`

    for (const field of fields)
      if (typeof declared[field]?.maxLength !== "number")
        line(
          descriptorFile,
          name,
          field,
          "field",
          "declares no maxLength: only the app's own ceiling holds",
          `collection ${name}`
        )

    let rows: { id: string; file: string; fields: Record<string, unknown> }[]
    try {
      rows = [...store.readAll(name)]
    } catch (err) {
      line(descriptorFile, name, "", `collection ${name}`, "could not be read", reason(err))
      continue
    }
    if (scope.id !== undefined) rows = rows.filter(r => r.id === scope.id)
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    for (const row of rows) {
      for (const field of fields) {
        const value = row.fields?.[field]
        if (typeof value !== "string" || value === "") continue
        pages++
        const file = fromRoot(row.file)
        const ref = `${name}/${row.id}`
        if (value.length > CEILING) {
          line(file, ref, field, "page", "too large to read", `${value.length} characters, over ${CEILING}`)
          continue
        }
        const found = htmlWarnings(value)
        const listed = found.length > LINES_PER_PAGE ? LINES_PER_PAGE : found.length
        for (let i = 0; i < listed; i++) line(file, ref, field, found[i].construct, found[i].effect, found[i].detail)
        if (found.length > listed)
          line(file, ref, field, `${found.length - listed} more`, "not listed", `the first ${LINES_PER_PAGE} are above`)
      }
    }
  }
  return { pages, warnings }
}

/** The lines alone: what `dt check` prints, and what `dt html check` prints for a scope. */
export function pageWarnings(reader: PageReader, scope?: Scope): PageWarning[] {
  return readPages(reader, scope).warnings
}
