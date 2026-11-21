import type { Version } from "../floor.ts"

export function parseVersion(raw: unknown): Version | null {
  if (typeof raw !== "string") return null
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?\s*$/.exec(raw)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null }
}
