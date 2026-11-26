// htmlToText — a page of static HTML as the text a reader gets from it, and the tokenizer under it.
//
// This file is kept byte for byte the same in every module that carries it (a test at the repository's root
// compares the copies), so it imports nothing and names no module.
//
// The projection: comments and the content of script, style, template, head and title are dropped; a block
// element is a line break; a list item starts with "- "; a table row is its cells joined by " | "; a link is
// "text (address)"; a picture is its alt in square brackets; entities are decoded. A run of whitespace is one
// space, as a browser draws it, and `pre` keeps its lines. Whatever it gets wrong is wrong text, never markup.
//
// One pass, no look-back: every search either finds its end or ends the read, so a hostile value costs time
// in proportion to its length. Nothing here depends on anything but the value.

/** One attribute of a start tag: its name in lower case and its value with entities decoded ("" when it has none). */
export type HtmlAttr = [name: string, value: string]

/** What a reader of the token stream is told. Every member is optional. */
export interface HtmlVisitor {
  /** Text between tags. `literal` text (a CDATA section) holds no entities. */
  text?(text: string, literal: boolean): void
  /** A start tag, its name in lower case. */
  open?(name: string, attrs: HtmlAttr[], selfClosing: boolean): void
  /** An end tag, its name in lower case. Also sent after the content of a raw element. */
  close?(name: string): void
  /** The content of script, style, title or textarea, as written. */
  raw?(name: string, text: string): void
}

const RAW = new Set(["script", "style", "title", "textarea"])

const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isDigit = (c: number) => c >= 48 && c <= 57
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13

interface Tag {
  name: string
  attrs: HtmlAttr[]
  selfClosing: boolean
  /** the index after the tag's closing bracket */
  end: number
}

/** A tag read from `at`, the first character of its name. Null when the value ends inside it. */
function readTag(html: string, at: number): Tag | null {
  const n = html.length
  let i = at
  while (i < n) {
    const c = html.charCodeAt(i)
    if (isSpace(c) || c === 47 || c === 62) break
    i++
  }
  const name = html.slice(at, i).toLowerCase()
  const attrs: HtmlAttr[] = []
  let slash = false
  for (;;) {
    while (i < n) {
      const c = html.charCodeAt(i)
      if (c === 47) slash = true
      else if (!isSpace(c)) break
      i++
    }
    if (i >= n) return null
    if (html.charCodeAt(i) === 62) return { name, attrs, selfClosing: slash, end: i + 1 }
    slash = false
    const nameStart = i
    i++
    while (i < n) {
      const c = html.charCodeAt(i)
      if (isSpace(c) || c === 47 || c === 62 || c === 61) break
      i++
    }
    const attr = html.slice(nameStart, i).toLowerCase()
    while (i < n && isSpace(html.charCodeAt(i))) i++
    let value = ""
    if (i < n && html.charCodeAt(i) === 61) {
      i++
      while (i < n && isSpace(html.charCodeAt(i))) i++
      if (i >= n) return null
      const quote = html.charCodeAt(i)
      if (quote === 34 || quote === 39) {
        const end = html.indexOf(quote === 34 ? '"' : "'", i + 1)
        if (end < 0) return null
        value = html.slice(i + 1, end)
        i = end + 1
      } else {
        const valueStart = i
        while (i < n) {
          const c = html.charCodeAt(i)
          if (isSpace(c) || c === 62) break
          i++
        }
        value = html.slice(valueStart, i)
      }
    }
    attrs.push([attr, decodeEntities(value)])
  }
}

/** Where the content of a raw element ends: the start of its end tag and the index after it. */
function rawEnd(html: string, from: number, name: string): { start: number; end: number } {
  const n = html.length
  let at = html.indexOf("</", from)
  while (at >= 0) {
    const after = at + 2 + name.length
    const c = html.charCodeAt(after)
    if ((after >= n || isSpace(c) || c === 47 || c === 62) && html.slice(at + 2, after).toLowerCase() === name) {
      const tag = readTag(html, at + 2)
      return { start: at, end: tag ? tag.end : n }
    }
    at = html.indexOf("</", at + 2)
  }
  return { start: n, end: n }
}

/** Read `html` once, front to back, telling `v` what is there. Never throws on any string. */
export function tokenizeHtml(html: string, v: HtmlVisitor): void {
  const n = html.length
  let i = 0
  let textStart = 0
  let foreign = 0
  // where the next end of a comment is, in each of its two spellings, so a search that found none is never
  // made again: -2 not looked for yet, -1 there is none
  let plain = -2
  let bang = -2
  const flush = (end: number) => {
    if (end > textStart) v.text?.(html.slice(textStart, end), false)
  }
  while (i < n) {
    const lt = html.indexOf("<", i)
    if (lt < 0) break
    const c = html.charCodeAt(lt + 1)
    if (isAlpha(c)) {
      const tag = readTag(html, lt + 1)
      flush(lt)
      if (!tag) return
      i = textStart = tag.end
      const svg = tag.name === "svg" || tag.name === "math"
      if (svg && !tag.selfClosing) foreign++
      v.open?.(tag.name, tag.attrs, tag.selfClosing)
      if (RAW.has(tag.name) && !(foreign > 0 && tag.selfClosing)) {
        const close = rawEnd(html, tag.end, tag.name)
        v.raw?.(tag.name, html.slice(tag.end, close.start))
        v.close?.(tag.name)
        i = textStart = close.end
      }
    } else if (c === 47) {
      const c2 = html.charCodeAt(lt + 2)
      if (isAlpha(c2)) {
        const tag = readTag(html, lt + 2)
        flush(lt)
        if (!tag) return
        i = textStart = tag.end
        if ((tag.name === "svg" || tag.name === "math") && foreign > 0) foreign--
        v.close?.(tag.name)
      } else if (c2 === 62) {
        flush(lt)
        i = textStart = lt + 3
      } else if (lt + 2 >= n) {
        i = lt + 1
      } else {
        const end = html.indexOf(">", lt + 2)
        flush(lt)
        if (end < 0) return
        i = textStart = end + 1
      }
    } else if (c === 33 && html.startsWith("--", lt + 2)) {
      flush(lt)
      const from = lt + 4
      let end: number
      if (html.charCodeAt(from) === 62) end = from + 1
      else if (html.startsWith("->", from)) end = from + 2
      else {
        if (plain !== -1 && plain < from) plain = html.indexOf("-->", from)
        if (bang !== -1 && bang < from) bang = html.indexOf("--!>", from)
        if (plain < 0 && bang < 0) return
        end = bang >= 0 && (plain < 0 || bang < plain) ? bang + 4 : plain + 3
      }
      i = textStart = end
    } else if (c === 33 && foreign > 0 && html.startsWith("[CDATA[", lt + 2)) {
      flush(lt)
      const end = html.indexOf("]]>", lt + 9)
      const stop = end < 0 ? n : end
      if (stop > lt + 9) v.text?.(html.slice(lt + 9, stop), true)
      if (end < 0) return
      i = textStart = end + 3
    } else if (c === 33 || c === 63) {
      const end = html.indexOf(">", lt + 2)
      flush(lt)
      if (end < 0) return
      i = textStart = end + 1
    } else {
      i = lt + 1
    }
  }
  flush(n)
}

// The entities a page is likely to hold, and the punctuation an address can be spelled with.
const NAMED: Record<string, string> = {
  amp: "&",
  AMP: "&",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  quot: '"',
  QUOT: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  shy: "\u00ad",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  minus: "−",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  para: "¶",
  sect: "§",
  cent: "¢",
  pound: "£",
  yen: "¥",
  euro: "€",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  check: "✓",
  cross: "✗",
  infin: "∞",
  ne: "≠",
  le: "≤",
  ge: "≥",
  asymp: "≈",
  dagger: "†",
  permil: "‰",
  prime: "′",
  lrm: "\u200e",
  rlm: "\u200f",
  zwj: "\u200d",
  zwnj: "\u200c",
  Tab: "\t",
  NewLine: "\n",
  colon: ":",
  semi: ";",
  comma: ",",
  period: ".",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  lsqb: "[",
  rsqb: "]",
  lbrack: "[",
  rbrack: "]",
  lcub: "{",
  rcub: "}",
  lbrace: "{",
  rbrace: "}",
  quest: "?",
  excl: "!",
  num: "#",
  dollar: "$",
  percnt: "%",
  ast: "*",
  plus: "+",
  equals: "=",
  hyphen: "-",
  dash: "-",
  lowbar: "_",
  commat: "@",
  vert: "|",
  verbar: "|",
  grave: "`",
  Hat: "^",
}

const hexValue = (c: number) => (isDigit(c) ? c - 48 : (c | 32) >= 97 && (c | 32) <= 102 ? (c | 32) - 87 : -1)

/**
 * `text` with its character references decoded: `&#65;`, `&#x41;` (with or without the semicolon, as a browser
 * reads them) and the named ones above (with it). A reference that names no character is kept as written.
 */
export function decodeEntities(text: string): string {
  let amp = text.indexOf("&")
  if (amp < 0) return text
  const n = text.length
  const out: string[] = []
  let from = 0
  while (amp >= 0) {
    let decoded: string | null = null
    let end = amp + 1
    if (text.charCodeAt(amp + 1) === 35) {
      let j = amp + 2
      const hex = (text.charCodeAt(j) | 32) === 120
      if (hex) j++
      const digits = j
      let code = 0
      while (j < n && j - digits < 8) {
        const c = text.charCodeAt(j)
        const d = hex ? hexValue(c) : isDigit(c) ? c - 48 : -1
        if (d < 0) break
        code = code * (hex ? 16 : 10) + d
        j++
      }
      const more = j < n && (hex ? hexValue(text.charCodeAt(j)) >= 0 : isDigit(text.charCodeAt(j)))
      if (j > digits && !more && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        decoded = String.fromCodePoint(code)
        end = j < n && text.charCodeAt(j) === 59 ? j + 1 : j
      }
    } else {
      let j = amp + 1
      while (j < n && j - amp <= 32) {
        const c = text.charCodeAt(j)
        if (!isAlpha(c) && !isDigit(c)) break
        j++
      }
      if (j > amp + 1 && text.charCodeAt(j) === 59) {
        const name = text.slice(amp + 1, j)
        if (Object.hasOwn(NAMED, name)) {
          decoded = NAMED[name]
          end = j + 1
        }
      }
    }
    if (decoded !== null) {
      out.push(text.slice(from, amp), decoded)
      from = end
    }
    amp = text.indexOf("&", end)
  }
  if (!out.length) return text
  out.push(text.slice(from))
  return out.join("")
}

// A break, and nothing more: the element starts and ends a line.
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "body",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hgroup",
  "html",
  "legend",
  "main",
  "menu",
  "nav",
  "ol",
  "optgroup",
  "option",
  "section",
  "summary",
  "ul",
])
// A paragraph: a blank line before and after.
const PARAGRAPH = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr"])
// What a head holds. Any other element ends the head, as it does in a browser.
const IN_HEAD = new Set(["base", "link", "meta", "noscript", "script", "style", "template", "title"])
// Tables nested deeper than this are read as part of the cell they sit in.
const MAX_TABLES = 16

interface Row {
  cells: string[]
  /** the parts of the cell being written, or null before the row's first cell */
  cell: string[] | null
  /** the row holds a visible character */
  ink: boolean
}
interface Table {
  row: Row | null
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim()
const hasInk = (s: string) => /\S/.test(s)
const attrOf = (attrs: HtmlAttr[], name: string): string => {
  for (const a of attrs) if (a[0] === name) return a[1]
  return ""
}

/** The text of a page. A value that is not a string is "". */
export function htmlToText(value: unknown): string {
  if (typeof value !== "string" || value === "") return ""
  const lines: string[] = []
  let cur: string[] = []
  let ink = false
  // how many visible pieces were written so far: a link asks whether it had any text
  let written = 0
  let skip = 0
  let inHead = false
  let pre = 0
  let bullet = false
  let link: { href: string; at: number } | null = null
  const tables: Table[] = []
  let deeper = 0

  /** The row whose cell text goes to: the nearest open one. */
  const openRow = (): Row | null => {
    for (let k = tables.length - 1; k >= 0; k--) if (tables[k].row) return tables[k].row
    return null
  }
  const put = (s: string) => {
    const visible = hasInk(s)
    const row = openRow()
    let target = cur
    if (row) {
      if (!row.cell) {
        if (!visible) return
        row.cell = []
      }
      target = row.cell
    }
    if (visible) {
      if (bullet) {
        target.push("- ")
        bullet = false
      }
      written++
      if (row) row.ink = true
      else ink = true
    }
    target.push(s)
  }
  /** End the line being written. Inside a cell a break is a space: a cell is one line. */
  const brk = () => {
    const row = openRow()
    if (row) {
      row.cell?.push(" ")
      return
    }
    if (ink) lines.push(squash(cur.join("")))
    cur = []
    ink = false
  }
  const para = () => {
    brk()
    if (!openRow() && lines.length && lines[lines.length - 1] !== "") lines.push("")
  }
  /** A line break the page asked for: it ends the line even when the line is empty. */
  const hard = () => {
    const row = openRow()
    if (row) {
      row.cell?.push(" ")
      return
    }
    lines.push(ink ? squash(cur.join("")) : "")
    cur = []
    ink = false
  }
  const closeLink = () => {
    if (!link) return
    const { href, at } = link
    link = null
    if (href) put(written > at ? ` (${href})` : href)
  }
  /** Finish the top table's row: its line goes to the cell around it, or to the page. */
  const closeRow = () => {
    const k = tables.length - 1
    const row = k >= 0 ? tables[k].row : null
    if (!row) return
    if (row.cell) row.cells.push(squash(row.cell.join("")))
    tables[k].row = null
    if (!row.ink) return
    // joined as they are: an empty cell keeps its place between two bars
    const line = row.cells.join(" | ").trim()
    const outer = openRow()
    if (outer) {
      if (!outer.cell) outer.cell = []
      outer.cell.push(" ", line, " ")
      outer.ink = true
      return
    }
    brk()
    lines.push(line)
  }
  const newRow = (): Row => ({ cells: [], cell: null, ink: false })

  tokenizeHtml(value, {
    text(text, literal) {
      if (skip) return
      if (inHead) {
        if (!hasInk(text)) return
        inHead = false
      }
      const s = literal ? text : decodeEntities(text)
      if (pre > 0 && !openRow() && s.includes("\n")) {
        const parts = s.split("\n")
        for (let k = 0; k < parts.length; k++) {
          if (k > 0) hard()
          if (parts[k]) put(parts[k])
        }
        return
      }
      put(s)
    },
    open(name, attrs) {
      if (skip) {
        if (name === "template") skip++
        return
      }
      if (inHead) {
        if (IN_HEAD.has(name)) {
          if (name === "template") skip = 1
          return
        }
        inHead = false
      }
      if (name === "template") skip = 1
      else if (name === "head") inHead = true
      else if (name === "br") hard()
      else if (PARAGRAPH.has(name)) para()
      else if (name === "pre") {
        para()
        pre++
      } else if (name === "li") {
        brk()
        bullet = true
      } else if (name === "table") {
        if (tables.length < MAX_TABLES) {
          brk()
          tables.push({ row: null })
        } else deeper++
      } else if (name === "tr") {
        if (tables.length) {
          closeRow()
          tables[tables.length - 1].row = newRow()
        } else brk()
      } else if (name === "td" || name === "th") {
        if (tables.length) {
          const table = tables[tables.length - 1]
          if (!table.row) table.row = newRow()
          else if (table.row.cell) table.row.cells.push(squash(table.row.cell.join("")))
          table.row.cell = []
        } else put(" ")
      } else if (name === "a") {
        closeLink()
        link = { href: attrOf(attrs, "href").trim(), at: written }
      } else if (name === "img") {
        const alt = squash(attrOf(attrs, "alt"))
        if (alt) put(`[${alt}]`)
      } else if (BLOCK.has(name)) brk()
    },
    close(name) {
      if (skip) {
        if (name === "template") skip--
        return
      }
      if (inHead) {
        if (name === "head") inHead = false
        return
      }
      if (PARAGRAPH.has(name)) para()
      else if (name === "pre") {
        if (pre > 0) pre--
        para()
      } else if (name === "li" || name === "ul" || name === "ol") {
        brk()
        bullet = false
      } else if (name === "table") {
        if (deeper > 0) deeper--
        else if (tables.length) {
          closeRow()
          tables.pop()
          brk()
        }
      } else if (name === "tr") {
        if (tables.length) closeRow()
      } else if (name === "a") closeLink()
      else if (BLOCK.has(name)) brk()
    },
    raw(name, text) {
      if (skip || inHead || name !== "textarea") return
      put(decodeEntities(text))
    },
  })

  closeLink()
  while (tables.length) {
    closeRow()
    tables.pop()
  }
  brk()

  const out: string[] = []
  let blank = false
  for (const line of lines) {
    if (line === "") {
      blank = out.length > 0
      continue
    }
    if (blank) out.push("")
    blank = false
    out.push(line)
  }
  return out.join("\n")
}
