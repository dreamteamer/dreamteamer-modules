// A markdown numbered list, read as ITEMS rather than as lines.
//
// ⚠ THE BUG THIS EXISTS FOR. `init.mjs` used to read DECISION-LOG.md one physical line at a time and
// match `<n>. **<date> — <title>**` against it. A row long enough to wrap — and a decision row that
// says anything is long enough — carries its bold header across two lines, so the closing `**` is not
// on the line the row starts on, the match fails, and a perfectly dated row is counted as
// `skipped-undated`. Measured on one real log: 15 rows, 7 of them dated and skipped. The receipt was
// not merely incomplete, it asserted the opposite of the truth about those seven rows.
//
// The fix is to stop pretending a line is a unit. An item is the unit: it starts at its marker and
// runs until the next item at the same level or until the list ends, however many physical lines that
// takes. Rejoining happens BEFORE anything is matched, so a wrapped heading and a single-line heading
// are indistinguishable to every caller.
//
// Nothing here interprets: `content` is the item's own text with its whitespace collapsed, `raw` is
// the block exactly as written.

/** `<indent><n>.<space><rest>` — an ordered-list marker. `)` is deliberately not accepted: the logs
 * this reads use `.`, and every widened delimiter is a line of prose that could start an item. */
const ITEM_RE = /^([ \t]*)(\d+)\.[ \t]+(.*)$/;

/** Block starts that interrupt a paragraph, so a list item never swallows the heading after it. */
const INTERRUPTS_RE = /^(?:#{1,6}\s|>|```|~~~|(?:[-*_][ \t]*){3,}$|[-*+][ \t]+)/;

/** Tabs count as four columns, so indentation compares the way it reads. */
const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

/**
 * Every top-level numbered list item in `markdown`, in document order.
 *
 * A line belongs to the open item when it is indented past the item's own marker (the ordinary
 * continuation, blank lines inside it included), or when it directly follows the item's text with no
 * blank line between and starts no block of its own — markdown's lazy continuation, which is how an
 * unindented wrapped line reads to a person and so how it must read here.
 *
 * An item ends at the next marker at or left of its indent, at un-indented content after a blank
 * line, and at the end of the document. A DEEPER marker is a nested list, which is content.
 *
 * @param {string} markdown
 * @returns {{number: number, line: number, raw: string, content: string}[]}
 *   `number` is the marker's own digits — what a `#<row>` reference is built from, never the item's
 *   ordinal, because a log that restarts or skips numbering must keep pointing at the same row.
 *   `line` is 1-based. `raw` is the block verbatim. `content` is everything after the marker,
 *   collapsed onto one line.
 */
export function numberedListItems(markdown) {
	const lines = String(markdown ?? '').split('\n');
	const items = [];
	let open = null;      // { indent, number, line, lines }
	let pending = [];     // blank lines held back — part of the item only if indented content follows

	const close = () => {
		if (open) items.push(finish(open));
		open = null;
		pending = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) { if (open) pending.push(line); continue; }

		const m = ITEM_RE.exec(line);
		const indent = indentOf(line);

		if (m && (!open || indent <= open.indent)) {
			close();
			open = { indent, number: Number(m[2]), line: i + 1, lines: [line] };
			continue;
		}
		if (!open) continue;                                        // prose outside any list
		if (indent > open.indent) { open.lines.push(...pending, line); pending = []; continue; }
		// At or left of the marker: only a lazy continuation of the paragraph still in hand survives,
		// and only while it starts nothing of its own.
		if (!pending.length && !m && !INTERRUPTS_RE.test(line.trim())) { open.lines.push(line); continue; }
		close();
	}
	close();
	return items;
}

function finish(open) {
	const raw = open.lines.join('\n').replace(/\s+$/, '');
	const marker = ITEM_RE.exec(open.lines[0]);
	const rest = [marker[3], ...open.lines.slice(1)];
	return {
		number: open.number,
		line: open.line,
		raw,
		content: rest.join(' ').replace(/\s+/g, ' ').trim(),
	};
}
