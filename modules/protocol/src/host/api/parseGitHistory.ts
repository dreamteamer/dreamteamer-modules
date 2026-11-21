import type { FileHistory } from "../api.ts"

export function parseGitHistory(
  out: string,
  keyOf: (line: string) => string,
  into: Map<string, FileHistory> = new Map()
): Map<string, FileHistory> {
  let date = null
  let author = null
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      const [d, a] = line.slice(1).split("\x02")
      date = d || null
      author = a || null
      continue
    }
    if (!line) continue
    const key = keyOf(line)
    const seen = into.get(key)
    if (seen) seen.createdBy = author
    else into.set(key, { modified: date, by: author, createdBy: author })
  }
  return into
}
