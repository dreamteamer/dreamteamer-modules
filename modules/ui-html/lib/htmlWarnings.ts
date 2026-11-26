// htmlWarnings — what a page holds that the desktop app's frame will not run or load.
//
// The frame is what keeps a page from acting: no script runs in it, nothing is fetched, a form goes nowhere.
// This list only tells the author, before anybody opens the record, which parts of the page will be dead. It
// reads the page with the same tokenizer the text projection uses, once, front to back, and it can miss a
// construct or name one that is only text. Neither costs anything: nothing is refused on its word.
import { tokenizeHtml } from "./htmlToText.ts"

export type Effect = "will not run" | "will not load" | "does nothing"

/** One construct in a page: what it is, what the frame does with it, and where it sits. */
export interface HtmlWarning {
  construct: string
  effect: Effect
  detail: string
}

// Elements that are a warning by being there.
const ELEMENTS: Record<string, Effect> = {
  form: "does nothing",
  base: "does nothing",
  iframe: "will not load",
  object: "will not load",
  embed: "will not load",
  link: "will not load",
}
// Attributes that hold an address.
const ADDRESS = new Set([
  "href",
  "xlink:href",
  "src",
  "action",
  "formaction",
  "data",
  "poster",
  "background",
  "cite",
  "codebase",
  "ping",
  "manifest",
  "longdesc",
])
// SVG animation can set an address on the element around it.
const ANIMATION = new Set(["animate", "set", "animatetransform", "animatemotion"])
const ANIMATED = new Set(["values", "to", "from", "by"])
// A link is followed by a person, never loaded with the page.
const FOLLOWED = new Set(["a", "area", "base"])

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13
const isHex = (c: number) => (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 102)
const isIdent = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c >= 128

/** A piece of the page short enough to print on one line. */
function short(text: string): string {
  let s = text.length > 60 ? text.slice(0, 60) : text
  const last = s.charCodeAt(s.length - 1)
  if (text.length > 60 && last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1)
  s = s.replace(/\s+/g, " ")
  return text.length > 60 ? `${s}…` : s
}

/**
 * What an address is to the frame, read as a browser reads its start: whitespace and control characters
 * dropped, case ignored. `script` is a javascript: address; `inline` is a data: address or a place in the
 * page (#id), which need no fetch; `none` is empty; everything else would be fetched.
 */
function kindOf(address: string): "script" | "inline" | "remote" | "none" {
  let head = ""
  for (let i = 0; i < address.length && head.length < 11; i++) if (address.charCodeAt(i) > 32) head += address[i]
  head = head.toLowerCase()
  if (head === "") return "none"
  if (head === "javascript:") return "script"
  if (head.startsWith("data:") || head.startsWith("#")) return "inline"
  return "remote"
}
const fetched = (address: string) => {
  const kind = kindOf(address)
  return kind === "remote" || kind === "script"
}

/** The addresses of a srcset: each candidate up to its first whitespace, as a browser splits them. */
function srcsetAddresses(value: string): string[] {
  const out: string[] = []
  const n = value.length
  let i = 0
  while (i < n) {
    while (i < n && (isSpace(value.charCodeAt(i)) || value.charCodeAt(i) === 44)) i++
    if (i >= n) break
    const start = i
    while (i < n && !isSpace(value.charCodeAt(i))) i++
    let end = i
    while (end > start && value.charCodeAt(end - 1) === 44) end--
    if (end > start) out.push(value.slice(start, end))
    if (end === i) {
      // no comma closed the address: its descriptors run to the next comma outside brackets
      let depth = 0
      while (i < n) {
        const c = value.charCodeAt(i++)
        if (c === 40) depth++
        else if (c === 41 && depth > 0) depth--
        else if (c === 44 && depth === 0) break
      }
    }
  }
  return out
}

/**
 * The addresses a stylesheet would fetch: every `url(…)` and every `@import`, outside comments and strings,
 * with CSS escapes read (`\75rl(` is `url(`). One pass.
 */
function scanCss(css: string, found: (construct: "@import" | "url() address", address: string) => void): void {
  const n = css.length
  let i = 0
  const comment = () => {
    const end = css.indexOf("*/", i + 2)
    i = end < 0 ? n : end + 2
  }
  const space = () => {
    while (i < n) {
      const c = css.charCodeAt(i)
      if (isSpace(c)) i++
      else if (c === 47 && css.charCodeAt(i + 1) === 42) comment()
      else break
    }
  }
  /** An escape, `i` on its backslash: the character it stands for, with `i` moved past it. */
  const escape = (): string => {
    i++
    if (i >= n) return ""
    let j = i
    while (j < n && j - i < 6 && isHex(css.charCodeAt(j))) j++
    if (j > i) {
      const code = parseInt(css.slice(i, j), 16)
      i = j < n && isSpace(css.charCodeAt(j)) ? j + 1 : j
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ""
    }
    const c = css.charCodeAt(i)
    if (c === 10 || c === 13 || c === 12) {
      i++
      return ""
    }
    const cp = css.codePointAt(i)
    const ch = String.fromCodePoint(cp)
    i += ch.length
    return ch
  }
  /** A run of name characters and escapes from `i`. */
  const ident = (): string => {
    let parts: string[] | null = null
    let from = i
    while (i < n) {
      const c = css.charCodeAt(i)
      if (c === 92) {
        if (!parts) parts = []
        parts.push(css.slice(from, i), escape())
        from = i
      } else if (isIdent(c)) i++
      else break
    }
    if (!parts) return css.slice(from, i)
    parts.push(css.slice(from, i))
    return parts.join("")
  }
  /** A string, `i` on its opening quote: its content, to the matching quote or the end of the line. */
  const string = (): string => {
    const quote = css.charCodeAt(i++)
    const parts: string[] = []
    let from = i
    while (i < n) {
      const c = css.charCodeAt(i)
      if (c === quote || c === 10 || c === 13 || c === 12) break
      if (c === 92) {
        parts.push(css.slice(from, i), escape())
        from = i
      } else i++
    }
    parts.push(css.slice(from, i))
    if (i < n && css.charCodeAt(i) === quote) i++
    return parts.join("")
  }
  /** What stands between the brackets of url(…), `i` just after the opening one. */
  const urlArgument = (): string => {
    while (i < n && isSpace(css.charCodeAt(i))) i++
    let address: string
    const c = css.charCodeAt(i)
    if (c === 34 || c === 39) address = string()
    else {
      const parts: string[] = []
      let from = i
      while (i < n) {
        const d = css.charCodeAt(i)
        if (d === 41 || isSpace(d)) break
        if (d === 92) {
          parts.push(css.slice(from, i), escape())
          from = i
        } else i++
      }
      parts.push(css.slice(from, i))
      address = parts.join("")
    }
    while (i < n && isSpace(css.charCodeAt(i))) i++
    if (i < n && css.charCodeAt(i) === 41) i++
    return address
  }

  while (i < n) {
    const c = css.charCodeAt(i)
    if (c === 47 && css.charCodeAt(i + 1) === 42) comment()
    else if (c === 34 || c === 39) string()
    else if (c === 64) {
      i++
      if (ident().toLowerCase() !== "import") continue
      space()
      const q = css.charCodeAt(i)
      if (q === 34 || q === 39) found("@import", string())
      else if (ident().toLowerCase() === "url" && css.charCodeAt(i) === 40) {
        i++
        found("@import", urlArgument())
      }
    } else if (c === 92 || isIdent(c)) {
      const start = i
      const name = ident()
      if (i === start) i++
      else if (css.charCodeAt(i) === 40 && name.length === 3 && name.toLowerCase() === "url") {
        i++
        found("url() address", urlArgument())
      }
    } else i++
  }
}

/**
 * Every construct in `value` the frame will not run or load, one entry per occurrence, in the order of the
 * page: a script element; an attribute whose name starts with `on`; a javascript: address; form, iframe,
 * object, embed, base, link and meta http-equiv; a target on a link; and an address the page would fetch
 * (src, srcset, poster, an object's data, the href of anything that is not a link, CSS url() and @import)
 * unless it is a data: address or a place in the page. A value that is not a string has none.
 */
export function htmlWarnings(value: string): HtmlWarning[] {
  if (typeof value !== "string" || value === "") return []
  const out: HtmlWarning[] = []
  const add = (construct: string, effect: Effect, detail: string) => {
    out.push({ construct, effect, detail })
  }
  const css = (text: string) =>
    scanCss(text, (construct, address) => {
      if (fetched(address)) add(construct, "will not load", short(address))
    })

  tokenizeHtml(value, {
    open(rawName, attrs) {
      if (rawName === "script") add("script element", "will not run", "<script>")
      else if (Object.hasOwn(ELEMENTS, rawName)) add(`${rawName} element`, ELEMENTS[rawName], `<${rawName}>`)
      if (!attrs.length) return
      const name = short(rawName)
      // a browser reads the first of a repeated attribute and drops the rest
      const seen = attrs.length > 1 ? new Set<string>() : null
      for (const [rawAttr, v] of attrs) {
        if (seen) {
          if (seen.has(rawAttr)) continue
          seen.add(rawAttr)
        }
        const attr = short(rawAttr)
        if (rawAttr.length > 2 && rawAttr.startsWith("on"))
          add(`${attr} attribute`, "will not run", `<${name} ${attr}>`)
        else if (rawAttr === "style") css(v)
        else if (rawAttr === "http-equiv" && rawName === "meta")
          add("meta http-equiv", "does nothing", `<meta http-equiv="${short(v)}">`)
        else if (rawAttr === "target" && (rawName === "a" || rawName === "area"))
          add("target attribute", "does nothing", `<${name} target="${short(v)}">`)
        else if (rawAttr === "srcset" || rawAttr === "imagesrcset") {
          for (const address of srcsetAddresses(v))
            if (fetched(address)) add(`${attr} address`, "will not load", `<${name} ${attr}="${short(address)}">`)
        } else if (ANIMATION.has(rawName) && ANIMATED.has(rawAttr)) {
          if (v.split(";").some(part => kindOf(part) === "script"))
            add("javascript: address", "will not run", `<${name} ${attr}>`)
        } else if (ADDRESS.has(rawAttr)) {
          const kind = kindOf(v)
          if (kind === "script") add("javascript: address", "will not run", `<${name} ${attr}>`)
          else if (kind === "remote" && loaded(rawName, rawAttr))
            add(`${attr} address`, "will not load", `<${name} ${attr}="${short(v)}">`)
        }
      }
    },
    raw(name, text) {
      if (name === "style") css(text)
    },
  })
  return out
}

/** Would the page fetch this attribute's address by being drawn? */
function loaded(element: string, attr: string): boolean {
  if (attr === "src" || attr === "poster" || attr === "background") return true
  if (attr === "data") return element === "object"
  if (attr === "href" || attr === "xlink:href") return !FOLLOWED.has(element)
  return false
}
