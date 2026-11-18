// notebooklm — the engine extension. Two contributions, both about one consumer that is not a coding
// agent:
//   commands.notebooklm   `dt notebooklm …` — render the workspace as NotebookLM sources, optionally sync
//   harnesses.notebooklm  NOTEBOOKLM.md's managed block, on every compile while the harness is enabled
// The engine hands `activate` its own public API; nothing here imports the engine.
import type { Workspace } from "dreamteamer"
import { bind, type Api } from "./engine.ts"
import { notebooklmCommand, USAGE } from "./export.ts"
import { render } from "./harness.ts"

export const apiVersion = 1

import { SETUP_UNIT } from "../lib/notebooklmSetup.ts"
// Not annotated as the engine's Contribution: the installed declarations (0.49) predate `setup`.
export default function activate(dt: Api) {
  bind(dt)
  return {
    setup: [SETUP_UNIT],
    commands: { notebooklm: { usage: USAGE, run: (ws: Workspace, argv: string[]) => notebooklmCommand(ws, argv) } },
    harnesses: { notebooklm: render },
  }
}
