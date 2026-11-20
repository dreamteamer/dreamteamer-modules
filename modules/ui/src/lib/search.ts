/**
 * ONE SEARCH (cr-modules-022) — the browser shell's Cmd/Ctrl-K. The protocol has no cross-collection search route, so
 * this asks each collection the nav lists, a few collections at a time, and ranks what comes back: a title that starts
 * with the term, then one with a word that does, then one that contains it, then a row that matched on another field.
 * A collection that refuses (one that cannot be read, a level) is skipped, never an error.
 *
 * WHY TWO ASKS PER COLLECTION (the follow-up to 0.3.1, where a record was found only if it was among a collection's
 * first few rows): the list's `q` is a substring over the row as JSON — its KEYS included — so a two-letter term like
 * `na` matched every row that has a `name` field, and `limit` then kept the first six rows in the collection's order,
 * whatever their titles. Now:
 *
 *   1. by TITLE — a `filter` of `_icontains` over the fields the collection's `record_title` names (and the id), so a
 *      record whose title matches is found wherever it sits in the collection; the `total` says how many there are,
 *      and past SEARCH_SHOWN_PER_COLLECTION the modal offers "N more in <collection>" (the list, searched).
 *   2. by ANY FIELD — the old `q`, kept for a term only another field holds (an email, a city), with the rows whose
 *      VALUES do not hold the term (a key-only match) dropped.
 */
export interface SearchHit {
  collection: string
  collectionTitle: string
  icon?: string
  id: string
  title: string
  route: string
  rank: number
}
export interface SearchMore {
  collection: string
  collectionTitle: string
  icon?: string
  count: number
  route: string
}
export interface SearchResult {
  hits: SearchHit[]
  more: SearchMore[]
}
export interface SearchTarget {
  collection: string
  title: string
  icon?: string
  /** The fields the collection's `record_title` names — what a title match is asked over (the id is always added). */
  titleFields?: string[]
  titleOf: (record: Record<string, unknown>) => string
}

/** Title matches asked of one collection; the `total` beyond what is shown becomes its "more" row. */
export const SEARCH_TITLE_LIMIT = 20
/** Hits shown per collection — the rest are its "more" row. */
export const SEARCH_SHOWN_PER_COLLECTION = 5
/** Other-field matches asked of one collection. */
export const SEARCH_PER_COLLECTION = 6
export const SEARCH_MAX_HITS = 40
const PARALLEL = 6

/** 0: the title starts with the term · 1: a word of the title does · 2: the title contains it · 3: another field did. */
export function rankTitle(title: string, term: string): number {
  const t = title.toLocaleLowerCase()
  const q = term.trim().toLocaleLowerCase()
  if (!q) return 3
  if (t.startsWith(q)) return 0
  if (t.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q))) return 1
  return t.includes(q) ? 2 : 3
}

/** Best rank first, then shorter titles (a closer match), then by collection and title so the order is stable. */
export function sortHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort(
    (a, b) =>
      a.rank - b.rank ||
      a.title.length - b.title.length ||
      a.collectionTitle.localeCompare(b.collectionTitle) ||
      a.title.localeCompare(b.title)
  )
}

/** The filter that asks for a title match: any title field, or the id, holding the term in any case. */
export function titleFilter(fields: readonly string[], term: string): Record<string, unknown> {
  const names = [...new Set([...fields.filter(f => f && !f.startsWith("$")), "id"])]
  return { _or: names.map(f => ({ [f]: { _icontains: term } })) }
}

/** Whether a row holds the term in one of its VALUES (not only in a key, as `q` also matches). */
export function valuesHold(record: Record<string, unknown>, term: string): boolean {
  const q = term.toLocaleLowerCase()
  const walk = (v: unknown): boolean => {
    if (v == null) return false
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      return String(v).toLocaleLowerCase().includes(q)
    if (Array.isArray(v)) return v.some(walk)
    if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(walk)
    return false
  }
  return Object.entries(record).some(([k, v]) => !k.startsWith("$") && walk(v))
}

type Rows = { records?: Record<string, unknown>[]; total?: number } | null

export async function searchRecords(
  term: string,
  targets: readonly SearchTarget[],
  request: (method: string, path: string) => Promise<unknown>,
  isStale: () => boolean = () => false
): Promise<SearchResult> {
  const q = term.trim()
  if (q.length < 2) return { hits: [], more: [] }
  const byCollection = new Map<string, { hits: SearchHit[]; titleTotal: number }>()
  const tasks: Array<() => Promise<void>> = []
  for (const target of targets) {
    const base = `/collections/${encodeURIComponent(target.collection)}/records`
    const slot = { hits: [] as SearchHit[], titleTotal: 0 }
    byCollection.set(target.collection, slot)
    const add = (record: Record<string, unknown>, byTitle: boolean) => {
      const id = typeof record["id"] === "string" ? record["id"] : ""
      if (!id || slot.hits.some(h => h.id === id)) return
      const title = target.titleOf(record) || id
      // a title ask matched the title or the id: never ranked below a row that matched elsewhere
      const rank = byTitle ? Math.min(rankTitle(title, q), 2) : rankTitle(title, q)
      slot.hits.push({
        collection: target.collection,
        collectionTitle: target.title,
        ...(target.icon ? { icon: target.icon } : {}),
        id,
        title,
        route: `/content/${target.collection}/${id}`,
        rank,
      })
    }
    tasks.push(async () => {
      const filter = encodeURIComponent(JSON.stringify(titleFilter(target.titleFields ?? [], q)))
      const res = (await request("GET", `${base}?filter=${filter}&limit=${SEARCH_TITLE_LIMIT}`)) as Rows
      for (const record of res?.records ?? []) add(record, true)
      slot.titleTotal = typeof res?.total === "number" ? res.total : (res?.records?.length ?? 0)
    })
    tasks.push(async () => {
      const res = (await request("GET", `${base}?q=${encodeURIComponent(q)}&limit=${SEARCH_PER_COLLECTION}`)) as Rows
      // a key-only match (`q` reads the row as JSON) is no match
      for (const record of res?.records ?? []) if (valuesHold(record, q)) add(record, false)
    })
  }
  let next = 0
  const worker = async () => {
    while (next < tasks.length && !isStale()) {
      const task = tasks[next++]!
      try {
        await task()
      } catch {
        // a collection that will not answer is left out
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, worker))
  const hits: SearchHit[] = []
  const more: SearchMore[] = []
  for (const target of targets) {
    const slot = byCollection.get(target.collection)
    if (!slot) continue
    const ranked = sortHits(slot.hits)
    const shown = ranked.slice(0, SEARCH_SHOWN_PER_COLLECTION)
    hits.push(...shown)
    // the title matches the collection holds that are not shown: its total, less the title matches drawn
    const drawnTitles = shown.filter(h => h.rank < 3).length
    const rest = Math.max(slot.titleTotal, ranked.filter(h => h.rank < 3).length) - drawnTitles
    if (rest > 0)
      more.push({
        collection: target.collection,
        collectionTitle: target.title,
        ...(target.icon ? { icon: target.icon } : {}),
        count: rest,
        route: `/content/${target.collection}?search=${encodeURIComponent(q)}`,
      })
  }
  return { hits: sortHits(hits).slice(0, SEARCH_MAX_HITS), more }
}
