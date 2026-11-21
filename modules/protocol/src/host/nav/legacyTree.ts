import type { Descriptor } from "../fsdata.ts"
import { navHiddenOf, navOrderOf, type NavEntry } from "../nav.ts"
import { groupTopLevel } from "./groupTopLevel.ts"
import { navGroupsOf } from "./navGroupsOf.ts"
import { navKey } from "./navKey.ts"
import { orderTopLevel } from "./orderTopLevel.ts"

export function withoutHidden(entries: NavEntry[], hidden?: readonly string[]): NavEntry[] {
  if (!hidden?.length) return entries
  const names = new Set(hidden.map(n => n.trim().toLowerCase()))
  return entries.filter(e => !names.has(navKey(e).toLowerCase()))
}

/**
 * The tree the old settings drew: groupTopLevel → orderTopLevel → withoutHidden, unchanged.
 * @param {Array} descriptors
 * @param {{ navGroups?: unknown, navOrder?: unknown, navHidden?: unknown }} settings
 * @param {{ declared?: string[], workspaceModule?: string, dependsOn?: Map, namespacesOf?: Map, titleOf?: Map }} ctx
 */
export function legacyTree(
  descriptors: Descriptor[],
  settings: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown } = {},
  ctx: {
    declared?: string[]
    workspaceModule?: string
    dependsOn?: Map<string, string[]>
    namespacesOf?: Map<string, string[]>
    titleOf?: Map<string, string | undefined>
  } = {}
): NavEntry[] {
  const { top, folders } = groupTopLevel(
    descriptors,
    ctx.declared ?? [],
    ctx.workspaceModule,
    ctx.dependsOn,
    navGroupsOf(settings?.navGroups),
    ctx.namespacesOf,
    ctx.titleOf ?? new Map()
  )
  return withoutHidden(orderTopLevel(top, folders, navOrderOf(settings?.navOrder)), navHiddenOf(settings?.navHidden))
}
