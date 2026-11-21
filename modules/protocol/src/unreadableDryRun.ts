/** A write's `?dry-run` is absent, `true` or `false`; anything else — `yes`, a bare `?dry-run`, a repeat —
 *  is refused rather than read as "no", so a caller who meant a plan never gets a write. */
export function unreadableDryRun(method: string, path: string): string | null {
  if (method === "GET") return null
  const q = String(path).split("?")[1]
  if (q === undefined) return null
  const values = new URLSearchParams(q).getAll("dry-run")
  if (!values.length) return null
  if (values.length === 1 && (values[0] === "true" || values[0] === "false")) return null
  return `${method} ${path.split("?")[0]} does not understand ?dry-run=${values.join("&dry-run=")} — use ?dry-run=true or ?dry-run=false; nothing was written`
}
