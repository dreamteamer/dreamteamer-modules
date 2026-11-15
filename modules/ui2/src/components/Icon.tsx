/** A codicon by name (`briefcase`, `circle-outline`) — the icon names the nav and descriptors already use. */
export function Icon({ name, className = "" }: { name?: string; className?: string }) {
  if (!name) return null
  return <i className={`codicon codicon-${name} ${className}`.trim()} aria-hidden="true" />
}
