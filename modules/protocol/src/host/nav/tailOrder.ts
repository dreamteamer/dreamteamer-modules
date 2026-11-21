/** The unplaced-row order: by title, then name. Passed to applyNavOp as its `collections`. */
export function tailOrder(
  descriptors: ReadonlyArray<{ name: string }>,
  titleOf: (d: any) => string = d => d.title ?? d.name
): Set<string> {
  return new Set(
    [...descriptors]
      .map(d => ({ name: d.name, title: String(titleOf(d) ?? d.name) }))
      .sort((a, b) => a.title.localeCompare(b.title, "en") || a.name.localeCompare(b.name, "en"))
      .map(x => x.name)
  )
}
