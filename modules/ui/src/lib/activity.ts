/**
 * `GET /activity` — git history as named entries (host `src/activity.ts`), and how the Activity page groups them:
 * by local day, newest first, the order they arrive in. A page is answered before its slowest repository is
 * read — `pending` names those still being read, and the asker repeats with `settled` until it is empty.
 */
export interface ActivityRecord {
  collection: string
  id: string
  title?: string
}

export interface ActivityEntry {
  sha: string
  repo: string
  /** The repo's name — its folder's name, the workspace's own name for `.`. */
  source: string
  author: string
  date: string
  subject: string
  records: ActivityRecord[]
  files: number
}

export interface Activity {
  module: string | null
  scopes: Array<{ repo: string; paths: string[] }>
  entries: ActivityEntry[]
  offset: number
  hasMore: boolean
  pending: string[]
  failed: string[]
  settled: number
}

/** Entries by day (`dayOf` names a day — the locale's date in the app), in arrival order. */
export function byDay(
  entries: readonly ActivityEntry[],
  dayOf: (iso: string) => string
): Array<{ day: string; entries: ActivityEntry[] }> {
  const out: Array<{ day: string; entries: ActivityEntry[] }> = []
  for (const e of entries) {
    const day = dayOf(e.date)
    const last = out[out.length - 1]
    if (last && last.day === day) last.entries.push(e)
    else out.push({ day, entries: [e] })
  }
  return out
}

/** What a commit touched beyond the chips it draws: `+N more` records, `N other files`. */
export function entryRest(e: Pick<ActivityEntry, "records" | "files">, shown: number): { more: number; other: number } {
  return { more: Math.max(0, e.records.length - shown), other: Math.max(0, e.files - e.records.length) }
}
