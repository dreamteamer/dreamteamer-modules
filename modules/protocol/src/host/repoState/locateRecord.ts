import type { Located } from "../repoState.ts"

export function locateRecord(
  store: { locate?: (c: string, id: string) => Located },
  collection: string,
  id: string
): Located | null {
  if (typeof store?.locate !== "function") return null
  try {
    return store.locate(collection, id)
  } catch {
    return null
  }
}
