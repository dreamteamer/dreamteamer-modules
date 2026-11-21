import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { QUIET } from "../repoState.ts"

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
