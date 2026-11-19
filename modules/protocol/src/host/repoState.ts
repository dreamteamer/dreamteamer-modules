// Ported from the dreamteamer VS Code extension's host side (src/repo-state.ts); PROTOCOL.md is the contract it answers.
import { execFileSync } from "node:child_process"
import { GIT_SYNC } from "./gitExec.ts"
import * as path from "node:path"

export interface Located {
  file: string
  repo: string | null
}
export const REPO_KEY = "$repo"
export const DIRTY_KEY = "$dirty"
export const AHEAD_KEY = "$ahead"
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
const AHEAD_TTL_MS = 2000
const aheadCache = new Map()
export function forgetAhead(): void {
  aheadCache.clear()
}
const QUIET = GIT_SYNC
export function aheadOf(repoAbs: string, now: number = Date.now()): number | null {
  const hit = aheadCache.get(repoAbs)
  if (hit && now - hit.at < AHEAD_TTL_MS) return hit.value
  let value = null
  try {
    const out = execFileSync("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd: repoAbs, ...QUIET })
      .toString()
      .trim()
    value = /^\d+$/.test(out) ? Number(out) : null
  } catch {
    value = null
  }
  aheadCache.set(repoAbs, { at: now, value })
  return value
}
export function isDirty(repoAbs: string, fileAbs: string): boolean {
  try {
    const rel = path.relative(repoAbs, fileAbs).split(path.sep).join("/")
    return (
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", rel], { cwd: repoAbs, ...QUIET })
        .toString()
        .trim() !== ""
    )
  } catch {
    return false
  }
}
export function repoStateKeys(root: string, located: Located | null): Record<string, unknown> {
  if (!located) return {}
  if (located.repo === null) return { [REPO_KEY]: null }
  const repoAbs = path.resolve(root, located.repo)
  return {
    [REPO_KEY]: located.repo,
    [DIRTY_KEY]: isDirty(repoAbs, path.resolve(root, located.file)),
    [AHEAD_KEY]: aheadOf(repoAbs),
  }
}
