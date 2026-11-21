// Ported from the dreamteamer VS Code extension's host side (src/floor.ts); PROTOCOL.md is the contract it answers.
import { floorRefusal } from "./floor/floorRefusal.ts"
export { ALLOW_BELOW_FLOOR_SETTING, floorRefusal, installSpecFor } from "./floor/floorRefusal.ts"
export { meetsFloor } from "./floor/meetsFloor.ts"
export { parseVersion } from "./floor/parseVersion.ts"

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

export const ENGINE_TOO_OLD_KEY = "dreamteamer.engineTooOld"

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
