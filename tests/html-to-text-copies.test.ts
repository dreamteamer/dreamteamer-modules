// ONE PROJECTION, TWO COPIES. `htmlToText.ts` is the text a page is read as: the NotebookLM export sends it and
// ui-html prints it, and a module never imports another module, so each carries the file. They are the same
// file, byte for byte; a fix made in one and not the other fails here.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { MODULES, moduleIds } from "./helpers/workspace.ts"

const copies = moduleIds()
  .map(m => path.join(MODULES, m, "lib", "htmlToText.ts"))
  .filter(f => fs.existsSync(f))

test("notebooklm and ui-html each carry htmlToText.ts", () => {
  assert.deepEqual(
    copies.map(f => path.relative(MODULES, f).split(path.sep).join("/")),
    ["notebooklm/lib/htmlToText.ts", "ui-html/lib/htmlToText.ts"]
  )
})

test("every copy of htmlToText.ts is byte-identical to the first", () => {
  const [first, ...rest] = copies.map(f => fs.readFileSync(f))
  assert.ok(first?.length > 0, "the first copy is empty or missing")
  for (const [i, bytes] of rest.entries())
    assert.ok(
      bytes.equals(first),
      `${path.relative(MODULES, copies[i + 1])} differs from ${path.relative(MODULES, copies[0])} — make the change in both`
    )
})
