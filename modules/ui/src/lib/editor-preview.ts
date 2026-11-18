/**
 * Obsidian-style live-preview decorations for the markdown body editor (ported from the archived
 * dreamteamer-studio prototype's `editor-preview.js`; the Preact component-tag chip spike was
 * dropped — it was a mounting proof, not a feature). Layered onto EditMarkdownBody's core CM6
 * instance as one extension.
 *
 * Recipe: iterate the lezer markdown syntax tree per visible range, emit `Decoration.mark`
 * (style content), `Decoration.replace` (hide marker syntax, or swap in the checkbox widget),
 * and `Decoration.line` (per-line classes) — recomputed on doc change, selection change, or
 * viewport change. Everything is reveal-on-cursor: put the cursor on the construct and the raw
 * markers come back.
 *
 * Source-canonical discipline: this module never rewrites document text on its own. The ONLY
 * dispatch it ever issues is the checkbox widget's click handler flipping `[ ]` ↔ `[x]` — every
 * other decoration is purely visual (Decoration.replace hides syntax without deleting it).
 */
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { EditorState, Line, Range, Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// True when any selection range overlaps [from, to] — the shared "is the cursor near this
// syntax" test driving every reveal-on-cursor behavior (headings/task lines test their whole
// line; inline marks/links test their own node range).
function rangesTouch(state: EditorState, from: number, to: number): boolean {
	for (const r of state.selection.ranges) if (r.to >= from && r.from <= to) return true;
	return false;
}

// Consumes whitespace after a hidden marker (e.g. the space after `#`) so hiding the marker also
// hides the separating space rather than leaving a stray leading space in the rendered line.
function skipWs(doc: Text, pos: number, limit: number): number {
	while (pos < limit && /[ \t]/.test(doc.sliceString(pos, pos + 1))) pos++;
	return pos;
}

// Runs `cb(line)` for every document line touched by [from, to] (a multi-line block node —
// fenced code, blockquote — needs one Decoration.line per line).
function eachLine(state: EditorState, from: number, to: number, cb: (line: Line) => void): void {
	let pos = from;
	for (;;) {
		const line = state.doc.lineAt(pos);
		cb(line);
		if (line.to >= to) break;
		pos = line.to + 1;
	}
}

// Task-list checkbox widget. Stores the document position of the char INSIDE the brackets
// (marker.from + 1, i.e. the space or x/X) captured at decoration-build time; clicking
// dispatches a single-char replace flipping that position — the only text mutation this whole
// module makes. Default WidgetType.ignoreEvent() returns true, which is exactly right here:
// the click must not move the cursor onto the line and re-reveal the raw `[ ]` marker.
class CheckboxWidget extends WidgetType {
	constructor(
		private readonly pos: number,
		private readonly checked: boolean,
	) {
		super();
	}
	override eq(other: CheckboxWidget): boolean {
		return other.pos === this.pos && other.checked === this.checked;
	}
	override toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.className = 'cm-lp-checkbox';
		box.checked = this.checked;
		box.addEventListener('click', (e) => {
			e.preventDefault(); // we own the checked state via the text dispatch + redraw
			view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } });
		});
		return box;
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	const state = view.state;
	const doc = state.doc;
	const items: Range<Decoration>[] = [];

	const hide = (from: number, to: number) => {
		if (from < to) items.push(Decoration.replace({}).range(from, to));
	};
	const style = (from: number, to: number, cls: string) => {
		if (from < to) items.push(Decoration.mark({ class: cls }).range(from, to));
	};
	const lineCls = (line: Line, cls: string) => items.push(Decoration.line({ class: cls }).range(line.from));

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter(ref) {
				const node = ref.node;
				switch (ref.name) {
					case 'ATXHeading1':
					case 'ATXHeading2':
					case 'ATXHeading3':
					case 'ATXHeading4':
					case 'ATXHeading5':
					case 'ATXHeading6': {
						// Levels 1-3 get their own size/weight; 4+ collapse onto the level-3 style.
						const level = Math.min(3, Number(ref.name.slice(-1)));
						const line = doc.lineAt(ref.from);
						lineCls(line, `cm-lp-heading cm-lp-h${level}`);
						const mark = node.getChild('HeaderMark');
						if (mark && !rangesTouch(state, line.from, line.to)) {
							hide(mark.from, skipWs(doc, mark.to, line.to));
						}
						break;
					}
					case 'StrongEmphasis':
					case 'Emphasis':
					case 'Strikethrough': {
						const cls = ref.name === 'StrongEmphasis' ? 'cm-lp-strong' : ref.name === 'Emphasis' ? 'cm-lp-em' : 'cm-lp-strike';
						style(ref.from, ref.to, cls);
						if (!rangesTouch(state, ref.from, ref.to)) {
							const markName = ref.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
							for (const m of node.getChildren(markName)) hide(m.from, m.to);
						}
						break;
					}
					case 'InlineCode': {
						// Backtick markers stay visible — style the whole node, marks included.
						style(ref.from, ref.to, 'cm-lp-code');
						break;
					}
					case 'FencedCode': {
						eachLine(state, ref.from, ref.to, (line) => lineCls(line, 'cm-lp-codeblock'));
						break;
					}
					case 'Link': {
						const [first, second] = node.getChildren('LinkMark');
						if (first && second) {
							style(first.to, second.from, 'cm-lp-link');
							if (!rangesTouch(state, ref.from, ref.to)) {
								hide(first.from, first.to); // '['
								hide(second.from, ref.to); // ']' through the trailing '(url)'
							}
						}
						break;
					}
					case 'Blockquote': {
						eachLine(state, ref.from, ref.to, (line) => lineCls(line, 'cm-lp-quote'));
						break;
					}
					case 'Task': {
						const marker = node.getChild('TaskMarker');
						const line = doc.lineAt(ref.from);
						if (marker && !rangesTouch(state, line.from, line.to)) {
							const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
							items.push(Decoration.replace({ widget: new CheckboxWidget(marker.from + 1, checked) }).range(marker.from, marker.to));
						}
						break;
					}
					// Plain bullet/numbered lists: CM6 default markdown styling suffices; no
					// hide/reveal decorations needed. Intentionally no case here.
					default:
						break;
				}
			},
		});
	}
	return Decoration.set(items, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate): void {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

// Walks up from the syntax node at `pos` to an enclosing Link node and returns its URL text.
function linkUrlAt(state: EditorState, pos: number): string | null {
	const node = syntaxTree(state).resolveInner(pos, 1);
	for (let n: typeof node.parent = node; n; n = n.parent) {
		if (n.name === 'Link') {
			const url = n.getChild('URL');
			return url ? state.doc.sliceString(url.from, url.to) : null;
		}
	}
	return null;
}

// cmd/ctrl-click anywhere in a rendered link (styled text or, when revealed, the raw markup)
// opens the URL in a new tab.
const linkClickHandler = EditorView.domEventHandlers({
	mousedown(event, view) {
		if (!(event.metaKey || event.ctrlKey)) return false;
		const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (pos == null) return false;
		const url = linkUrlAt(view.state, pos);
		if (!url) return false;
		event.preventDefault();
		window.open(url, '_blank', 'noopener');
		return true;
	},
});

const baseTheme = EditorView.baseTheme({
	'.cm-lp-h1': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
	'.cm-lp-h2': { fontSize: '1.25em', fontWeight: '700', lineHeight: '1.3' },
	'.cm-lp-h3': { fontSize: '1.1em', fontWeight: '700', lineHeight: '1.3' },
	'.cm-lp-strong': { fontWeight: '700' },
	'.cm-lp-em': { fontStyle: 'italic' },
	'.cm-lp-strike': { textDecoration: 'line-through' },
	'.cm-lp-code': { fontFamily: 'var(--dt-font-mono)', fontSize: '0.92em', backgroundColor: 'var(--dt-bg-subtle)', borderRadius: '3px' },
	'.cm-lp-codeblock': { fontFamily: 'var(--dt-font-mono)', backgroundColor: 'var(--dt-bg-subtle)' },
	'.cm-lp-link': { color: 'var(--dt-accent)', textDecoration: 'underline', cursor: 'pointer' },
	'.cm-lp-quote': { borderLeft: '3px solid var(--dt-border-strong)', paddingLeft: '8px', color: 'var(--dt-fg-subtle)' },
	'.cm-lp-checkbox': { verticalAlign: 'middle', margin: '0 4px 0 0', cursor: 'pointer' },
});

export function livePreview() {
	return [livePreviewPlugin, linkClickHandler, baseTheme];
}
