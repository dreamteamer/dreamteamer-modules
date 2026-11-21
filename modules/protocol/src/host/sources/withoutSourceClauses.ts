export function withoutSourceClauses(filter: unknown): unknown {
  const isSource = (c: unknown) =>
    !!c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 1 && "$source" in c
  if (isSource(filter)) return undefined
  if (
    filter &&
    typeof filter === "object" &&
    !Array.isArray(filter) &&
    Array.isArray((filter as Record<string, unknown>)._and) &&
    Object.keys(filter).length === 1
  ) {
    const rest = ((filter as Record<string, unknown>)._and as unknown[]).filter(c => !isSource(c))
    return rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { _and: rest }
  }
  return filter
}
