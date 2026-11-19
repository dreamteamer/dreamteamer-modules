// @dreamteamer/files — the engine extension entry. `activate(dt)` receives the running engine's
// public API; the same package.json key makes this package a content module, so compile also
// discovers its collections, views, skill, command and binding.
import type { ExtensionContext, Workspace } from "dreamteamer"
import { bind, type Api } from "./engine.ts"
import { filesCommand, USAGE } from "./cli.ts"
import "./sync.ts" // registers filesCommand.handlers.sync
import { doctorFiles } from "./status.ts" // also registers filesCommand.handlers.status
import { checkFiles } from "./checkFiles.ts"
import { SETUP_UNIT } from "../lib/filesSetup.ts"

export const apiVersion = 1

// Not annotated as the engine's Contribution: the installed declarations (0.49) predate `setup`.
export default function activate(api: Api) {
  bind(api)
  return {
    setup: [SETUP_UNIT],
    commands: { files: { usage: USAGE, run: (ws: Workspace, argv: string[]) => filesCommand(ws, argv) } },
    check: (ctx: ExtensionContext) => checkFiles(ctx),
    doctor: (ctx: ExtensionContext) => doctorFiles(ctx),
  }
}
