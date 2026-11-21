import type { Entry } from "../navDoc.ts"

/** The name a collection entry places, or undefined for a folder or a namespace entry. */
export const collectionOf = (e: Entry): string | undefined =>
  typeof e === "string"
    ? e
    : e && typeof e === "object" && typeof (e as { collection?: unknown }).collection === "string"
      ? (e as { collection: string }).collection
      : undefined
