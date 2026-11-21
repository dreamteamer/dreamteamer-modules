import type { SourceEntry } from "../sources.ts"

export function describeSources(sources: SourceEntry[]): {
  description?: string
  detail: string[]
} {
  const foreign = sources.filter(s => s.kind !== "own")
  const holding = foreign.filter(s => s.count > 0)
  const absent = foreign.filter(s => !s.installed)
  const parts = []
  if (holding.length === 1) parts.push(`from ${holding[0].name}`)
  else if (holding.length > 1) parts.push(`from ${holding.length} sources`)
  for (const s of absent) parts.push(`${s.name} not installed`)
  const detail = sources.map(s =>
    s.installed
      ? `${s.name} (${s.kind}) — ${s.count} record${s.count === 1 ? "" : "s"}`
      : `${s.name} (${s.kind}) — not installed`
  )
  return { ...(parts.length ? { description: parts.join(" · ") } : {}), detail }
}
