export function moduleLabel(id: string, title?: string): string {
  if (title) return title
  return id
    .split(/[_\-\s/]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
