// Ported from the dreamteamer VS Code extension's host side (src/activity.ts); PROTOCOL.md is the contract it answers.
import { parseActivityLog } from "./activity/parseActivityLog.ts"
export { activityFeed } from "./activity/activityFeed.ts"
export { logArgs } from "./activity/logArgs.ts"
export { moduleScope } from "./activity/moduleScope.ts"
export { parseActivityLog } from "./activity/parseActivityLog.ts"
export { ACTIVITY_GIT_TIMEOUT_MS, readLog } from "./activity/readLog.ts"
export { recordScopes } from "./activity/recordScopes.ts"
export { repoOf } from "./activity/repoOf.ts"

export interface ActivityRecord {
  collection: string
  id: string
  title?: string
}
export interface ActivityEntry {
  sha: string
  repo: string
  source: string
  author: string
  date: string
  subject: string
  records: ActivityRecord[]
  files: number
}
export interface ActivityScope {
  repo: string
  paths: string[]
}
export type LogEntries = ReturnType<typeof parseActivityLog>
export interface ActivityPage {
  entries: ActivityEntry[]
  hasMore: boolean
  pending: string[]
  failed: string[]
  settled: number
}
export interface ScopeRead {
  state: "reading" | "done" | "failed"
  entries: LogEntries
  settled: Promise<void>
  at: number
}

export function repoName(repo: string, workspace: string): string {
  if (repo === ".") return workspace
  const parts = repo.split("/")
  return parts[parts.length - 1]
}

export const ACTIVITY_PAGE = 20
export const ACTIVITY_BUDGET_MS = 3000
export const ACTIVITY_GRACE_MS = 150
export const ACTIVITY_READ_RETENTION_MS = 60_000
