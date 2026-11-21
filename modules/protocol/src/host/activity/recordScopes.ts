import type { ActivityScope } from "../activity.ts"
import { repoOf } from "./repoOf.ts"

export function recordScopes(root: string, dirs: string[]): ActivityScope[] {
  const byRepo = new Map()
  for (const dir of dirs) {
    const repo = repoOf(root, dir)
    const paths = byRepo.get(repo) ?? []
    if (!paths.includes(dir)) paths.push(dir)
    byRepo.set(repo, paths)
  }
  return [...byRepo].map(([repo, paths]) => ({ repo, paths }))
}
