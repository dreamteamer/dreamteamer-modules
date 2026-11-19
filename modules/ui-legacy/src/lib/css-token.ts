/**
 * A token's value where CSS cannot reach: an SVG presentation attribute (a minimap node's `fill`) or a library's colour
 * option (a Leaflet marker) takes a resolved colour, never `var(--…)`. So a colour written as `var(--dt-…)` is read off
 * the document here; anything else passes through. With no document (a test tier) or no value, `currentColor`.
 */
export function cssToken(name: string, el?: Element | null): string {
	try {
		const target = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
		if (!target || typeof getComputedStyle !== 'function') return '';
		return getComputedStyle(target).getPropertyValue(name).trim();
	} catch {
		return '';
	}
}

/** `var(--name)` (or `var(--name, fallback)`) as the colour it resolves to; any other value unchanged. */
export function resolveColor(value: string | null | undefined, el?: Element | null): string {
	const v = (value ?? '').trim();
	const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
	if (!m) return v || 'currentColor';
	return cssToken(m[1]!, el) || (m[2] ? resolveColor(m[2], el) : 'currentColor');
}
