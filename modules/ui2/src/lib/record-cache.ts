/**
 * ONE fetch cache for "give me this record, by reference", and the TITLES it answers — shared by every relation
 * cell, the relation picker's chips and the hover card (ported from @dreamteamer/ui's lib/record-cache.ts and
 * lib/record-titles.ts).
 *
 * A plain module, not a hook's state: a column of 90 rows naming 20 distinct records issues 20 requests, not
 * 90. A failure resolves to null rather than rejecting, so a stale reference neither wedges the cache nor
 * re-fires on every render.
 *
 * ⚠ The cache follows the app's invalidation counter (`version`): a caller hands the version it renders under,
 * and a new one drops every fetched record — STALE-WHILE-REVALIDATE for the titles, which stay drawn until the
 * new ones land, so no cell flashes back to its bare reference after a write.
 *
 * ⚠ ONE HOP: a target's own `record_title` renders with no resolver.
 */
import { getRecord } from "../api/client.ts"
import type { Schema } from "./schema.ts"
import { recordLabel, splitRef } from "./schema.ts"
import { signal } from "./signal.ts"

export interface FetchedRecord {
  id: string
  collection: string
  fields: Record<string, unknown>
}

const records = new Map<string, Promise<FetchedRecord | null>>()
let cachedVersion: number | null = null

/** Forget every fetched record when the workspace changed under it. */
function sync(version: number): void {
  if (cachedVersion === version) return
  cachedVersion = version
  records.clear()
  asked.clear()
}

export function fetchRecord(collection: string, id: string, version: number): Promise<FetchedRecord | null> {
  sync(version)
  const key = `${collection}/${id}`
  let promise = records.get(key)
  if (!promise) {
    promise = getRecord(collection, id).then(
      doc => (doc ? { id: doc.id ?? id, collection, fields: doc.fields ?? {} } : null),
      () => null
    )
    records.set(key, promise)
  }
  return promise
}

/** reference → the target's rendered title; bumped on every landing so subscribers re-render. */
const titles = new Map<string, string>()
const asked = new Set<string>()
/** A counter React subscribes to (`useSignal(referenceTitlesChanged)`): it moves whenever a title lands. */
export const referenceTitlesChanged = signal(0)

const bare = (ref: string): string => ref.replace(/^\/+/, "")

/** A reference's title when one has landed, else null (the caller draws its fallback meanwhile). Pure read. */
export function knownTitle(ref: string): string | null {
  return titles.get(bare(ref)) ?? null
}

/**
 * Start fetching the titles of `refs` not yet asked under `version`. A reference that names no collection of
 * the schema is left alone; one whose record is gone loses a title it had (a refresh agrees with the disk).
 */
export function askTitles(refs: readonly string[], schema: Schema, version: number): void {
  sync(version)
  for (const raw of refs) {
    const ref = bare(raw)
    if (asked.has(ref)) continue
    const at = splitRef(ref, schema.names)
    if (!at) continue
    asked.add(ref)
    const asOf = version
    void fetchRecord(at.collection, at.id, version).then(rec => {
      if (cachedVersion !== asOf) return
      const before = titles.get(ref)
      if (!rec) titles.delete(ref)
      else titles.set(ref, recordLabel(schema.collection(at.collection), rec.fields, at.id))
      if (titles.get(ref) !== before) referenceTitlesChanged.set(referenceTitlesChanged.get() + 1)
    })
  }
}

/** The de-slugged last segment of a reference — what a relation draws until (or unless) its title lands. */
export function refStem(ref: string): string {
  const last = bare(ref).split("/").pop() ?? ref
  const dot = last.indexOf(".")
  return dot > 0 ? last.slice(0, dot) : last
}
