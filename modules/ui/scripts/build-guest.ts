#!/usr/bin/env node
// The frame guest as ONE text (cr-modules-008 task 4): dist/guest/guest.js, with dist/guest/guest.css (this app's
// stylesheet, fonts inlined). No framework: a module bundles its own and hands the guest mount functions
// (src/modules/guest/guest.ts). A host reads the pair from here (dt web's `resolveGuest`).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "modules", "guest", "guest.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
})
const guest = out.outputFiles[0].text
if (/<\/script/i.test(guest)) throw new Error("the guest text contains </script — it cannot be one inline block")
const dir = path.join(ROOT, "dist", "guest")
// from empty: a file an earlier build wrote (0.3's SOURCE.json) must not ride along into the tarball
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, "guest.js"), guest)
const css = path.join(ROOT, "dist", "lib", "style.css")
// fonts and images the stylesheet names are inlined as data: — the frame policy loads nothing by URL
const MIME: Record<string, string> = {
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
}
const inlined = fs.existsSync(css)
  ? fs.readFileSync(css, "utf8").replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, ref: string) => {
      if (/^(data:|#)/.test(ref)) return all
      const file = path.resolve(path.dirname(css), ref.split(/[?#]/)[0])
      const type = MIME[path.extname(file).toLowerCase()]
      return type && fs.existsSync(file)
        ? `url(data:${type};base64,${fs.readFileSync(file).toString("base64")})`
        : "none"
    })
  : ""
fs.writeFileSync(path.join(dir, "guest.css"), inlined)
console.log(`built dist/guest/ (${guest.length} chars)`)
