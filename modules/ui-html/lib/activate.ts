// ui-html's engine extension. Two contributions: to `dt check`, a line for every construct in a page that the
// desktop app's frame will not run or load (lib/pageWarnings.ts); and a verb, `dt html`, that prints those
// lines for one scope and prints a page as text (lib/htmlCommand.ts).
//
// Every line is a warning: printed, never counted. The frame is what keeps a page from acting, so a page is
// never a violation, and a workspace's count and exit code are what they are without this module. For that
// to hold whatever happens, the whole call is wrapped: an error becomes one warning line too, because the
// engine counts a check that throws as a violation.
//
// A warning needs the engine's warning channel (`dt.CHECK_WARNINGS`): an engine without it counts every item
// a check returns as a violation, so on one this says nothing.
import type { Contribution, ExtensionContext } from "dreamteamer"
import { htmlCommand, USAGE } from "./htmlCommand.ts"
import { pageWarnings, type PageReader } from "./pageWarnings.ts"

export const apiVersion = 1

/** A `dt check` item that is printed and never counted. */
export interface Warning {
  file?: string
  message: string
  warning: true
}

function why(err: unknown): string {
  try {
    const text = err instanceof Error ? err.message : String(err)
    return typeof text === "string" && text !== "" ? text.split("\n")[0].slice(0, 200) : "no reason given"
  } catch {
    return "no reason given"
  }
}

/**
 * The exit code, once everything written has left the process. The engine exits as soon as a verb returns,
 * and what is still waiting to be written to a pipe is lost then: a page as text is often longer than a
 * pipe holds.
 */
const written = (code: number) =>
  new Promise<number>(resolve => {
    const done = () => resolve(code)
    try {
      process.stdout.write("", () => {
        try {
          process.stderr.write("", done)
        } catch {
          done()
        }
      })
    } catch {
      done()
    }
  })

export default function activate(
  dt: ExtensionContext["dt"]
): Omit<Contribution, "check"> & { check(ctx: ExtensionContext): Warning[] } {
  return {
    commands: {
      html: {
        usage: USAGE,
        run: (ws: { root: string }, argv: string[]) =>
          written(htmlCommand(ws, argv, { dt: dt as unknown as PageReader["dt"] })),
      },
    },
    check(ctx: ExtensionContext): Warning[] {
      try {
        const api = ctx?.dt ?? dt
        if (api?.CHECK_WARNINGS !== true) return []
        const reader = { ws: ctx.ws, dt: api } as unknown as PageReader
        return pageWarnings(reader).map(w => ({ file: w.file, message: w.message, warning: true as const }))
      } catch (err) {
        return [{ message: `the page check could not run: ${why(err)}`, warning: true }]
      }
    },
  }
}
