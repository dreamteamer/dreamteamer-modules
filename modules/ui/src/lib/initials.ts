/** Two-letter initials for an avatar chip — shared by ModuleBar's operator avatar and
 *  PageHeader's commit-author avatar (operator ask 2026-07-27). */
export function initialsOf(name: string | null | undefined): string {
	const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
