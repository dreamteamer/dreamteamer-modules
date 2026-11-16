// notebooklm — the engine extension. Two contributions, both about one consumer that is not a coding
// agent:
//   commands.notebooklm   `dt notebooklm …` — render the workspace as NotebookLM sources, optionally sync
//   harnesses.notebooklm  NOTEBOOKLM.md's managed block, on every compile while the harness is enabled
// The engine hands `activate` its own public API; nothing here imports the engine.
import { bind } from "./engine.ts"
import { notebooklmCommand, USAGE } from "./export.ts"
import { render } from "./harness.ts"

export const apiVersion = 1

import { SETUP_UNIT } from "../lib/notebooklmSetup.ts"
export default function activate(dt) {
  bind(dt)
  return {
    setup: [SETUP_UNIT],
    commands: { notebooklm: { usage: USAGE, run: (ws, argv) => notebooklmCommand(ws, argv) } },
    harnesses: { notebooklm: render },
  }
}
