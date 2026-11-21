import { type UiView, type ViewDisplay, viewCollection, viewLabel } from "../fsdata.ts"

export function viewDisplay(v: UiView): ViewDisplay {
  return v.compiled?.display ?? v.display ?? {}
}

export function viewRow(v: UiView): {
  label: string
  icon: string
  description?: string
  tooltip: string
} {
  const layout = viewDisplay(v).list?.layout
  return {
    label: viewLabel(v),
    icon: v.display?.nav?.icon ?? "bookmark",
    description: layout && layout !== "table" ? layout : undefined,
    tooltip: `\`${v.route}\`  \n_saved view of ${viewCollection(v)}_`,
  }
}
