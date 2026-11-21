/** `dreamteamer.navGroups` as a Map — module ids per group label; anything else is empty. */
export function navGroupsOf(raw: unknown): Map<string, string[]> {
  const out = new Map()
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [key, ids] of Object.entries(raw))
    if (Array.isArray(ids))
      out.set(
        key,
        ids.filter(i => typeof i === "string")
      )
  return out
}
