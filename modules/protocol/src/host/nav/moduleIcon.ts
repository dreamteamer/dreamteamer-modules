import type { ModuleRecord } from "../fsdata.ts"

export function moduleIcon(
  module: Pick<ModuleRecord, "collections"> | undefined,
  look: (collection: string) =>
    | {
        icon?: string
        order?: number
        runtime?: boolean
      }
    | undefined
): string | undefined {
  const shipped = (module?.collections ?? [])
    .map((ref, i) => ({ i, ...(look(ref.replace(/^collections\//, "")) ?? {}) }))
    .filter(c => c.icon && !c.runtime)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.i - b.i)
  return shipped[0]?.icon
}
