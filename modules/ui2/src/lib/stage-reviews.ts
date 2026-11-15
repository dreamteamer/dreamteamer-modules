/**
 * THE REVIEWS A LIST'S STAGE CHECKS READ — fetched once per list, never once per cell (ported from
 * @dreamteamer/ui's lib/stage-reviews.ts).
 *
 * A plain module, for the record cache's reason: a table of 50 rows must cost one request, not 50. Every call
 * made in one microtask joins ONE request per collection — the union of the subjects asked for, as
 * `filter={"subject":{"_in":[…]}}` — and each caller gets the reviews of ITS subjects. Three rules, each a defect
 * ui's first draft had:
 *
 *   - `limit=ALL`: a list request with no limit is paged, and a list with more reviews than a page lost checks.
 *   - an empty set issues NO request: `_in: []` would read the whole collection.
 *   - a finding's `review` holds the review's REFERENCE, so the findings filter is built from references; the
 *     counts come back keyed by the bare id the review rows carry.
 *
 * A failed batch rejects every caller that joined it and caches nothing, so the next render retries. The caches
 * follow the app's invalidation counter: a caller hands its `version`, and a new one drops both.
 */
import { listRecords } from "../api/client.ts"
import { ALL } from "./page-size.ts"
import { bareRef, type Review } from "./stage-checks.ts"

interface Batch<T> {
  keys: Set<string>
  waiters: Array<{ resolve: (v: Map<string, T>) => void; reject: (e: unknown) => void }>
}

function batcher<T>(
  load: (collection: string, keys: string[], extra: string) => Promise<Map<string, T>>,
  empty: () => T
) {
  const cache = new Map<string, Promise<T>>()
  const pending = new Map<string, Batch<T>>()

  function flush(scope: string, collection: string, extra: string): void {
    const batch = pending.get(scope)!
    pending.delete(scope)
    load(collection, [...batch.keys], extra).then(
      found => {
        for (const w of batch.waiters) w.resolve(found)
      },
      err => {
        for (const k of batch.keys) cache.delete(`${scope}\0${k}`)
        for (const w of batch.waiters) w.reject(err)
      }
    )
  }

  function get(collection: string, keys: string[], extra = ""): Promise<T[]> {
    const scope = `${collection}\0${extra}`
    const missing = keys.filter(k => !cache.has(`${scope}\0${k}`))
    if (missing.length) {
      let batch = pending.get(scope)
      if (!batch) {
        batch = { keys: new Set(), waiters: [] }
        pending.set(scope, batch)
        queueMicrotask(() => flush(scope, collection, extra))
      }
      for (const k of missing) batch.keys.add(k)
      const joined = batch
      const all = new Promise<Map<string, T>>((resolve, reject) => joined.waiters.push({ resolve, reject }))
      for (const k of missing)
        cache.set(
          `${scope}\0${k}`,
          all.then(m => m.get(k) ?? empty())
        )
    }
    return Promise.all(keys.map(k => cache.get(`${scope}\0${k}`)!))
  }

  return { get, clear: () => cache.clear() }
}

async function listAll(collection: string, filter: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const page = await listRecords(collection, { limit: ALL, filter })
  return Array.isArray(page?.records) ? page.records : []
}

const reviews = batcher<Review[]>(
  async (collection, subjects) => {
    const out = new Map<string, Review[]>()
    for (const r of await listAll(collection, { subject: { _in: subjects } })) {
      const key = bareRef(r["subject"])
      if (!out.has(key)) out.set(key, [])
      out.get(key)!.push({ ...(r as unknown as Review), id: String(r["id"] ?? ""), subject: key })
    }
    return out
  },
  () => []
)

const findings = batcher<number>(
  async (collection, ids, reviewsFrom) => {
    const out = new Map<string, number>()
    const prefix = `${reviewsFrom}/`
    for (const f of await listAll(collection, {
      review: { _in: ids.map(id => prefix + id) },
      status: { _eq: "open" },
    })) {
      const ref = bareRef(f["review"])
      const id = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
      out.set(id, (out.get(id) ?? 0) + 1)
    }
    return out
  },
  () => 0
)

let cachedVersion: number | null = null
function sync(version: number): void {
  if (cachedVersion === version) return
  cachedVersion = version
  reviews.clear()
  findings.clear()
}

/** The reviews whose `subject` is any of `subjects` (bare references), from `reviewsFrom`. */
export async function reviewsFor(reviewsFrom: string, subjects: string[], version: number): Promise<Review[]> {
  sync(version)
  const keys = [...new Set(subjects.map(bareRef).filter(Boolean))]
  if (!keys.length) return []
  return (await reviews.get(reviewsFrom, keys)).flat()
}

/** How many `open` findings each review has, keyed by the review's bare id (absent = none). */
export async function openFindingsFor(
  findingsFrom: string,
  reviewsFrom: string,
  reviewIds: string[],
  version: number
): Promise<Map<string, number>> {
  sync(version)
  const ids = [...new Set(reviewIds.map(String).filter(Boolean))]
  if (!ids.length) return new Map()
  const counts = await findings.get(findingsFrom, ids, reviewsFrom)
  return new Map(ids.map((id, i) => [id, counts[i]!] as [string, number]).filter(([, n]) => n > 0))
}
