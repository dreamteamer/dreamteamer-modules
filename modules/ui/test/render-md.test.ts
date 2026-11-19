// The markdown grammar as data: blocks, inline marks, task items, tables, slots — and nothing that could carry
// markup of its own (a `javascript:` link stays text).
import { test } from "node:test"
import assert from "node:assert/strict"
import { mdToPlainText, renderMd, respectLineBreaks, slotToken, type MdNode } from "../src/lib/renderMd.ts"

const tags = (nodes: MdNode[]) => nodes.map(n => (typeof n === "string" ? "#text" : "slot" in n ? "#slot" : n.tag))

test("blocks: headings, paragraphs, lists, a quote, a fence, a table", () => {
  const md =
    "# Plan\n\nOne line\nsame paragraph\n\n- a\n- b\n\n1. first\n\n> quoted\n\n```\nx = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |"
  const nodes = renderMd(md)
  assert.deepEqual(tags(nodes), ["h1", "p", "ul", "ol", "blockquote", "pre", "div"])
  const p = nodes[1] as { children: MdNode[] }
  assert.deepEqual(p.children, ["One line same paragraph"])
  const pre = nodes[5] as { children: MdNode[] }
  assert.deepEqual(pre.children, ["x = 1"])
})

test("inline: bold, em, code, a link — and a link with a script scheme stays its label", () => {
  const [p] = renderMd("**b** *e* `c` [ok](https://northwind.example) [bad](javascript:alert(1))") as [
    { children: MdNode[] },
  ]
  const kinds = p.children.filter(n => typeof n !== "string").map(n => (n as { tag: string }).tag)
  assert.deepEqual(kinds, ["strong", "em", "code", "a"])
  const a = p.children.find(n => typeof n !== "string" && "tag" in n && n.tag === "a") as {
    attrs: Record<string, unknown>
  }
  assert.equal(a.attrs["href"], "https://northwind.example")
  assert.ok(p.children.includes("bad"))
})

test("a task item draws an inert checkbox in its state", () => {
  const [ul] = renderMd("- [x] done\n- [ ] open") as [
    { children: Array<{ attrs: Record<string, unknown>; children: MdNode[] }> },
  ]
  const boxes = ul.children.map(li => (li.children[0] as { attrs: Record<string, unknown> }).attrs)
  assert.deepEqual(
    boxes.map(b => [b["checked"], b["disabled"]]),
    [
      [true, true],
      [false, true],
    ]
  )
})

test("slots: a placeholder becomes a slot node in prose and its text inside code", () => {
  const [p] = renderMd(`**${slotToken(0)}** and \`${slotToken(0)}\``, ["Dana Oren"]) as [{ children: MdNode[] }]
  const strong = p.children[0] as { tag: string; children: MdNode[] }
  assert.equal(strong.tag, "strong")
  assert.deepEqual(strong.children, [{ slot: 0 }])
  const code = p.children[2] as { children: MdNode[] }
  assert.deepEqual(code.children, ["Dana Oren"])
})

test("a Hebrew table reads right to left; a Latin one left to right", () => {
  const dirOf = (md: string) =>
    (renderMd(md)[0] as { children: Array<{ attrs: { dir: string } }> }).children[0]!.attrs.dir
  assert.equal(dirOf("| שם | ערך |\n|---|---|\n| א | ב |"), "rtl")
  assert.equal(dirOf("| a | b |\n|---|---|\n| 1 | 2 |"), "ltr")
})

test("one line of plain text for a cell", () => {
  assert.equal(mdToPlainText("# Title\n\n**bold** and [link](https://x.example)\n\n- item"), "Title bold and link item")
  assert.equal(mdToPlainText("| a | b |\n|---|---|\n| 1 | 2 |"), "a · b 1 · 2")
})

test("a card template keeps its line breaks, and leaves block constructs alone", () => {
  assert.equal(respectLineBreaks("one\ntwo"), "one\n\ntwo")
  assert.equal(respectLineBreaks("- a\n- b"), "- a\n- b")
})
