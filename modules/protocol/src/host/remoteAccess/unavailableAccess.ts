import { NOT_AVAILABLE, type AccessTarget, type OwnAccess } from "../remoteAccess.ts"

/** What a host with no provider answers `GET /sources/access`: every target not checked, and why. */
export function unavailableAccess(targets: AccessTarget[]): {
  available: false
  access: Record<string, OwnAccess>
} {
  return {
    available: false,
    access: Object.fromEntries(targets.map(t => [t.source, { state: "not-checked", reason: NOT_AVAILABLE }])),
  }
}
