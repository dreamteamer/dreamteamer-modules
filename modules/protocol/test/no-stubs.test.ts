// NO STUB RECORDS (protocol 0.2.0). The engine has written no `stub: true` record since 0.45, so the protocol no
// longer documents a `$stubs` key nor computes one: a row's contested roots are its `$duplicates` alone.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = rel => fs.readFileSync(path.join(PKG, rel), "utf8")

test("PROTOCOL.md documents no $stubs key and no stub records", () => {
  assert.doesNotMatch(read("PROTOCOL.md"), /\$stubs|stub: true/)
})

test("the host side computes no $stubs and reads no stub field", () => {
  const host = path.join(PKG, "src", "host")
  // every file under host/, its modules' own folders (host/fsdata/, host/nav/, …) included
  const hits = (fs.readdirSync(host, { recursive: true }) as string[])
    .filter(f => fs.statSync(path.join(host, f)).isFile())
    .map(f => f.split(path.sep).join("/"))
    .flatMap(f =>
      read(path.join("src", "host", f))
        .split("\n")
        .map((l, i): [string, number, string] => [f, i + 1, l])
    )
    .filter(([, , l]) => /stub/i.test(l))
    .map(([f, n, l]) => `src/host/${f}:${n}  ${l.trim().slice(0, 100)}`)
  assert.deepEqual(hits, [])
})
