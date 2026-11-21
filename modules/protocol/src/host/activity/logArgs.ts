import type { ActivityScope } from "../activity.ts"

export function logArgs(scope: ActivityScope, limit: number): string[] {
  const prefix = scope.repo === "." ? "" : `${scope.repo}/`
  const specs = scope.paths.map(p => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p))
  return [
    "log",
    `-n${limit}`,
    "--format=%x01%H%x02%aI%x02%an%x02%s",
    "--name-only",
    ...(specs.length ? ["--", ...specs] : []),
  ]
}
