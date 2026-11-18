<!--
	Field-aware display template (kanban wave, 2026-07-29, operator ask: "templating is something
	that should be ready made to be available in many places", then "why not allow the user to render
	a markdown template for each card?").

	A template is MARKDOWN, and its `{{ field }}` tokens keep their own Views. Those two things
	usually fight: substitute the tokens into text and markdown the result, and a status prints
	`todo` instead of its chip and a date prints its stored offset; render the tokens as components
	and you can't run markdown over the surrounding prose, because `**` and its closing `**` land in
	different literal pieces. Neither compromise was necessary — `lib/render-md.ts` emits VNODES, not
	HTML, so it can splice a component in at a placeholder (`slotToken` / `MdSlot`). `**{{ name }}**`
	comes out bold AND `{{ status }}` comes out as its chip.

	So there is no plain-text mode and no markdown toggle: one template grammar, `{{ field | filter }}`
	from lib/template.ts (the port of the engine's, descriptor v2 §3.7 — the same grammar as a
	collection's `record_title`), rendered through the markdown renderer every time. A template with
	no markdown in it is a paragraph, which is what it always was.

	Layout-agnostic and stateless: give it a template, a record and that collection's fields and it
	works in any List (kanban cards today) or anywhere a `display_template`-shaped option lands.

	A BARE token naming a field renders through that field's View; a token carrying a FILTER renders
	as the grammar's text (`{{ date | date:DD/MM }}` asked for a format, and a View would ignore it).
	There are no dotted paths: the grammar has none, so `{{ assignee.name }}` names a field nobody
	declares and renders empty — exactly what the engine renders for it.
-->
<script lang="ts">
import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue';
import type { FieldRow, ItemRecord } from '../../api/types';
import { parseTemplate, renderToken } from '../../lib/template';
import { renderMd, slotToken, type MdSlot } from '../../lib/render-md';
import RenderView from './RenderView.vue';
import FileThumb from './FileThumb.vue';
import { fileRecordRef } from '../../lib/file-record';

/**
 * In a CARD template a line break is a line break. Markdown would fold two consecutive prose lines
 * into one paragraph, which reads as a bug when you typed them on separate lines — so a lone newline
 * between two plain lines becomes a paragraph break. Lines that open a block construct (list, quote,
 * heading, table, fence) are left exactly as typed, and anything inside a fenced block is untouched,
 * so real markdown structures still parse.
 */
const BLOCKISH = /^\s*(#{1,4}\s|>|[-*]\s|\d+\.\s|\||```)/;

function respectLineBreaks(template: string): string {
	const lines = template.split(/\r?\n/);
	const out: string[] = [];
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		out.push(line);
		if (/^\s*```/.test(line)) fenced = !fenced;
		if (fenced) continue;
		const next = lines[i + 1];
		if (next === undefined || !line.trim() || !next.trim()) continue;
		if (BLOCKISH.test(line) || BLOCKISH.test(next)) continue;
		out.push('');
	}
	return out.join('\n');
}

export default defineComponent({
	name: 'DisplayTemplate',
	props: {
		template: { type: String, required: true },
		record: { type: Object as PropType<ItemRecord>, required: true },
		/** The record's collection fields — a token matching one of these renders through its View. */
		fields: { type: Array as PropType<FieldRow[]>, required: true },
		/**
		 * Passed straight to RenderView. `'cell'` is TABLE semantics: ViewText renders
		 * `white-space: nowrap` and truncates at 80 chars, which on a 270px kanban card clipped the
		 * name mid-word (measured in the dev host, 2026-07-29). A card is a small RECORD surface, so
		 * callers like the kanban pass `'record'` and get wrapping, untruncated values.
		 */
		context: { type: String as PropType<'cell' | 'record'>, default: 'cell' },
	},
	setup(props) {
		/** Markdown source with a placeholder per token, plus the slot each placeholder stands for. */
		const compiled = computed(() => {
			const slots: MdSlot[] = [];
			let source = '';
			for (const part of parseTemplate(props.template)) {
				if ('text' in part) {
					source += part.text;
					continue;
				}
				// Only a BARE token renders through its View; a filtered one is the grammar's text.
				const field = part.filters.length ? undefined : props.fields.find((f) => f.field === part.field);
				if (!field) {
					try {
						source += renderToken(part, props.record);
					} catch {
						// an unknown filter typed into the options panel: the token renders nothing rather
						// than taking the whole card down — compile refuses it in a descriptor
					}
					continue;
				}
				const value = props.record[field.field];
				// ⚠ A VALUE THAT IS A FILE-CODEC REFERENCE IS DRAWN, not spelled. `assets/avatars/ann`
				// rendered as text everywhere a template appears — a relation cell, a card, a tooltip —
				// while the bytes sat one fetch away. Decided by the VALUE against the host-injected
				// file-base list, so a string that resolves is a file record by construction; there is
				// no heuristic to be wrong about. ⚠ The field's own View still wins for every value that
				// is NOT such a reference — but a NON-IMAGE file record (a PDF) is one, and it falls
				// back to plain text rather than to that View, so a specially styled field whose value
				// happens to be a file reference loses its styling there.
				const node: VNodeChild = typeof value === 'string' && fileRecordRef(value)
					? h(FileThumb, { value, alt: '' })
					: h(RenderView, { field, value, context: props.context, record: props.record });
				source += slotToken(slots.length);
				slots.push({ node, text: renderToken({ field: field.field, filters: [] }, props.record) });
			}
			return { source: respectLineBreaks(source), slots };
		});

		return () => h('div', { class: 'dt-md dt-md--tpl' }, renderMd(compiled.value.source, compiled.value.slots));
	},
});
</script>

<!-- NOT scoped: render-function vnodes never receive the scoped-CSS data attribute, so a scoped
     block here would silently not apply (same trap ViewMarkdown.vue documents). `.dt-md--tpl`
     namespaces the overrides instead. -->
<style>
/* `.dt-md` is sized for a record page (14px, 1.65, max-width 720px, generous heading margins). A
   card is ~270px of a scrolling column, so the same markup needs to be tight: inherit the card's
   own type scale, collapse the vertical rhythm, and let headings be a weight change rather than a
   size jump. */
.dt-md--tpl {
	max-width: none;
	font-size: inherit;
	line-height: 1.45;
}
.dt-md--tpl p {
	margin: 0;
}
.dt-md--tpl p + p {
	margin-top: 3px;
}
.dt-md--tpl h1,
.dt-md--tpl h2,
.dt-md--tpl h3,
.dt-md--tpl h4 {
	margin: 0;
	font-size: inherit;
	line-height: 1.35;
}
.dt-md--tpl h1,
.dt-md--tpl h2 {
	font-size: calc(1em + 1px);
}
.dt-md--tpl ul,
.dt-md--tpl ol {
	margin: 2px 0;
	padding-left: 16px;
}
.dt-md--tpl li {
	margin: 0;
}
.dt-md--tpl blockquote {
	margin: 3px 0;
	padding: 0 8px;
}
.dt-md--tpl pre {
	margin: 3px 0;
	padding: 6px 8px;
	white-space: pre-wrap;
}
.dt-md--tpl .dt-md-table-wrap {
	margin: 3px 0;
}
/* A View that lays itself out as a block must not break the line inside inline prose. */
.dt-md--tpl p > * {
	vertical-align: baseline;
}
</style>
