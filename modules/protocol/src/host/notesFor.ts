import { engine } from "./engine.ts"
import { refsIn } from "./refsIn.ts"
import type { NextNote } from "./nextNotes.ts"

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
