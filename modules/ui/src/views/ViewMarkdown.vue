<!--
	Rendered-markdown View (`markdown`): the read presentation for EVERY markdown field — the
	`role: body` routed here first (resolve.ts, mirroring the Edit side's `markdown-body`), and
	since 2026-08-30 the whole `text` wire kind, which the engine emits for exactly two things:
	`x-body: true` and `format: markdown` (presentation.js's `fieldRow`). Renders via
	lib/render-md.ts's vnode emitter — no innerHTML, no sanitizer needed. Styles are global but
	`.dt-md`-namespaced: render-function vnodes don't receive the scoped-CSS data attribute, so a
	scoped block would silently not apply.

	`context` is what makes that safe in a list: a cell gets ONE stripped line (`mdToPlainText`),
	never a document, so row heights survive. The record page gets the real thing.
-->
<script lang="ts">
import { defineComponent, h, type PropType } from 'vue';
import type { FieldRow } from '../api/types';
import { mdToPlainText, renderMd } from '../lib/render-md';

/** Cell truncation budget — the same 80 ViewText uses, so a markdown column and a string column
 *  clip at the same place. */
const CELL_MAX = 80;

export default defineComponent({
	name: 'ViewMarkdown',
	props: {
		value: { type: null as unknown as PropType<unknown>, required: false, default: null },
		field: { type: Object as PropType<FieldRow>, required: false, default: undefined },
		options: { type: Object as PropType<Record<string, unknown>>, required: false, default: undefined },
		/** 'cell' (default) collapses to one stripped line; 'record' renders the document.
		 *  Declared so RenderView actually passes it — it binds `context` only to Views that ask. */
		context: { type: String as PropType<'cell' | 'record'>, required: false, default: 'cell' },
	},
	setup(props) {
		return () => {
			const text = props.value == null ? '' : String(props.value);
			if (!text.trim()) return h('span', { class: 'dt-md-empty' }, '—');
			if (props.context !== 'record') {
				const plain = mdToPlainText(text);
				// `dir=auto` per cell, for the same reason render-md puts it on every block: the
				// webview is dir=ltr, so a Hebrew line's neutrals (`:` `.` `·` the ellipsis) resolve
				// against the wrong base and land at the wrong end of the line.
				return h(
					'span',
					{ class: 'dt-md-cell', dir: 'auto', title: plain },
					plain.length > CELL_MAX ? `${plain.slice(0, CELL_MAX)}…` : plain,
				);
			}
			return h('div', { class: 'dt-md' }, renderMd(text));
		};
	},
});
</script>

<style>
.dt-md {
	max-width: 720px;
	font-size: 14px;
	line-height: 1.65;
	color: var(--dt-fg);
}
.dt-md-empty {
	color: var(--dt-fg-subtle);
}
.dt-md-cell {
	color: var(--dt-fg);
	white-space: nowrap;
}
.dt-md h1 { font-size: 20px; font-weight: 700; margin: 14px 0 6px; }
.dt-md h2 { font-size: 16px; font-weight: 700; margin: 14px 0 4px; }
.dt-md h3 { font-size: 14px; font-weight: 700; margin: 12px 0 3px; }
.dt-md h4 { font-size: 13px; font-weight: 700; margin: 10px 0 2px; }
.dt-md > :first-child { margin-top: 0; }
.dt-md p { margin: 6px 0; }
/*
	The marker gutter lives on the LI, not the UL's padding, so each item indents on its own start
	side — an RTL item's bullet sits to its right, a Latin one's to its left, inside one list.
	(`dir="auto"` on the UL can't do this: the auto algorithm skips descendants that carry their
	own `dir`, so a list of `dir="auto"` items reads as LTR. Measured 2026-08-09.)
*/
.dt-md ul, .dt-md ol { margin: 4px 0; padding-inline-start: 0; }
.dt-md li { margin: 2px 0; margin-inline-start: 22px; }
.dt-md li.dt-md-task { list-style: none; margin-inline-start: 4px; }
.dt-md li.dt-md-task input { margin-inline-end: 6px; vertical-align: -2px; }
.dt-md-code {
	background: var(--dt-bg-subtle);
	border-radius: 4px;
	padding: 1px 5px;
	font-family: var(--dt-font-mono);
	font-size: 12px;
}
.dt-md-link { color: var(--dt-accent); }
.dt-md-pre {
	background: var(--dt-bg-subtle);
	border-radius: var(--dt-radius);
	padding: 10px 12px;
	margin: 8px 0;
	font-family: var(--dt-font-mono);
	font-size: 12px;
	overflow-x: auto;
}
.dt-md-quote {
	margin: 8px 0;
	padding: 2px 14px;
	border-inline-start: 3px solid var(--dt-border-strong);
	color: var(--dt-fg-subtle);
}
.dt-md-table-wrap { overflow-x: auto; margin: 8px 0; }
.dt-md table { border-collapse: collapse; min-width: 50%; }
.dt-md th {
	border-bottom: 1px solid var(--dt-border);
	padding: 5px 9px;
	font-size: 11px;
	letter-spacing: 0.5px;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
	text-align: start;
}
.dt-md td {
	border-bottom: 1px solid var(--dt-border);
	padding: 5px 9px;
	font-size: 13px;
	text-align: start;
	vertical-align: top;
}
</style>
