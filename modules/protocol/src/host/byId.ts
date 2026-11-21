import type { NextNote } from "./nextNotes.ts"

export function byId(notes: NextNote[]): Map<string, NextNote[]> {
  const out = new Map()
  for (const n of notes) {
    if (n.id == null) continue
    if (!out.has(n.id)) out.set(n.id, [])
    out.get(n.id).push(n)
  }
  return out
}
