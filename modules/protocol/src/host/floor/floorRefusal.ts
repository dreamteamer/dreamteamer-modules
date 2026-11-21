import { parseVersion } from "./parseVersion.ts"

export const ALLOW_BELOW_FLOOR_SETTING = "dreamteamer.engine.allowBelowFloor"

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
