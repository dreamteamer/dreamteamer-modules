import { parseVersion } from "./parseVersion.ts"

export function meetsFloor(version: unknown, floor: string): boolean {
  const have = parseVersion(version)
  const need = parseVersion(floor)
  if (!have || !need) return false
  if (have.major !== need.major) return have.major > need.major
  if (have.minor !== need.minor) return have.minor > need.minor
  return have.patch >= need.patch
}
