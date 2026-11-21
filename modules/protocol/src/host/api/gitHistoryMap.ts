import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { GIT_SYNC } from "../gitExec.ts"
import type { FileHistory } from "../api.ts"
import { parseGitHistory } from "./parseGitHistory.ts"

export function gitHistoryMap(
  root: string,
  dirs: string[],
  repoOf: (dir: string) => string = () => "."
): Map<string, FileHistory> {
  const map = new Map<string, FileHistory>()
  const byRepo = new Map<string, string[]>()
  for (const dir of dirs) {
    if (path.relative(root, dir).startsWith("..")) continue
    const repo = repoOf(dir)
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), dir])
  }
  for (const [repo, repoDirs] of byRepo) {
    const cwd = path.join(root, repo)
    const rels = repoDirs.map(dir => path.relative(cwd, dir)).filter(rel => rel && !rel.startsWith(".."))
    if (!rels.length) continue
    let out
    try {
      out = execFileSync("git", ["log", "--format=%x01%aI%x02%an", "--name-only", "--relative", "--", ...rels], {
        cwd,
        ...GIT_SYNC,
      }).toString()
    } catch {
      continue
    }
    parseGitHistory(out, line => (repo === "." ? line : path.relative(root, path.join(cwd, line))), map)
  }
  return map
}
