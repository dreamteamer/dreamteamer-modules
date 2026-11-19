/**
 * Where a hover card goes (cr-vscode-013, `components/HoverCard.vue`): below its trigger, left-aligned,
 * `gap` px under it; ABOVE when it would cross the viewport's bottom and there is more room above.
 * Both coordinates are clamped into the viewport with a 4 px margin, so the card never starts above
 * the top edge or past the left one — its first line is always on screen. Pure: the caller measures.
 */
export interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

const MARGIN = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function hoverPlace(
	trigger: Rect,
	card: { width: number; height: number },
	viewport: { width: number; height: number },
	gap = 4,
): { top: number; left: number; above: boolean } {
	const roomBelow = viewport.height - trigger.bottom;
	const above = trigger.bottom + gap + card.height > viewport.height && trigger.top > roomBelow;
	const top = above ? trigger.top - gap - card.height : trigger.bottom + gap;
	return {
		top: clamp(top, MARGIN, viewport.height - card.height - MARGIN),
		left: clamp(trigger.left, MARGIN, viewport.width - card.width - MARGIN),
		above,
	};
}
