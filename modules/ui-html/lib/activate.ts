// ui-html's engine extension. One contribution to `dt check`: a line for every construct in a page that the
// desktop app's frame will not run or load (lib/pageWarnings.ts).
//
// Every line is a warning: printed, never counted. The frame is what keeps a page from acting, so a page is
// never a violation, and a workspace's count and exit code are what they are without this module. For that
// to hold whatever happens, the whole call is wrapped: an error becomes one warning line too, because the
// engine counts a check that throws as a violation.
//
// A warning needs the engine's warning channel (`dt.CHECK_WARNINGS`): an engine without it counts every item
// a check returns as a violation, so on one this says nothing.
import type { Contribution, ExtensionContext } from "dreamteamer"
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

export default function activate(
  dt: ExtensionContext["dt"]
): Omit<Contribution, "check"> & { check(ctx: ExtensionContext): Warning[] } {
  return {
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
