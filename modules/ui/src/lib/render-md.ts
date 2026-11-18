/**
 * Minimal markdown → VNodes (ported from the archived dreamteamer-studio prototype's `md.js`,
 * Preact → Vue). Emits vnodes directly — never HTML strings — so there is no `innerHTML` and no
 * sanitizer to get wrong: untrusted record bodies cannot inject markup by construction.
 *
 * Coverage: headings #–####, fenced code, bullet/ordered lists (incl. GFM task checkboxes),
 * GFM pipe tables, blockquotes, paragraphs; inline **bold**, *em*, `code`, [links](url).
 * Unrecognized syntax degrades to a paragraph — never throws. Styling via `.dt-md` classes
 * (ViewMarkdown.vue owns the CSS).
 *
 * `renderMd(text, slots)` optionally splices VNODES into the output at `slotToken(i)` placeholders —
 * that is what makes a display template markdown-capable without losing each field's own View. See
 * `MdSlot`. Called without slots (ViewMarkdown, every pre-existing caller) it behaves exactly as before.
 */
import { h, type VNodeChild } from 'vue';

/**
 * A value spliced into rendered markdown at a placeholder (see `slotToken`). `node` is what renders
 * in normal prose positions; `text` is the plain-text form used where markup can't go — inside a
 * fenced block, inline code, or a link href.
 *
 * This is what lets a card template be BOTH markdown and field-aware (kanban wave, 2026-07-29,
 * operator: "why not allow the user to render a markdown template for each card?"). The alternative
 * — render tokens to strings, then markdown the result — loses every field's own View (a status
 * would print `todo` instead of its chip, a date its stored offset). Substituting at the vnode level
 * keeps `**{{ name }}**` bold AND `{{ status }}` a chip, and it happens INSIDE `inline()` so a token
 * wrapped in emphasis still lands in the right node.
 */
export interface MdSlot {
	node: VNodeChild;
	text: string;
}

/** U+E000, a private-use code point: not markdown-significant, and not something a human types. */
const SENTINEL = '\uE000';

/**
 * Placeholder for slot `index`, to be embedded in the markdown source. A private-use code point: it can't occur
 * in a hand-typed template, carries no meaning in any markdown construct, and survives the block
 * scanner and the paragraph join untouched — so a placeholder can't be mangled or accidentally
 * matched. With no slots passed, no text contains them and every path below is a no-op.
 */
export function slotToken(index: number): string {
	return `${SENTINEL}${index}${SENTINEL}`;
}

const SLOT_SPLIT = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`);

/** Push `text` onto `out`, swapping any placeholder for its slot's node. */
function pushText(out: VNodeChild[], text: string, slots: MdSlot[]): void {
	let rest = text;
	while (rest) {
		const m = SLOT_SPLIT.exec(rest);
		if (!m) {
			if (rest) out.push(rest);
			return;
		}
		if (m.index) out.push(rest.slice(0, m.index));
		const slot = slots[Number(m[1])];
		if (slot) out.push(slot.node);
		rest = rest.slice(m.index + m[0].length);
	}
}

/** Flatten placeholders to their plain-text form — for positions that can't hold markup. */
function flatten(text: string, slots: MdSlot[]): string {
	return text.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, i: string) => slots[Number(i)]?.text ?? '');
}

/**
 * The inline grammar, hoisted so `inline()` (vnodes) and `inlineText()` (plain text) can never
 * disagree about what counts as markup. No `/g`, so `exec` is stateless and both loops can share it.
 */
const INLINE_RX = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/;

function inline(s: string, slots: MdSlot[] = []): VNodeChild[] {
	const out: VNodeChild[] = [];
	let rest = String(s);
	const rx = INLINE_RX;
	while (rest) {
		const m = rx.exec(rest);
		if (!m) {
			pushText(out, rest, slots);
			break;
		}
		if (m.index) pushText(out, rest.slice(0, m.index), slots);
		if (m[2]) out.push(h('strong', null, inline(m[2], slots)));
		else if (m[4]) out.push(h('em', null, inline(m[4], slots)));
		else if (m[6]) out.push(h('code', { class: 'dt-md-code' }, flatten(m[6], slots)));
		else if (m[8])
			out.push(
				h(
					'a',
					{ class: 'dt-md-link', href: flatten(m[9] ?? '', slots), target: '_blank', rel: 'noopener noreferrer' },
					inline(m[8], slots),
				),
			);
		rest = rest.slice(m.index + m[0].length);
	}
	return out;
}

/**
 * Markdown → ONE LINE of readable plain text, for the positions that cannot hold a document: a
 * table cell, a card line, a tooltip. Not a second markdown parser — it strips the same inline
 * grammar `inline()` recognises (INLINE_RX) plus the block markers, and keeps the words.
 *
 * A cell can't render the real thing (row heights), but the old fallthrough to ViewText printed the
 * SOURCE — `**status:** todo · …` — so every markdown column read as a wall of asterisks. Stripping
 * is the honest middle: the reader sees the sentence, and the record page still shows the document.
 */
export function mdToPlainText(text: unknown): string {
	const lines = String(text ?? '')
		// A fenced block is never the one-line summary of a field, and its newlines would join into
		// noise. Drop it whole.
		.replace(/```[\s\S]*?```/g, ' ')
		.split(/\r?\n/)
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/, '')
				.replace(/^\s*>\s?/, '')
				.replace(/^\s*([-*]|\d+\.)\s+/, '')
				.replace(/^\[([ xX])\]\s+/, '')
				// A horizontal rule and a table's `|---|---|` separator carry no words at all.
				.replace(/^\s*([-*_]\s*){3,}$/, '')
				.replace(/^\|[\s:|-]+\|\s*$/, '')
				// Remaining table rows: cells become a middot-separated run rather than pipes.
				.replace(/^\|(.*)\|\s*$/, (_m, row: string) => row.split('|').map((c) => c.trim()).join(' · ')),
		);
	return lines.map(inlineText).join(' ').replace(/\s+/g, ' ').trim();
}

/** INLINE_RX's text-only twin: keeps a link's label and drops its href, unwraps emphasis and code. */
function inlineText(s: string): string {
	let out = '';
	let rest = s;
	while (rest) {
		const m = INLINE_RX.exec(rest);
		if (!m) return out + rest;
		out += rest.slice(0, m.index);
		// Inline code is literal — an asterisk inside backticks is an asterisk, so it is taken
		// verbatim rather than re-scanned. Everything else can nest (`**bold *em*`), so it recurses.
		out += m[6] != null ? m[6] : inlineText(m[2] ?? m[4] ?? m[8] ?? '');
		rest = rest.slice(m.index + m[0].length);
	}
	return out;
}

/**
 * Base direction, decided PER BLOCK. The webview is `dir=ltr`, so without this every Hebrew
 * paragraph renders with an LTR base: left-aligned, and every neutral character (⚠ ❓ `.` `,`
 * parentheses, the `—`) resolves against the wrong base and lands on the wrong side of the line.
 * Measured 2026-08-09 on a real finance-account body — `getComputedStyle(p).direction` came back
 * `ltr` for four Hebrew paragraphs, with the sentence-final period rendered 53px from the LEFT
 * edge of a 720px block.
 *
 * Per BLOCK, not on the `.dt-md` container: a container-level `dir="auto"` takes the first strong
 * character of the WHOLE field and imposes it on every child, which flips an English paragraph in
 * a Hebrew record to RTL (measured — same session). Each block deciding for itself is what makes
 * one mixed-language body render correctly throughout.
 */
const DIR = { dir: 'auto' } as const;

/**
 * First-strong-character direction, computed by hand. Needed only where `dir="auto"` can't help:
 * the algorithm SKIPS descendants that carry their own `dir` attribute, so a `<table>` whose every
 * cell is `dir="auto"` finds no eligible text and falls back to LTR — leaving a Hebrew table's
 * columns in Latin order. Same trap applies to `<ul>`; lists dodge it by moving the marker gutter
 * onto the `<li>` (see ViewMarkdown.vue's `margin-inline-start`) so each item indents on its own side.
 */
function firstStrongDir(text: string): 'rtl' | 'ltr' {
	const m = /[\p{Script=Hebrew}\p{Script=Arabic}]|[A-Za-z\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.exec(text);
	return m && /[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(m[0]) ? 'rtl' : 'ltr';
}

function listItem(text: string, slots: MdSlot[]): VNodeChild {
	// GFM task item: render the checkbox state, keep it inert (view, not edit).
	const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
	if (task) {
		return h('li', { class: 'dt-md-task', ...DIR }, [
			h('input', { type: 'checkbox', checked: task[1] !== ' ', disabled: true }),
			...inline(task[2] ?? '', slots),
		]);
	}
	return h('li', DIR, inline(text, slots));
}

export function renderMd(text: unknown, slots: MdSlot[] = []): VNodeChild[] {
	const lines = String(text ?? '').split(/\r?\n/);
	const nodes: VNodeChild[] = [];
	let i = 0;
	while (i < lines.length) {
		const l = lines[i] as string;
		if (!l.trim()) {
			i++;
			continue;
		}
		let m: RegExpExecArray | null;
		if ((m = /^(#{1,4})\s+(.*)/.exec(l))) {
			nodes.push(h(`h${m[1]!.length}`, DIR, inline(m[2] ?? '', slots)));
			i++;
			continue;
		}
		if (/^```/.test(l)) {
			const buf: string[] = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i] as string)) buf.push(lines[i++] as string);
			i++;
			nodes.push(h('pre', { class: 'dt-md-pre' }, flatten(buf.join('\n'), slots)));
			continue;
		}
		if (/^\s*>\s?/.test(l)) {
			const buf: string[] = [];
			while (i < lines.length && /^\s*>\s?/.test(lines[i] as string)) buf.push((lines[i++] as string).replace(/^\s*>\s?/, ''));
			// An explicit dir, not `auto`: the quote's own direction is what `border-inline-start`
			// resolves against, and `auto` would read as LTR here — its children each carry a `dir`
			// attribute, and the auto algorithm skips exactly those.
			const quote = buf.join('\n');
			nodes.push(h('blockquote', { class: 'dt-md-quote', dir: firstStrongDir(quote) }, renderMd(quote, slots)));
			continue;
		}
		if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
			const items: VNodeChild[] = [];
			const ordered = /^\s*\d+\./.test(l);
			while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] as string)) {
				items.push(listItem((lines[i++] as string).replace(/^\s*([-*]|\d+\.)\s+/, ''), slots));
			}
			nodes.push(h(ordered ? 'ol' : 'ul', null, items));
			continue;
		}
		if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test((lines[i + 1] as string | undefined) ?? '')) {
			const cells = (row: string) => row.split('|').slice(1, -1).map((c) => c.trim());
			const head = cells(l);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] as string)) rows.push(cells(lines[i++] as string));
			// The table's own dir decides COLUMN order (a Hebrew table reads right-to-left), so it is
			// computed from the source rows; each cell then re-decides its own text with `auto`.
			nodes.push(
				h('div', { class: 'dt-md-table-wrap' }, [
					h('table', { dir: firstStrongDir([head, ...rows].flat().join(' ')) }, [
						h('thead', null, h('tr', null, head.map((c) => h('th', DIR, inline(c, slots))))),
						h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', DIR, inline(c, slots)))))),
					]),
				]),
			);
			continue;
		}
		const buf = [l];
		i++;
		while (i < lines.length && (lines[i] as string).trim() && !/^(#{1,4}\s|```|\s*>|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i] as string)) {
			buf.push(lines[i++] as string);
		}
		nodes.push(h('p', DIR, inline(buf.join(' '), slots)));
	}
	return nodes;
}
