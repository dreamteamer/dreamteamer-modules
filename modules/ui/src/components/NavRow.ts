// One row of NavSidebar and, when open, its children — recursive, so a module folder inside a layer
// draws the same way. A render function, so the recursion needs no self-reference in a template.
//
// cr-dt-008: a row whose node carries a `target` (a folder, a namespace, a collection) can be dragged; every row
// reports where a drag hovers and drops — `into` on the middle of a folder or namespace row, `after` anywhere else —
// and a right click asks for its menu. What a gesture MEANS (which NavOp, or nothing) is NavSidebar's to decide.
import { defineComponent, h, type PropType } from 'vue';

/** The MIME type a dragged row's key travels under. */
export const NAV_DRAG_TYPE = 'text/x-dt-nav';

export type DropWhere = 'into' | 'after';

/** Where a pointer at `clientY` over the row drops: `into` on the middle half of a folder or namespace row. */
export function dropWhere(node: { kind: string }, e: { clientY?: number; currentTarget?: unknown }): DropWhere {
	if (node.kind !== 'folder' && node.kind !== 'namespace') return 'after';
	const r = (e.currentTarget as { getBoundingClientRect?: () => { top: number; height: number } } | null)?.getBoundingClientRect?.();
	if (!r || !r.height || typeof e.clientY !== 'number') return 'into';
	const at = (e.clientY - r.top) / r.height;
	return at >= 0.25 && at <= 0.75 ? 'into' : 'after';
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
	},
	emits: ['toggle', 'activate', 'drag', 'hover', 'move', 'menu'],
	setup(props, { emit }) {
		return () => {
			const n = props.node;
			const hasKids = !!n.children?.length;
			const isOpen = props.open.has(n.key);
			const hint = props.hint;
			const hinted = hint && hint.key === n.key ? `dt-nav-drop-${hint.where}` : null;
			const row = h('li', {
				class: ['dt-nav-row', `dt-nav-${n.kind}`, ...(hinted ? [hinted] : [])], role: 'treeitem', 'aria-expanded': hasKids ? String(isOpen) : undefined, 'data-key': n.key, title: n.tooltip ?? undefined, style: { paddingLeft: `${8 + props.depth * 12}px` },
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
			}, [
				hasKids ? h('span', { class: 'dt-nav-twisty', onClick: (e: Event) => { e.stopPropagation(); emit('toggle', n); } }, isOpen ? '▾' : '▸') : h('span', { class: 'dt-nav-twisty' }),
				n.icon ? h('span', { class: `codicon codicon-${n.icon}` }) : null,
				h('span', { class: 'dt-nav-label', onClick: () => emit('activate', n) }, n.label),
				n.marks ? h('span', { class: 'dt-nav-marks' }, n.marks) : null,
				n.description ? h('span', { class: 'dt-nav-count' }, n.description) : null,
			]);
			const kids = hasKids && isOpen
				? n.children.map((c: any) => h(NavRow, {
					key: c.key, node: c, depth: props.depth + 1, open: props.open, hint: props.hint,
					onToggle: (x: any) => emit('toggle', x), onActivate: (x: any) => emit('activate', x), onDrag: (x: any) => emit('drag', x),
					onHover: (x: any) => emit('hover', x), onMove: (x: any) => emit('move', x), onMenu: (x: any) => emit('menu', x),
				}))
				: [];
			return [row, ...kids];
		};
	},
});
export default NavRow;
