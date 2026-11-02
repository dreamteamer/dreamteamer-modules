// One row of NavSidebar and, when open, its children — recursive, so a module folder inside a layer
// draws the same way. A render function, so the recursion needs no self-reference in a template.
import { defineComponent, h, type PropType } from 'vue';

/** One row and, when open, its children — recursive, so a module folder inside a layer draws the same way. */
const NavRow: any = defineComponent({
	name: 'NavRow',
	props: {
		node: { type: Object as PropType<any>, required: true },
		depth: { type: Number, required: true },
		open: { type: Object as PropType<Set<string>>, required: true },
	},
	emits: ['toggle', 'activate'],
	setup(props, { emit }) {
		return () => {
			const n = props.node;
			const hasKids = !!n.children?.length;
			const isOpen = props.open.has(n.key);
			const row = h('li', { class: ['dt-nav-row', `dt-nav-${n.kind}`], role: 'treeitem', 'aria-expanded': hasKids ? String(isOpen) : undefined, 'data-key': n.key, title: n.tooltip ?? undefined, style: { paddingLeft: `${8 + props.depth * 12}px` } }, [
				hasKids ? h('span', { class: 'dt-nav-twisty', onClick: (e: Event) => { e.stopPropagation(); emit('toggle', n); } }, isOpen ? '▾' : '▸') : h('span', { class: 'dt-nav-twisty' }),
				n.icon ? h('span', { class: `codicon codicon-${n.icon}` }) : null,
				h('span', { class: 'dt-nav-label', onClick: () => emit('activate', n) }, n.label),
				n.marks ? h('span', { class: 'dt-nav-marks' }, n.marks) : null,
				n.description ? h('span', { class: 'dt-nav-count' }, n.description) : null,
			]);
			const kids = hasKids && isOpen ? n.children.map((c: any) => h(NavRow, { key: c.key, node: c, depth: props.depth + 1, open: props.open, onToggle: (x: any) => emit('toggle', x), onActivate: (x: any) => emit('activate', x) })) : [];
			return [row, ...kids];
		};
	},
});
export default NavRow;
