// Ported from the dreamteamer VS Code extension's host side (src/next-notes.ts); PROTOCOL.md is the contract it answers.
import type { EngineNote } from "./engine.ts"
import type { NoteRef } from "./refsIn.ts"
export { byId } from "./byId.ts"
export { notesFor } from "./notesFor.ts"

export interface NextNote extends EngineNote {
  refs: Array<
    NoteRef & {
      exists: boolean
    }
  >
}
