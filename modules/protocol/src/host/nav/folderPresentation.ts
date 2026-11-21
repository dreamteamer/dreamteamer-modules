import { MODULE_ICON, PLAIN_FOLDER_ICON, rowMarks } from "../nav.ts"

export function folderPresentation(
  module: string | undefined,
  about?: string,
  opts: {
    icon?: string
    shared?: boolean
  } = {}
): Record<string, any> {
  const marks = rowMarks({ module: Boolean(module), shared: opts.shared })
  if (!module) return { icon: PLAIN_FOLDER_ICON, ...(about ? { tooltip: about } : {}), ...(marks ? { marks } : {}) }
  return {
    icon: opts.icon ?? MODULE_ICON,
    tooltip: `${about ? `${about} — ` : ""}module ${module} · click for its page`,
    route: moduleRoute(module),
    ...(marks ? { marks } : {}),
  }
}

export function moduleRoute(id: string): string {
  return `/settings/schema/activity?module=${encodeURIComponent(id)}`
}
