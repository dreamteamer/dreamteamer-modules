/**
 * Markdown formatting commands for EditMarkdownBody's toolbar (and its Mod-b/Mod-i/Mod-k
 * keybindings). Feature set modeled on the usual markdown-editor toolbar (headings, inline
 * marks, link, lists, quote); implementation is plain CM6 `changeByRange`/line transactions —
 * every command is a text edit on the source-canonical markdown, never a decoration trick.
 *
 * All toggles are idempotent pairs: applying a command to text that already carries the syntax
 * removes it instead (per-selection for inline marks, whole-selection consensus for line
 * prefixes — mixed lines get the prefix added everywhere first).
 */
import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Wrap/unwrap each selection range with an inline marker pair (`**`, `*`, `~~`, `` ` ``). */
export function toggleInline(view: EditorView, marker: string): boolean {
	const len = marker.length;
	view.dispatch(
		view.state.changeByRange((range) => {
			const { from, to } = range;
			const doc = view.state.doc;
			// Markers just outside the selection → strip them.
			if (doc.sliceString(Math.max(0, from - len), from) === marker && doc.sliceString(to, to + len) === marker) {
				return {
					changes: [
						{ from: from - len, to: from },
						{ from: to, to: to + len },
					],
					range: EditorSelection.range(from - len, to - len),
				};
			}
			// Markers included in the selection → strip them.
			const inner = doc.sliceString(from, to);
			if (inner.length >= 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
				return {
					changes: [
						{ from, to: from + len },
						{ from: to - len, to },
					],
					range: EditorSelection.range(from, to - 2 * len),
				};
			}
			// Otherwise wrap (an empty selection lands the cursor between the pair).
			return {
				changes: [
					{ from, insert: marker },
					{ from: to, insert: marker },
				],
				range: EditorSelection.range(from + len, to + len),
			};
		}),
	);
	view.focus();
	return true;
}

/** Set (or, when already at `level`, clear) the ATX heading level on every selected line. */
export function setHeading(view: EditorView, level: number): boolean {
	const doc = view.state.doc;
	const changes: ChangeSpec[] = [];
	for (const range of view.state.selection.ranges) {
		const first = doc.lineAt(range.from).number;
		const last = doc.lineAt(range.to).number;
		for (let n = first; n <= last; n++) {
			const line = doc.line(n);
			const m = /^(#{1,6})\s+/.exec(line.text);
			const current = m ? (m[1] as string).length : 0;
			const head = m ? (m[0] as string).length : 0;
			const insert = current === level ? '' : `${'#'.repeat(level)} `;
			changes.push({ from: line.from, to: line.from + head, insert });
		}
	}
	view.dispatch({ changes });
	view.focus();
	return true;
}

const LINE_PREFIXES = {
	bullet: { re: /^(\s*)[-*]\s+(?!\[)/, insert: '- ' },
	ordered: { re: /^(\s*)\d+\.\s+/, insert: '1. ' },
	task: { re: /^(\s*)[-*]\s+\[[ xX]\]\s+/, insert: '- [ ] ' },
	quote: { re: /^(\s*)>\s?/, insert: '> ' },
} as const;

export type LinePrefixKind = keyof typeof LINE_PREFIXES;

/** Toggle a line prefix (bullet/ordered/task/quote) across every selected line. Consensus rule:
 * if every non-empty selected line already has it, remove it everywhere; otherwise normalize by
 * adding it to the lines that lack it (replacing a competing list prefix in place). */
export function toggleLinePrefix(view: EditorView, kind: LinePrefixKind): boolean {
	const { re, insert } = LINE_PREFIXES[kind];
	const doc = view.state.doc;
	const lines: { from: number; text: string }[] = [];
	const seen = new Set<number>();
	for (const range of view.state.selection.ranges) {
		const first = doc.lineAt(range.from).number;
		const last = doc.lineAt(range.to).number;
		for (let n = first; n <= last; n++) {
			if (seen.has(n)) continue;
			seen.add(n);
			const line = doc.line(n);
			lines.push({ from: line.from, text: line.text });
		}
	}
	const targets = lines.filter((l) => l.text.trim().length > 0 || lines.length === 1);
	const allHave = targets.length > 0 && targets.every((l) => re.test(l.text));
	const changes: ChangeSpec[] = [];
	for (const l of targets) {
		const m = re.exec(l.text);
		if (allHave) {
			if (m) changes.push({ from: l.from + (m[1] as string).length, to: l.from + (m[0] as string).length, insert: '' });
		} else if (!m) {
			// A competing list/quote prefix gets replaced rather than stacked.
			const other = Object.values(LINE_PREFIXES)
				.map((p) => p.re.exec(l.text))
				.find(Boolean);
			const from = l.from + (other ? (other[1] as string).length : 0);
			const to = l.from + (other ? (other[0] as string).length : 0);
			changes.push({ from, to, insert });
		}
	}
	if (changes.length) view.dispatch({ changes });
	view.focus();
	return true;
}

/** Wrap the selection as a markdown link. Non-empty selection becomes the link text with the
 * `url` placeholder selected for immediate typing; empty selection selects the `text` slot. */
export function insertLink(view: EditorView): boolean {
	view.dispatch(
		view.state.changeByRange((range) => {
			const text = view.state.doc.sliceString(range.from, range.to) || 'text';
			const insert = `[${text}](url)`;
			const urlFrom = range.from + text.length + 3;
			return {
				changes: [{ from: range.from, to: range.to, insert }],
				range:
					range.from === range.to
						? EditorSelection.range(range.from + 1, range.from + 1 + text.length)
						: EditorSelection.range(urlFrom, urlFrom + 3),
			};
		}),
	);
	view.focus();
	return true;
}

/** Wrap the selected lines in a fenced code block (or unwrap when already exactly fenced). */
export function toggleFence(view: EditorView): boolean {
	const doc = view.state.doc;
	const range = view.state.selection.main;
	const firstLine = doc.lineAt(range.from);
	const lastLine = doc.lineAt(range.to);
	const before = firstLine.number > 1 ? doc.line(firstLine.number - 1) : null;
	const after = lastLine.number < doc.lines ? doc.line(lastLine.number + 1) : null;
	if (before && after && /^```/.test(before.text) && /^```\s*$/.test(after.text)) {
		view.dispatch({
			changes: [
				{ from: before.from, to: firstLine.from, insert: '' },
				{ from: lastLine.to, to: after.to, insert: '' },
			],
		});
	} else {
		view.dispatch({
			changes: [
				{ from: firstLine.from, insert: '```\n' },
				{ from: lastLine.to, insert: '\n```' },
			],
		});
	}
	view.focus();
	return true;
}
