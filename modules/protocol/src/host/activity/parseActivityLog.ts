import type { ActivityEntry } from "../activity.ts"

export function parseActivityLog(
  out: string,
  repo: string
): Array<
  Omit<ActivityEntry, "records" | "files" | "source"> & {
    paths: string[]
  }
> {
  const entries = []
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      const [sha = "", date = "", author = "", subject = ""] = line.slice(1).split("\x02")
      entries.push({ sha, repo, author, date, subject, paths: [] })
      continue
    }
    if (line && entries.length) entries[entries.length - 1].paths.push(line)
  }
  return entries
}
