// htmlToText — a page as the text a reader gets from it. One row per rule the projection states, then the
// markup a forgiving parser has to survive, then the clock: a hostile value must not hold an export.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { htmlToText, decodeEntities } from "../lib/htmlToText.ts"

const rows: [string, unknown, string][] = [
  // what is not a page
  ["a number is no text", 42, ""],
  ["null is no text", null, ""],
  ["undefined is no text", undefined, ""],
  ["a list is no text", ["<p>a</p>"], ""],
  ["an object is no text", { page: "<p>a</p>" }, ""],
  ["an empty string is no text", "", ""],
  ["plain text is itself", "hello", "hello"],

  // dropped
  ["a comment is dropped", "a<!-- hidden -->b", "ab"],
  ["a script's content is dropped", "<p>a</p><script>alert('x < y')</script><p>b</p>", "a\n\nb"],
  ["a style's content is dropped", "<style>p { color: red }</style><p>a</p>", "a"],
  ["a template's content is dropped", "<template><p>hidden</p></template>shown", "shown"],
  [
    "a head and its title are dropped",
    "<head><title>Tab</title><meta charset=utf-8></head><body>shown</body>",
    "shown",
  ],
  ["a title alone is dropped", "<title>Tab</title>shown", "shown"],

  // blocks become line breaks
  ["paragraphs are separated", "<p>one</p><p>two</p>", "one\n\ntwo"],
  ["a div is a line", "<div>one</div><div>two</div>", "one\ntwo"],
  ["a heading stands alone", "<h1>Title</h1><p>text</p>", "Title\n\ntext"],
  ["a section and an article break", "<section>a</section><article>b</article><footer>c</footer>", "a\nb\nc"],
  ["a line break breaks", "one<br>two<br/>three", "one\ntwo\nthree"],
  ["a rule separates", "one<hr>two", "one\n\ntwo"],
  ["a blockquote is a paragraph", "a<blockquote>quoted</blockquote>b", "a\n\nquoted\n\nb"],
  ["pre keeps its lines", "<pre>first\n  second</pre>", "first\nsecond"],
  ["inline elements do not break", "<p>a <b>b</b> <i>c</i><span>d</span></p>", "a b cd"],

  // lists
  ["a list item starts with a dash", "<ul><li>a</li><li>b</li></ul>", "- a\n- b"],
  ["an ordered list too", "<ol><li>a</li><li>b</li></ol>", "- a\n- b"],
  ["nested lists", "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>", "- a\n- b\n- c\n- d"],
  ["an empty item writes nothing", "<ul><li></li><li>b</li></ul>after", "- b\nafter"],

  // tables
  [
    "a row is its cells joined by a bar",
    "<table><tr><th>Name</th><th>Role</th></tr><tr><td>Dana Oren</td><td>Lead</td></tr></table>",
    "Name | Role\nDana Oren | Lead",
  ],
  [
    "a table with sections and line breaks in the source",
    "<table>\n <thead>\n  <tr>\n   <th>Name</th>\n   <th>Role</th>\n  </tr>\n </thead>\n <tbody>\n  <tr><td>Sam Diaz</td><td>Review</td></tr>\n </tbody>\n</table>",
    "Name | Role\nSam Diaz | Review",
  ],
  ["an empty cell keeps its place", "<table><tr><td>a</td><td></td><td>c</td></tr></table>", "a |  | c"],
  ["a cell is one line", "<table><tr><td><p>a</p><p>b</p></td><td>c<br>d</td></tr></table>", "a b | c d"],
  [
    "a table inside a list",
    "<ul><li>Totals<table><tr><td>1</td><td>2</td></tr></table></li><li>x</li></ul>",
    "- Totals\n1 | 2\n- x",
  ],
  [
    "a table inside a cell stays in the cell",
    "<table><tr><td>a</td><td><table><tr><td>x</td><td>y</td></tr></table></td><td>b</td></tr></table>",
    "a | x | y | b",
  ],

  // links and pictures
  [
    "a link is text (address)",
    '<a href="https://northwind.example/plan">the plan</a>',
    "the plan (https://northwind.example/plan)",
  ],
  ["a link with no address is its text", "<a>the plan</a>", "the plan"],
  ["a link with no text is its address", '<a href="https://northwind.example/"></a>', "https://northwind.example/"],
  [
    "a link to a record",
    '<p>See <a href="/content/tasks/write-the-brief">the task</a>.</p>',
    "See the task (/content/tasks/write-the-brief).",
  ],
  [
    "an address with an entity",
    '<a href="https://northwind.example/?a=1&amp;b=2">q</a>',
    "q (https://northwind.example/?a=1&b=2)",
  ],
  ["an address holding a closing bracket", '<a href="a>b">t</a>', "t (a>b)"],
  ["a picture is its alt in brackets", '<img src="data:image/png;base64,AAAA" alt="A chart">', "[A chart]"],
  ["a picture with no alt is nothing", "a<img src=x>b", "ab"],
  [
    "a picture inside a link is its text",
    '<a href="/content/notes/n1"><img alt="Open"></a>',
    "[Open] (/content/notes/n1)",
  ],

  // entities
  ["named entities", "&amp; &lt; &gt; &quot; &apos; &copy; &mdash; &hellip;", "& < > \" ' © — …"],
  [
    "numeric entities",
    "&#65;&#x42;&#x63; &#1513;&#x5DC;&#1493;&#1501; &#x1F600;",
    "ABc \u05e9\u05dc\u05d5\u05dd \u{1F600}",
  ],
  ["a non-breaking space is a space", "a&nbsp;&nbsp;b", "a b"],
  ["an unknown entity is kept as written", "&bogus; &amp;bogus; AT&T &; &#; &#x;", "&bogus; &bogus; AT&T &; &#; &#x;"],
  ["a number that is no character is kept as written", "&#xD800; &#x110000; &#0;", "&#xD800; &#x110000; &#0;"],

  // whitespace
  ["lines are trimmed", "<p>   a   </p>\n<p>\tb\t</p>", "a\n\nb"],
  ["a run of blank lines is one", "<p>a</p><br><br><br><p></p><p>b</p>", "a\n\nb"],
  ["a line break in running text is a space", "<p>one\n   two</p>", "one two"],
  ["no blank line at either end", "<br><p>a</p><br>", "a"],

  // what a forgiving parser survives
  ["unclosed paragraphs", "<p>one<p>two", "one\n\ntwo"],
  ["unclosed list items", "<ul><li>a<li>b", "- a\n- b"],
  ["an unclosed inline element", "<b>bold", "bold"],
  ["mismatched closing tags", "<b><i>x</b></i> y</div></p>z", "x y\n\nz"],
  ["a closing tag nothing opened", "</span>stray</td></tr></table>", "stray"],
  ["an unclosed row and cell", "<table><tr><td>a<td>b<tr><td>c", "a | b\nc"],
  ["an unclosed link ends at the end", '<a href="/x">text', "text (/x)"],
  ["an unclosed script drops the rest", "shown<script>never", "shown"],
  ["an unclosed comment drops the rest", "shown<!-- never", "shown"],
  ["a tag cut off by the end is dropped", 'shown<a href="', "shown"],
  ["tags in capitals", "<P>One</P><UL><LI>x</UL><BR>", "One\n\n- x"],
  ["a tag across lines", '<a\n  href="/y"\n  class="k"\n>t</a>', "t (/y)"],

  // real angle brackets, other scripts, a whole document
  ["a real less-than and greater-than", "a < b and c > d, 1<2", "a < b and c > d, 1<2"],
  ["a lone bracket at the end", "a <", "a <"],
  // written as escapes: this repository keeps non-latin literals out of its files
  [
    "Hebrew text",
    '<div dir="rtl"><h2>\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd</h2><p>\u05d8\u05e7\u05e1\u05d8 &amp; \u05e2\u05d5\u05d3</p></div>',
    "\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd\n\n\u05d8\u05e7\u05e1\u05d8 & \u05e2\u05d5\u05d3",
  ],
  [
    "a whole document",
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Northwind weekly</title>\n<style>h1 { color: #036 }</style>\n</head>\n<body>\n<h1>Northwind weekly</h1>\n<p>Owner: Priya Raman</p>\n</body>\n</html>\n',
    "Northwind weekly\n\nOwner: Priya Raman",
  ],
  ["text inside an SVG", "<svg viewBox='0 0 10 10'><title>Icon</title><text x='1' y='1'>Label</text></svg>", "Label"],
]

describe("htmlToText", () => {
  for (const [name, input, expected] of rows)
    test(name, () => {
      assert.equal(htmlToText(input), expected)
    })

  test("the same value gives the same text, every time", () => {
    const page = "<h1>Harbor Mutual</h1><ul><li>a</li></ul><table><tr><td>1</td><td>2</td></tr></table>"
    const first = htmlToText(page)
    for (let i = 0; i < 3; i++) assert.equal(htmlToText(page), first)
    assert.equal(first, "Harbor Mutual\n\n- a\n1 | 2")
  })

  test("the text of a page holds no tag", () => {
    const page =
      '<h1>T</h1><p onclick="x()">a <b>b</b></p><script>if (a < b) run()</script><style>p > a { color: red }</style><ul><li>one</li></ul>'
    const text = htmlToText(page)
    assert.doesNotMatch(text, /<|>/)
    assert.doesNotMatch(text, /run\(\)|color: red|onclick/)
  })
})

describe("decodeEntities", () => {
  test("text without an ampersand is returned as it is", () => {
    assert.equal(decodeEntities("plain"), "plain")
  })
  test("a numeric reference with no semicolon is still a character", () => {
    assert.equal(decodeEntities("jav&#x61script&#58;"), "javascript:")
  })
  test("a named reference needs its semicolon", () => {
    assert.equal(decodeEntities("&amp &amp;"), "&amp &")
  })
})

// The clock. Each value is 2,000,000 characters; a projection that looks back over its input for any of
// them would take minutes.
describe("htmlToText does not look back over its input", () => {
  const N = 2_000_000
  const singles = [
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
    "!",
    "#",
    ";",
    "?",
    "[",
    "]",
    "\u05d0",
    "\u0000",
  ]
  for (const ch of singles)
    test(`2,000,000 of ${JSON.stringify(ch)} in under a second`, () => {
      const value = ch.repeat(N)
      const t = performance.now()
      htmlToText(value)
      const ms = performance.now() - t
      assert.ok(ms < 1000, `${Math.round(ms)} ms`)
    })
  const repeats = [
    "<b>",
    "<p>",
    "<li>",
    "<table><tr><td>",
    "<td>x",
    "<a href=x>",
    "<!--",
    "</",
    "<!",
    "&#",
    "&a",
    "<a ",
    '<a href="',
    "<br>",
    "<script>",
    "</b>",
    "<pre>\n",
    // a comment closed in one spelling while the other never appears: the search for the absent one must not repeat
    "<!-- a -->",
    "<!-- a --!>",
    "<svg><![CDATA[x]]>",
    "<script></scripx",
    "<table><tr><td><table><tr><td>x</td></tr></table>",
    "<a href=/x>t</a> ",
    "&#x41",
  ]
  for (const unit of repeats)
    test(`2,000,000 characters of ${JSON.stringify(unit)} repeated, in under a second`, () => {
      const value = unit.repeat(Math.floor(N / unit.length))
      const t = performance.now()
      htmlToText(value)
      const ms = performance.now() - t
      assert.ok(ms < 1000, `${Math.round(ms)} ms`)
    })
})
