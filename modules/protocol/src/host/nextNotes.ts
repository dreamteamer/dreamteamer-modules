// Ported from the dreamteamer VS Code extension's host side (src/next-notes.ts); PROTOCOL.md is the contract it answers.
import { engine } from "./engine.ts"
import { refsIn } from "./refsIn.ts"

import type { EngineNote } from "./engine.ts"
import type { NoteRef } from "./refsIn.ts"

export interface NextNote extends EngineNote {
  refs: Array<
    NoteRef & {
      exists: boolean
    }
  >
}
export function notesFor(store: any, collection: string, ids: string[]): NextNote[] {
  const eng = engine()
  if (!ids.length || typeof eng.contributedNotes !== "function") return []
  let raw
  try {
    raw = eng.contributedNotes(eng.ws, collection, ids) ?? []
  } catch {
    return []
  }
  const collections = [...store.descriptors.keys()]
  const known = new Map()
  const exists = (c: string, id: string) => {
    const key = `${c}/${id}`
    if (!known.has(key)) {
      let ok = false
      try {
        store.read(c, id)
        ok = true
      } catch {}
      known.set(key, ok)
    }
    return known.get(key)
  }
  return raw.map(n => ({
    ...n,
    refs: refsIn(n.text, collections).map(r => ({ ...r, exists: exists(r.collection, r.id) })),
  }))
}
export function byId(notes: NextNote[]): Map<string, NextNote[]> {
  const out = new Map()
  for (const n of notes) {
    if (n.id == null) continue
    if (!out.has(n.id)) out.set(n.id, [])
    out.get(n.id).push(n)
  }
  return out
}
