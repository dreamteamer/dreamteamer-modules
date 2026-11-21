import { execFileSync } from "node:child_process"
import { QUIET, aheadCache } from "../repoState.ts"

const AHEAD_TTL_MS = 2000

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
