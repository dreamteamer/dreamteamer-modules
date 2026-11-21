// Ported from the dreamteamer VS Code extension's host side (src/repo-state.ts); PROTOCOL.md is the contract it answers.
import { GIT_SYNC } from "./gitExec.ts"
export { aheadOf } from "./repoState/aheadOf.ts"
export { isDirty } from "./repoState/isDirty.ts"
export { locateRecord } from "./repoState/locateRecord.ts"
export { AHEAD_KEY, DIRTY_KEY, REPO_KEY, repoStateKeys } from "./repoState/repoStateKeys.ts"

export interface Located {
  file: string
  repo: string | null
}

export const aheadCache = new Map()
export function forgetAhead(): void {
  aheadCache.clear()
}
export const QUIET = GIT_SYNC
