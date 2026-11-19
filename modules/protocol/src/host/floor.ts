// Ported from the dreamteamer VS Code extension's host side (src/floor.ts); PROTOCOL.md is the contract it answers.

export interface Version {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}
export interface BelowFloorNotice {
  floor: string
  version: string | null
  engineLabel: string
}

export const ALLOW_BELOW_FLOOR_SETTING = "dreamteamer.engine.allowBelowFloor"
export const ENGINE_TOO_OLD_KEY = "dreamteamer.engineTooOld"
export function parseVersion(raw: unknown): Version | null {
  if (typeof raw !== "string") return null
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?\s*$/.exec(raw)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null }
}
export function meetsFloor(version: unknown, floor: string): boolean {
  const have = parseVersion(version)
  const need = parseVersion(floor)
  if (!have || !need) return false
  if (have.major !== need.major) return have.major > need.major
  if (have.minor !== need.minor) return have.minor > need.minor
  return have.patch >= need.patch
}
export function installSpecFor(floor: string): string {
  const v = parseVersion(floor)
  return v ? `dreamteamer@^${v.major}.${v.minor}` : "dreamteamer@latest"
}
export function floorRefusal(o: { floor: string; version: string | null; engineLabel: string }): string {
  const found = o.version ? `at ${o.version}` : "at an unreadable version"
  return (
    `dreamteamer needs engine ${o.floor} or later. ` +
    `This workspace resolves ${o.engineLabel} ${found}. ` +
    `Run \`npm install ${installSpecFor(o.floor)}\` (or update the clone), then Compile and reload. ` +
    `Nothing on disk has been changed. ` +
    `To run below the floor anyway, set \`${ALLOW_BELOW_FLOOR_SETTING}\`.`
  )
}
export class EngineTooOldError extends Error {
  readonly floor: string
  readonly version: string | null
  readonly engineLabel: string
  constructor(o: { floor: string; version: string | null; engineLabel: string }) {
    super(floorRefusal(o))
    this.name = "EngineTooOldError"
    this.floor = o.floor
    this.version = o.version
    this.engineLabel = o.engineLabel
  }
}
