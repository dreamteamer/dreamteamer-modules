// One row of NavSidebar and, when open, its children — recursive, so a module folder inside a layer
// draws the same way. A render function, so the recursion needs no self-reference in a template.
//
// cr-dt-008: a row whose node carries a `target` (a folder, a namespace, a collection) can be dragged; every row
// reports where a drag hovers and drops — `before` on its upper part (the top quarter of a folder or namespace row,
// the upper half of any other), `into` on the middle half of a folder or namespace row, `after` below that — and a
// right click asks for its menu. What a gesture MEANS (which NavOp, or nothing) is NavSidebar's to decide.
//
// 2026-11-14 revision (the arrange lock): all of that only while the nav is unlocked (`arrange`). Locked, a row is a
// link and nothing else — no `draggable`, no dragover or drop handler (so the browser shows no drop), and no context
// menu handler (so a right click is the browser's own).
import { defineComponent, h, type PropType } from 'vue';

/** The MIME type a dragged row's key travels under. */
export const NAV_DRAG_TYPE = 'text/x-dt-nav';

export type DropWhere = 'before' | 'into' | 'after';

/**
 * Where a pointer at `clientY` over the row drops. A folder or namespace row: `before` on its top quarter, `into` on
 * the middle half, `after` on its bottom quarter. Any other row: `before` on its upper half, `after` on its lower.
 * With no pointer position, a container takes `into` and any other row `after`.
 */
export function dropWhere(node: { kind: string }, e: { clientY?: number; currentTarget?: unknown }): DropWhere {
	const container = node.kind === 'folder' || node.kind === 'namespace';
	const r = (e.currentTarget as { getBoundingClientRect?: () => { top: number; height: number } } | null)?.getBoundingClientRect?.();
	if (!r || !r.height || typeof e.clientY !== 'number') return container ? 'into' : 'after';
	const at = (e.clientY - r.top) / r.height;
	if (!container) return at < 0.5 ? 'before' : 'after';
	return at < 0.25 ? 'before' : at <= 0.75 ? 'into' : 'after';
}

/** One row and, when open, its children — recursive, so a module folder inside a layer draws the same way. */
const NavRow: any = defineComponent({
	name: 'NavRow',
	props: {
		node: { type: Object as PropType<any>, required: true },
		depth: { type: Number, required: true },
		open: { type: Object as PropType<Set<string>>, required: true },
		/** The row a drag hovers and where it would drop, for the insertion line. */
		hint: { type: Object as PropType<{ key: string; where: DropWhere } | null>, default: null },
		/** The nav is unlocked: rows drag, take drops and have menus. Locked (false) they only navigate. */
		arrange: { type: Boolean, default: false },
		/** The key of the row the open page belongs to — drawn as the CURRENT row (2026-11-16, cr-modules-021). */
		current: { type: String as PropType<string | null>, default: null },
	},
	emits: ['toggle', 'activate', 'drag', 'hover', 'move', 'menu'],
	setup(props, { emit }) {
		return () => {
			const n = props.node;
			const hasKids = !!n.children?.length;
			const isOpen = props.open.has(n.key);
			const hint = props.hint;
			const arrange = props.arrange;
			const hinted = arrange && hint && hint.key === n.key ? `dt-nav-drop-${hint.where}` : null;
			const gestures = arrange ? {
				draggable: n.target ? 'true' : undefined,
				onDragstart: (e: DragEvent) => {
					if (!n.target) return;
					e.dataTransfer?.setData(NAV_DRAG_TYPE, n.key);
					e.dataTransfer?.setData('text/plain', n.label ?? n.key);
					if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
					emit('drag', n.key);
				},
				onDragover: (e: DragEvent) => {
					e.preventDefault();
					emit('hover', { key: n.key, where: dropWhere(n, e) });
				},
				onDrop: (e: DragEvent) => {
					e.preventDefault();
					e.stopPropagation();
					emit('move', { key: e.dataTransfer?.getData(NAV_DRAG_TYPE) || null, targetKey: n.key, where: dropWhere(n, e) });
				},
				onContextmenu: (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					emit('menu', { key: n.key, x: e.clientX, y: e.clientY });
				},
			} : {};
			const isCurrent = props.current === n.key;
			// THE X-GRID (cr-modules-021): every slot is drawn on every row, empty or not — the twisty, a 16 px icon box,
			// the label, and ONE right-hand column for marks and counts — so at one depth every icon starts at one x and
			// every label at another, whatever the row carries. The highlight is the row's ::before layer, inset from
			// both edges, so hover and the current row move nothing.
			const section = props.depth === 0 && hasKids && n.kind !== 'collection';
			const row = h('li', {
				class: ['dt-nav-row', `dt-nav-${n.kind}`, ...(section ? ['dt-nav-section'] : []), ...(isCurrent ? ['is-current'] : []), ...(hinted ? [hinted] : [])], role: 'treeitem', 'aria-expanded': hasKids ? String(isOpen) : undefined, 'aria-current': isCurrent ? 'page' : undefined, 'data-key': n.key, title: n.tooltip ?? undefined, style: { paddingLeft: `${8 + props.depth * 12}px` },
				...gestures,
			}, [
				hasKids ? h('span', { class: 'dt-nav-twisty', onClick: (e: Event) => { e.stopPropagation(); emit('toggle', n); } }, [h('span', { class: `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`, 'aria-hidden': 'true' })]) : h('span', { class: 'dt-nav-twisty' }),
				h('span', { class: 'dt-nav-icon', 'aria-hidden': 'true' }, n.icon ? [h('span', { class: `codicon codicon-${n.icon}` })] : []),
				h('span', { class: 'dt-nav-label', onClick: () => emit('activate', n) }, n.label),
				n.marks || n.description ? h('span', { class: 'dt-nav-end' }, [
					n.marks ? h('span', { class: 'dt-nav-marks' }, n.marks) : null,
					n.description ? h('span', { class: 'dt-nav-count' }, n.description) : null,
				]) : null,
			]);
			const kids = hasKids && isOpen
				? n.children.map((c: any) => h(NavRow, {
					key: c.key, node: c, depth: props.depth + 1, open: props.open, hint: props.hint, arrange: props.arrange, current: props.current,
					onToggle: (x: any) => emit('toggle', x), onActivate: (x: any) => emit('activate', x), onDrag: (x: any) => emit('drag', x),
					onHover: (x: any) => emit('hover', x), onMove: (x: any) => emit('move', x), onMenu: (x: any) => emit('menu', x),
				}))
				: [];
			return [row, ...kids];
		};
	},
});
export default NavRow;
