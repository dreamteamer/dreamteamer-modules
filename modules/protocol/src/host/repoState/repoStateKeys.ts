import * as path from "node:path"
import type { Located } from "../repoState.ts"
import { aheadOf } from "./aheadOf.ts"
import { isDirty } from "./isDirty.ts"

export const REPO_KEY = "$repo"

export const DIRTY_KEY = "$dirty"

export const AHEAD_KEY = "$ahead"

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
