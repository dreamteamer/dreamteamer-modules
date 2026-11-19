/**
 * Minimal markdown → a NODE TREE (ported from the Vue ui's lib/render-md.ts, which emits Vue vnodes).
 * Here the tree is plain data — `{ tag, attrs, children }` — and `components/Markdown.tsx` turns it into React
 * elements, so the grammar is testable under Node with no renderer at all. Never an HTML string: there is no
 * `innerHTML` and no sanitizer to get wrong, so an untrusted record body cannot inject markup by construction.
 *
 * Coverage: headings #–####, fenced code, bullet/ordered lists (incl. GFM task checkboxes), GFM pipe tables,
 * blockquotes, paragraphs; inline **bold**, *em*, `code`, [links](url). Unrecognized syntax degrades to a
 * paragraph — never throws.
 *
 * `renderMd(text, slots)` splices SLOTS into the output at `slotToken(i)` placeholders: a `{ slot: i }` node
 * the caller draws as whatever it likes (a field's own View), and `slots[i]` the plain text used where markup
 * cannot go — inside a fenced block, inline code, or a link href. That is what lets a display template be
 * markdown AND keep each field's View: `**{{ name }}**` comes out bold, `{{ status }}` as its chip.
 */

export interface MdElement {
  tag: string
  /** `dir`, `href`, `data-md` (what a node is, for the look: code, pre, quote, table, task), … as the DOM spells
   *  them; `checked`/`disabled` booleans on a task's checkbox. */
  attrs?: Record<string, string | boolean>
  children: MdNode[]
}

/** A placeholder the caller fills — `slots[slot]` is its plain-text form. */
export interface MdSlotNode {
  slot: number
}

export type MdNode = string | MdElement | MdSlotNode

/** U+E000, a private-use code point: not markdown-significant, and not something a human types. */
const SENTINEL = ""

/** Placeholder for slot `index`, to be embedded in the markdown source. */
export function slotToken(index: number): string {
  return `${SENTINEL}${index}${SENTINEL}`
}

const SLOT_SPLIT = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`)

const el = (tag: string, attrs: MdElement["attrs"] | null, children: MdNode[]): MdElement =>
  attrs ? { tag, attrs, children } : { tag, children }

/** Push `text` onto `out`, swapping any placeholder for its slot node. An unknown slot draws nothing. */
function pushText(out: MdNode[], text: string, slots: readonly string[]): void {
  let rest = text
  while (rest) {
    const m = SLOT_SPLIT.exec(rest)
    if (!m) {
      out.push(rest)
      return
    }
    if (m.index) out.push(rest.slice(0, m.index))
    const i = Number(m[1])
    if (slots[i] !== undefined) out.push({ slot: i })
    rest = rest.slice(m.index + m[0].length)
  }
}

/** Flatten placeholders to their plain-text form — for positions that can't hold markup. */
function flatten(text: string, slots: readonly string[]): string {
  return text.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"), (_m, i: string) => slots[Number(i)] ?? "")
}

/** The inline grammar, shared by `inline()` (nodes) and `inlineText()` (plain text) so they never disagree. */
const INLINE_RX = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/

/** A link keeps its href unless it names a scheme other than http(s)/mailto — a `javascript:` href in an
 *  untrusted body stays the label's text. A relative href (no scheme) is kept. */
export const safeHref = (href: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(https?|mailto):/i.test(href)

function inline(s: string, slots: readonly string[]): MdNode[] {
  const out: MdNode[] = []
  let rest = String(s)
  while (rest) {
    const m = INLINE_RX.exec(rest)
    if (!m) {
      pushText(out, rest, slots)
      break
    }
    if (m.index) pushText(out, rest.slice(0, m.index), slots)
    if (m[2]) out.push(el("strong", null, inline(m[2], slots)))
    else if (m[4]) out.push(el("em", null, inline(m[4], slots)))
    else if (m[6]) out.push(el("code", { "data-md": "code" }, [flatten(m[6], slots)]))
    else if (m[8]) {
      const href = flatten(m[9] ?? "", slots).trim()
      // React refuses a `javascript:` URL only with a warning; a record body is untrusted, so it never gets one
      if (safeHref(href)) out.push(el("a", { href, target: "_blank", rel: "noopener noreferrer" }, inline(m[8], slots)))
      else out.push(...inline(m[8], slots))
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

/**
 * Markdown → ONE LINE of readable plain text, for the positions that cannot hold a document: a table cell, a
 * card line, a tooltip. It strips the same inline grammar `inline()` recognises plus the block markers, and
 * keeps the words — a markdown column reads as sentences, not as a wall of asterisks.
 */
export function mdToPlainText(text: unknown): string {
  const lines = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*([-*]|\d+\.)\s+/, "")
        .replace(/^\[([ xX])\]\s+/, "")
        .replace(/^\s*([-*_]\s*){3,}$/, "")
        .replace(/^\|[\s:|-]+\|\s*$/, "")
        .replace(/^\|(.*)\|\s*$/, (_m, row: string) =>
          row
            .split("|")
            .map(c => c.trim())
            .join(" · ")
        )
    )
  return lines.map(inlineText).join(" ").replace(/\s+/g, " ").trim()
}

/** INLINE_RX's text-only twin: keeps a link's label and drops its href, unwraps emphasis and code. */
function inlineText(s: string): string {
  let out = ""
  let rest = s
  while (rest) {
    const m = INLINE_RX.exec(rest)
    if (!m) return out + rest
    out += rest.slice(0, m.index)
    out += m[6] != null ? m[6] : inlineText(m[2] ?? m[4] ?? m[8] ?? "")
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

/**
 * Base direction, decided PER BLOCK: a container-level `dir="auto"` would take the first strong character of
 * the whole field and impose it on every child, flipping an English paragraph in a Hebrew record.
 */
const DIR = { dir: "auto" } as const

/** First-strong-character direction, for a table or a quote whose children each carry their own `dir` (which
 *  the auto algorithm skips). */
export function firstStrongDir(text: string): "rtl" | "ltr" {
  const m = /[\p{Script=Hebrew}\p{Script=Arabic}]|[A-Za-z\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.exec(
    text
  )
  return m && /[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(m[0]) ? "rtl" : "ltr"
}

function listItem(text: string, slots: readonly string[]): MdNode {
  // GFM task item: the checkbox state, inert (a view, not an edit)
  const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
  if (task) {
    return el("li", { "data-md": "task", ...DIR }, [
      el("input", { type: "checkbox", checked: task[1] !== " ", disabled: true }, []),
      ...inline(task[2] ?? "", slots),
    ])
  }
  return el("li", DIR, inline(text, slots))
}

export function renderMd(text: unknown, slots: readonly string[] = []): MdNode[] {
  const lines = String(text ?? "").split(/\r?\n/)
  const nodes: MdNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i] as string
    if (!l.trim()) {
      i++
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) {
      nodes.push(el(`h${m[1]!.length}`, DIR, inline(m[2] ?? "", slots)))
      i++
      continue
    }
    if (/^```/.test(l)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i] as string)) buf.push(lines[i++] as string)
      i++
      nodes.push(el("pre", { "data-md": "pre" }, [flatten(buf.join("\n"), slots)]))
      continue
    }
    if (/^\s*>\s?/.test(l)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] as string))
        buf.push((lines[i++] as string).replace(/^\s*>\s?/, ""))
      const quote = buf.join("\n")
      nodes.push(el("blockquote", { "data-md": "quote", dir: firstStrongDir(quote) }, renderMd(quote, slots)))
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items: MdNode[] = []
      const ordered = /^\s*\d+\./.test(l)
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] as string)) {
        items.push(listItem((lines[i++] as string).replace(/^\s*([-*]|\d+\.)\s+/, ""), slots))
      }
      nodes.push(el(ordered ? "ol" : "ul", null, items))
      continue
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test((lines[i + 1] as string | undefined) ?? "")) {
      const cells = (row: string) =>
        row
          .split("|")
          .slice(1, -1)
          .map(c => c.trim())
      const head = cells(l)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] as string)) rows.push(cells(lines[i++] as string))
      nodes.push(
        el("div", { "data-md": "table" }, [
          el("table", { dir: firstStrongDir([head, ...rows].flat().join(" ")) }, [
            el("thead", null, [
              el(
                "tr",
                null,
                head.map(c => el("th", DIR, inline(c, slots)))
              ),
            ]),
            el(
              "tbody",
              null,
              rows.map(r =>
                el(
                  "tr",
                  null,
                  r.map(c => el("td", DIR, inline(c, slots)))
                )
              )
            ),
          ]),
        ])
      )
      continue
    }
    const buf = [l]
    i++
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !/^(#{1,4}\s|```|\s*>|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i] as string)
    ) {
      buf.push(lines[i++] as string)
    }
    nodes.push(el("p", DIR, inline(buf.join(" "), slots)))
  }
  return nodes
}

/**
 * In a CARD template a line break is a line break: a lone newline between two plain lines becomes a paragraph
 * break. Lines opening a block construct (list, quote, heading, table, fence) and anything inside a fence are
 * left as typed, so real markdown structures still parse. (the Vue ui's DisplayTemplate.vue, kept beside the grammar.)
 */
const BLOCKISH = /^\s*(#{1,4}\s|>|[-*]\s|\d+\.\s|\||```)/

export function respectLineBreaks(template: string): string {
  const lines = template.split(/\r?\n/)
  const out: string[] = []
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    out.push(line)
    if (/^\s*```/.test(line)) fenced = !fenced
    if (fenced) continue
    const next = lines[i + 1]
    if (next === undefined || !line.trim() || !next.trim()) continue
    if (BLOCKISH.test(line) || BLOCKISH.test(next)) continue
    out.push("")
  }
  return out.join("\n")
}
