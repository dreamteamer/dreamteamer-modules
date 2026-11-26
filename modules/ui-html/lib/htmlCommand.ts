// dt html — the two things a person or an agent does with a page from the command line.
//
//   dt html check [<collection>[/<id>]] [--json]   dt check's page warnings for one scope, then a count
//   dt html text <collection>/<id> [<field>]       a page as the text a reader gets from it
//
// `check` never fails a page: it exits 0 with or without warnings, as dt check does not count them. What
// exits 2 is a scope that matches nothing, said in one line, so a typo is not read as "no warnings".
import { htmlFieldsOf } from "./htmlFields.ts"
import { htmlToText } from "./htmlToText.ts"
import { readPages, type PageReader, type Scope } from "./pageWarnings.ts"

export const USAGE = [
  "  html check [<collection>[/<id>]] [--json]   (the page warnings dt check prints, for every page, one",
  "                                               collection or one record, then how many pages were",
  "                                               read and how many warnings. A page is the value of",
  "                                               an html field. Exit 0 with or without warnings)",
  "  html text <collection>/<id> [<field>]       (a record's page as text: what a reader gets from it,",
  "                                               with no tag. Name the field when the collection has",
  "                                               several html fields)",
  "                                              Exit 2, with one line saying which: a collection or a",
  "                                              record that does not exist, a collection with no html",
  "                                              field, a field that is not one",
].join("\n")

/** Where the verb reads the engine's API and writes: `dt` from `activate`, the writers from a test. */
export interface HtmlIo {
  dt?: PageReader["dt"]
  out?: (text: string) => void
  err?: (text: string) => void
}

/** A refusal: the one line, and exit 2. */
class Refusal extends Error {}

// the mark and the dash dt check prints its warning lines with
const MARK = "\u26a0"
const DASH = "\u2014"
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * `<collection>` or `<collection>/<id>`, split at the end of the longest collection name that matches: a
 * collection's name may hold a slash, and so may an id.
 */
function resolve(reference: string, names: string[]): Scope {
  if (names.includes(reference)) return { collection: reference }
  let best = ""
  for (const name of names) if (name.length > best.length && reference.startsWith(`${name}/`)) best = name
  if (best && reference.length > best.length + 1) return { collection: best, id: reference.slice(best.length + 1) }
  throw new Refusal(reference.includes("/") ? `no collection matches "${reference}"` : `no collection "${reference}"`)
}

/** Run `dt html <argv>` in `ws`. Returns the exit code: 0 done, 1 it could not run, 2 nothing to run it on. */
export function htmlCommand(ws: { root: string }, argv: string[], io: HtmlIo = {}): number {
  const out = io.out ?? ((text: string) => void process.stdout.write(text))
  const err = io.err ?? ((text: string) => void process.stderr.write(text))
  try {
    const dt = io.dt
    if (!dt) throw new Error("the engine's API was not handed to the verb")
    const flags = argv.filter(a => a.startsWith("--"))
    const [sub, reference, ...rest] = argv.filter(a => !a.startsWith("--"))
    const unknown = flags.find(f => f !== "--json")
    if (unknown) throw new Refusal(`no flag "${unknown}"`)
    const json = flags.includes("--json")
    if (sub === undefined)
      throw new Refusal(
        "say check or text: dt html check [<collection>[/<id>]] [--json], dt html text <collection>/<id> [<field>]"
      )
    if (sub !== "check" && sub !== "text") throw new Refusal(`no subcommand "${sub}": say check or text`)
    if (sub === "text" && json) throw new Refusal("text takes no --json")
    if (rest.length > (sub === "text" ? 1 : 0)) throw new Refusal("too many arguments")

    const store = new dt.Store(ws)
    const reader = { ws, dt }
    let scope: Scope = {}
    let fields: string[] = []
    if (reference !== undefined) {
      scope = resolve(reference, [...store.descriptors.keys()])
      const descriptor = store.descriptors.get(scope.collection)
      const holdsRecords = !dt.isRuntime(descriptor) && !dt.isBinary(descriptor)
      fields = holdsRecords ? htmlFieldsOf(dt.fieldsOf(descriptor)) : []
      if (!fields.length) throw new Refusal(`collection "${scope.collection}" has no html field`)
    }

    if (sub === "check") {
      if (scope.id !== undefined) recordOf(store, scope)
      const { pages, warnings } = readPages(reader, scope)
      if (json) {
        const rows = warnings.map(w => ({
          ref: w.ref,
          field: w.field,
          construct: w.construct,
          effect: w.effect,
          detail: w.detail,
        }))
        out(JSON.stringify({ pages, warnings: rows }, null, 2) + "\n")
        return 0
      }
      const printed = warnings.map(w => `${MARK} ${w.file} ${DASH} ${w.message}\n`)
      printed.push(`${plural(pages, "page")} read, ${plural(warnings.length, "warning")}\n`)
      out(printed.join(""))
      return 0
    }

    if (scope.id === undefined) throw new Refusal("text needs a record: dt html text <collection>/<id> [<field>]")
    const listed = fields.join(", ")
    const named = rest[0]
    if (named !== undefined && !fields.includes(named))
      throw new Refusal(`"${named}" is not an html field of "${scope.collection}" (${listed})`)
    if (named === undefined && fields.length > 1)
      throw new Refusal(`"${scope.collection}" has several html fields: name one (${listed})`)
    const text = htmlToText(recordOf(store, scope).fields?.[named ?? fields[0]])
    if (text !== "") out(text + "\n")
    return 0
  } catch (e) {
    if (e instanceof Refusal) {
      err(`html: ${e.message}\n`)
      return 2
    }
    let why = "it could not run"
    try {
      const said = e instanceof Error ? e.message : String(e)
      if (typeof said === "string" && said !== "") why = said.split("\n")[0]
    } catch {
      // an error that cannot be read is still one line
    }
    err(`html: ${why}\n`)
    return 1
  }
}

/** The record a scope names, or the refusal that says there is none. */
function recordOf(store: InstanceType<PageReader["dt"]["Store"]>, scope: Scope) {
  for (const row of store.readAll(scope.collection)) if (row.id === scope.id) return row
  throw new Refusal(`no record "${scope.collection}/${scope.id}"`)
}
