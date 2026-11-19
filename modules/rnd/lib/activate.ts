// rnd's engine extension — one contribution, `check`, made of three rules a descriptor cannot say:
//   releases     one release per product, package and version (lib/releases.mjs)
//   stage tags   a change request tagged `deployed` without `deployed_on`, or the reverse — a WARNING
//                (lib/checkStageTags.mjs)
//   stage        a change request whose `stage` is not the gate `dt next` names on it, or contradicts its
//                own status, dates and links — a WARNING (lib/crStage.mjs)
// rnd ships no setup unit: wikis and notebooklm are their own packages, with their own entries.
import type { Contribution, ExtensionContext } from "dreamteamer"
import { checkReleases } from "./releases.ts"
import { checkStageTags } from "./checkStageTags.ts"
import { checkChangeRequestStage } from "./crStage.ts"

export const apiVersion = 1

export default function activate(dt: ExtensionContext["dt"]): Contribution {
  return {
    check: async (ctx: ExtensionContext) => {
      const c = { ...ctx, dt: ctx.dt ?? dt }
      return [
        ...((await checkReleases(c)) ?? []),
        ...((await checkStageTags(c)) ?? []),
        ...((await checkChangeRequestStage(c)) ?? []),
      ]
    },
  }
}
