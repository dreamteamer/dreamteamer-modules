// htmlWarnings — what a page holds that the desktop app's frame will not run or load, one entry per occurrence,
// in the order of the page. Pure: a value in, a list out. Then the clock, as for htmlToText.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { htmlWarnings } from "../lib/htmlWarnings.ts"

const said = (html: unknown) => htmlWarnings(html as string).map(w => `${w.construct} ${w.effect}`)

const A = "https://northwind.example/a.png"
const rows: [string, string, string[]][] = [
  // a page with none of them
  [
    "a page of headings, lists, a table, inline style, a data picture and links draws nothing",
    `<h1 style="color:#036">Plan</h1><ul><li>one</li></ul><table><tr><td>1</td></tr></table>
     <img alt="chart" src="data:image/png;base64,AAAA"><a href="/content/tasks/t1">task</a>
     <a href="tasks/t1">task</a><a href="#top">top</a><a href="https://northwind.example/">out</a>
     <svg viewBox="0 0 10 10"><defs><symbol id="i"><path d="M0 0h10"/></symbol></defs><use href="#i"/></svg>
     <style>h1 { background: url("data:image/png;base64,AAAA") } p { color: red }</style>`,
    [],
  ],
  ["text that only looks like markup", "a < b, url(x) and @import in prose, onclick=1", []],

  // each construct alone
  ["a script element", "<script>alert(1)</script>", ["script element will not run"]],
  [
    "a script with an address is two things",
    `<script src="https://northwind.example/a.js"></script>`,
    ["script element will not run", "src address will not load"],
  ],
  ["an attribute whose name starts with on", `<p onclick="go()">x</p>`, ["onclick attribute will not run"]],
  [
    "every on attribute of a tag",
    `<img onerror="a()" onload="b()" alt="x">`,
    ["onerror attribute will not run", "onload attribute will not run"],
  ],
  ["an attribute named on, and one that only holds the letters", `<p on="x" icon="y" data-onclick="z">x</p>`, []],
  ["a javascript: address", `<a href="javascript:alert(1)">x</a>`, ["javascript: address will not run"]],
  [
    "a javascript: address in a form's action",
    `<form action="javascript:go()"></form>`,
    ["form element does nothing", "javascript: address will not run"],
  ],
  ["a form", "<form><input name=q></form>", ["form element does nothing"]],
  [
    "an iframe",
    `<iframe src="https://northwind.example/"></iframe>`,
    ["iframe element will not load", "src address will not load"],
  ],
  ["an iframe with a srcdoc", `<iframe srcdoc="<p>x</p>"></iframe>`, ["iframe element will not load"]],
  [
    "an object",
    `<object data="https://northwind.example/a.swf"></object>`,
    ["object element will not load", "data address will not load"],
  ],
  ["an embed", `<embed src="a.swf">`, ["embed element will not load", "src address will not load"]],
  ["a base", `<base href="https://northwind.example/">`, ["base element does nothing"]],
  [
    "a link element",
    `<link rel="stylesheet" href="https://northwind.example/a.css">`,
    ["link element will not load", "href address will not load"],
  ],
  [
    "a meta http-equiv",
    `<meta http-equiv="refresh" content="0;url=https://northwind.example/">`,
    ["meta http-equiv does nothing"],
  ],
  ["a meta that is not http-equiv", `<meta charset="utf-8"><meta name="viewport" content="width=device-width">`, []],
  ["a target on a link", `<a href="/content/tasks/t1" target="_blank">x</a>`, ["target attribute does nothing"]],
  [
    "a target on an area",
    `<map><area href="/content/tasks/t1" target="_top"></map>`,
    ["target attribute does nothing"],
  ],

  // addresses
  ["a picture from another place", `<img src="${A}" alt="x">`, ["src address will not load"]],
  ["a picture beside the page", `<img src="pic.png">`, ["src address will not load"]],
  ["a data: picture", `<img src="data:image/png;base64,AAAA">`, []],
  ["a data: address that itself holds http:", `<img src="data:text/plain,http://northwind.example/">`, []],
  ["a picture with no address", `<img src="" alt="x"><img alt="y">`, []],
  [
    "a srcset, each candidate",
    `<img srcset="a.png 1x, ${A} 2x">`,
    ["srcset address will not load", "srcset address will not load"],
  ],
  [
    "a srcset of data: candidates, which hold commas",
    `<img srcset="data:image/png;base64,AA== 1x, data:image/png;base64,BB== 2x">`,
    [],
  ],
  ["a poster", `<video poster="${A}"></video>`, ["poster address will not load"]],
  [
    "a media source",
    `<video><source src="a.mp4"><track src="a.vtt"></video>`,
    ["src address will not load", "src address will not load"],
  ],

  // SVG
  ["an SVG use of a place in the page", `<svg><use href="#icon"/><use xlink:href="#icon"/></svg>`, []],
  ["an SVG use of another file", `<svg><use href="sprite.svg#icon"/></svg>`, ["href address will not load"]],
  ["an SVG image by xlink:href", `<svg><image xlink:href="${A}"/></svg>`, ["xlink:href address will not load"]],
  ["an SVG image as data:", `<svg><image href="data:image/png;base64,AAAA"/></svg>`, []],
  ["an SVG onload", `<svg onload="go()"></svg>`, ["onload attribute will not run"]],
  ["a script inside an SVG", `<svg><script>go()</script></svg>`, ["script element will not run"]],
  ["a link inside an SVG is a link", `<svg><a href="/content/tasks/t1"><text>t</text></a></svg>`, []],
  [
    "a javascript: link inside an SVG",
    `<svg><a xlink:href="javascript:go()"><text>t</text></a></svg>`,
    ["javascript: address will not run"],
  ],
  [
    "an SVG animation that sets a javascript: address",
    `<svg><a><animate attributeName="href" values="javascript:go()"/></a></svg>`,
    ["javascript: address will not run"],
  ],

  // CSS
  [
    "a style block: @import and url()",
    `<style>@import "https://northwind.example/a.css"; p { background: url(https://northwind.example/b.png) } q { background: url("data:image/png;base64,AA") }</style>`,
    ["@import will not load", "url() address will not load"],
  ],
  ["@import url()", `<style>@import url("a.css") screen;</style>`, ["@import will not load"]],
  [
    "url() in capitals with spaces and quotes",
    `<style>p { background: URL(  'b.png'  ) }</style>`,
    ["url() address will not load"],
  ],
  ["url() spelled with an escape", `<style>p { background: \\75rl(b.png) }</style>`, ["url() address will not load"]],
  ["url() inside a CSS comment, and a place in the page", `<style>/* url(b.png) */ p { fill: url(#grad) }</style>`, []],
  ["url() in a style attribute", `<p style="background: url(b.png)">x</p>`, ["url() address will not load"]],
  [
    "font faces",
    `<style>@font-face { font-family: f; src: url(f.woff2) format("woff2"), url(data:font/woff2;base64,AA) }</style>`,
    ["url() address will not load"],
  ],

  // spellings
  [
    "mixed case",
    `<SCRIPT>x()</SCRIPT><IMG SRC="${A}" OnClick="x()"><A HREF="JaVaScRiPt:x()">y</A>`,
    [
      "script element will not run",
      "src address will not load",
      "onclick attribute will not run",
      "javascript: address will not run",
    ],
  ],
  ["newlines and tabs inside a tag", `<img\n\tsrc\n=\n"${A}"\n>`, ["src address will not load"]],
  [
    "unquoted attribute values",
    `<img src=${A} onerror=go()>`,
    ["src address will not load", "onerror attribute will not run"],
  ],
  [
    "a scheme spelled with entities",
    `<a href="jav&#x61;script:go()">x</a><a href="&#106;avascript&colon;go()">y</a><a href="jav&#x61script:go()">z</a>`,
    ["javascript: address will not run", "javascript: address will not run", "javascript: address will not run"],
  ],
  [
    "a scheme with whitespace in it",
    `<a href=" java\tscr\nipt:go()">x</a><a href="&#9;javascript:go()">y</a>`,
    ["javascript: address will not run", "javascript: address will not run"],
  ],
  [
    "the word javascript in an address is not the scheme",
    `<a href="/content/notes/javascript:basics">x</a><a href="https://northwind.example/?q=javascript:">y</a>`,
    [],
  ],

  // where a construct is not one
  ["inside a comment", `<!-- <script>x()</script> <img src="${A}" onclick="x()"> -->ok`, []],
  ["inside an attribute value", `<a href="/content/tasks/t1" title="<script>alert(1)</script> onclick=">x</a>`, []],
  ["inside a textarea or a title", `<title><script>x()</script></title><textarea><img src="${A}"></textarea>`, []],
  [
    "inside a script's own text",
    `<script>document.write('<img src="${A}" onerror="x()">')</script>`,
    ["script element will not run"],
  ],
  ["the first of a repeated attribute is the one a browser reads", `<a href="#top" href="javascript:go()">x</a>`, []],

  // order
  [
    "the order of the page",
    `<p onclick="a()">x</p><img src="${A}"><script>b()</script><form></form>`,
    [
      "onclick attribute will not run",
      "src address will not load",
      "script element will not run",
      "form element does nothing",
    ],
  ],
]

describe("htmlWarnings", () => {
  for (const [name, html, expected] of rows)
    test(name, () => {
      assert.deepEqual(said(html), expected)
    })

  test("a value that is not a string draws nothing", () => {
    for (const v of [null, undefined, 42, ["<script>"], { a: "<script>" }]) assert.deepEqual(said(v), [])
  })

  test("the detail says where: the tag, the attribute, and the address cut short", () => {
    const long = `https://northwind.example/${"a".repeat(500)}.png`
    const [img] = htmlWarnings(`<img alt="x" src="${long}">`)
    assert.match(img.detail, /^<img src="https:\/\/northwind\.example\/a+…">$/)
    assert.ok(img.detail.length < 120, `${img.detail.length} characters`)
    assert.deepEqual(
      htmlWarnings(`<button onclick="go()">x</button><a href="javascript:go()">y</a><script src="a.js"></script>`).map(
        w => w.detail
      ),
      ["<button onclick>", "<a href>", "<script>", '<script src="a.js">']
    )
    assert.deepEqual(
      htmlWarnings(`<style>@import "a.css"; p { background: url(b.png) }</style><meta http-equiv="Refresh">`).map(
        w => w.detail
      ),
      ["a.css", "b.png", '<meta http-equiv="Refresh">']
    )
  })

  test("the same value gives the same list", () => {
    const page = `<p onclick="a()">x</p><img src="${A}">`
    assert.deepEqual(htmlWarnings(page), htmlWarnings(page))
  })
})

describe("htmlWarnings does not look back over its input", () => {
  const N = 2_000_000
  const timed = (name: string, value: string) =>
    test(`${name}, in under a second`, () => {
      const t = performance.now()
      htmlWarnings(value)
      const ms = performance.now() - t
      assert.ok(ms < 1000, `${Math.round(ms)} ms`)
    })
  for (const ch of [
    "<",
    ">",
    "&",
    '"',
    "'",
    " ",
    "\n",
    "a",
    "-",
    "/",
    "=",
    "(",
    ")",
    "@",
    "\\",
    "*",
    ":",
    "#",
    ",",
    "\u0000",
  ])
    timed(`2,000,000 of ${JSON.stringify(ch)}`, ch.repeat(N))
  const style = (body: string) => `<style>${body}</style>`
  const shapes: Record<string, string> = {
    "a style of (": style("(".repeat(N)),
    "a style of url(": style("url(".repeat(N / 4)),
    "a style of @import": style("@import ".repeat(N / 8)),
    "a style of /*": style("/*".repeat(N / 2)),
    "a style of */": style("*/".repeat(N / 2)),
    "a style of closed comments": style("/* a */".repeat(N / 7)),
    "a style of backslashes": style("\\".repeat(N)),
    "a style of quotes": style('"'.repeat(N)),
    "a style of escapes": style("\\75 ".repeat(N / 4)),
    "a style of u": style("u".repeat(N)),
    "a style attribute of url(": `<p style="${"url(".repeat(N / 4)}">`,
    pictures: `<img src=x>`.repeat(N / 11),
    "on attributes": `<a ${"onclick=x ".repeat(N / 10)}>`,
    "a srcset of commas": `<img srcset="${",".repeat(N)}">`,
    "a srcset of candidates": `<img srcset="${"a.png 1x, ".repeat(N / 10)}">`,
    "an address of tabs": `<a href="${"\t".repeat(N)}javascript:x">`,
    "an address of entities": `<a href="${"&#9;".repeat(N / 4)}javascript:x">`,
    "nested open tags": "<b><i><u>".repeat(N / 9),
    scripts: "<script>x</script>".repeat(N / 18),
  }
  for (const [name, value] of Object.entries(shapes)) timed(name, value)
})
