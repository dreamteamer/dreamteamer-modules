/** Whether any of the three old nav settings holds something (an empty array or object counts as unset). */
export function hasNavSettings(
  settings: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown } | undefined
): boolean {
  const set = (v: any) =>
    Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : false
  return Boolean(settings) && (set(settings.navGroups) || set(settings.navOrder) || set(settings.navHidden))
}
