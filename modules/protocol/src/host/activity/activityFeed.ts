import {
  ACTIVITY_READ_RETENTION_MS,
  repoName,
  type ActivityPage,
  type ActivityRecord,
  type ActivityScope,
  type LogEntries,
  type ScopeRead,
} from "../activity.ts"
import { readLog } from "./readLog.ts"

function startRead(read: () => Promise<LogEntries>): ScopeRead {
  const r: ScopeRead = { state: "reading", entries: [], settled: Promise.resolve(), at: Date.now() }
  r.settled = (async () => {
    try {
      r.entries = await read()
      r.state = "done"
    } catch {
      r.state = "failed"
    }
    r.at = Date.now()
  })()
  return r
}

export async function activityFeed(
  root: string,
  scopes: ActivityScope[],
  page: {
    limit: number
    offset: number
    workspace: string
    settled?: number
  },
  recordOf: (workspaceRel: string) => ActivityRecord | undefined,
  opts: {
    read?: (scope: ActivityScope, limit: number) => Promise<LogEntries>
    reads?: Map<string, ScopeRead>
    budgetMs?: number
    graceMs?: number
    previous?: ActivityPage
  } = {}
): Promise<ActivityPage> {
  const { limit, offset, workspace, settled: known } = page
  const read = opts.read ?? ((s: ActivityScope, n: number) => readLog(root, s, n))
  const reads = opts.reads ?? new Map<string, ScopeRead>()
  for (const [key, r] of reads)
    if (r.state !== "reading" && Date.now() - r.at > ACTIVITY_READ_RETENTION_MS) reads.delete(key)
  const n = offset + limit + 1
  const mine = scopes.map(scope => {
    const key = `${scope.repo}\0${scope.paths.join("\0")}\0${n}`
    let r = reads.get(key)
    if (!r || (known === undefined && r.state !== "reading")) reads.set(key, (r = startRead(() => read(scope, n))))
    return { scope, r }
  })
  const settledCount = () => mine.filter(m => m.r.state !== "reading").length
  if (settledCount() < mine.length) {
    await new Promise<void>(resolve => {
      let over = false
      let grace: NodeJS.Timeout | undefined
      const budget = opts.budgetMs === undefined ? undefined : setTimeout(finish, opts.budgetMs)
      function finish() {
        over = true
        clearTimeout(budget)
        clearTimeout(grace)
        resolve()
      }
      const check = () => {
        if (over) return
        const count = settledCount()
        if (count === mine.length) return finish()
        if (opts.graceMs !== undefined && count > (known ?? 0) && !grace) grace = setTimeout(finish, opts.graceMs)
      }
      for (const m of mine) void m.r.settled.then(check)
      check()
    })
  }
  if (known !== undefined && opts.previous?.settled === settledCount()) return opts.previous
  const seen = new Set()
  const all = mine
    .filter(m => m.r.state === "done")
    .flatMap(m => m.r.entries)
    .filter(e => (seen.has(`${e.repo} ${e.sha}`) ? false : (seen.add(`${e.repo} ${e.sha}`), true)))
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const entries = all.slice(offset, offset + limit).map(({ paths, ...e }) => {
    const records = []
    const keys = new Set()
    for (const p of paths) {
      const r = recordOf(p)
      if (!r || keys.has(`${r.collection}/${r.id}`)) continue
      keys.add(`${r.collection}/${r.id}`)
      records.push(r)
    }
    return { ...e, source: repoName(e.repo, workspace), records, files: paths.length }
  })
  const named = (state: string) => [
    ...new Set(mine.filter(m => m.r.state === state).map(m => repoName(m.scope.repo, workspace))),
  ]
  return {
    entries,
    hasMore: all.length > offset + limit,
    pending: named("reading"),
    failed: named("failed"),
    settled: settledCount(),
  }
}
