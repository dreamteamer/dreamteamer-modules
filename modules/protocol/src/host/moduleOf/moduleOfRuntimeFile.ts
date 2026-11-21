export function moduleOfRuntimeFile(rel: string, map: Map<string, string>): string | undefined {
  const exact = map.get(rel)
  if (exact) return exact
  const parts = rel.split("/")
  for (let take = parts.length; take >= 2; take--) {
    const dir = parts.slice(0, take).join("/")
    for (const [file, id] of map) if (file.startsWith(dir + "/")) return id
  }
  return undefined
}
