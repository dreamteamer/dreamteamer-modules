const TOKEN_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bATATT[A-Za-z0-9_\-=]{20,}/g,
  /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=._-]{16,}/g,
]

/**
 * Every string in `value` with each FULL token shape — and each exact value in `extra` (eight characters
 * or more) — replaced by `[redacted]`. Full shapes only, so a name a provider reports (`ghp_tools`,
 * `Basic Users`) reaches the screen as reported. The second line, never the first: a provider's text is
 * not forwarded in the first place.
 */
export function redactSecrets<T>(value: T, extra: string[] = []): T {
  const exact = extra.filter(s => typeof s === "string" && s.length >= 8)
  const scrub = (s: string) => {
    let out = s
    for (const e of exact) out = out.split(e).join("[redacted]")
    for (const re of TOKEN_SHAPES) out = out.replace(re, "[redacted]")
    return out
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}
